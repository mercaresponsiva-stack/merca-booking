import {
  calculateReservationFinancialState,
} from "@/lib/booking/reservation-financial-state";

import {
  validateReservationForCheckout,
} from "@/lib/booking/reservation-checkout-policy";

import {
  calculatePaymentSummary,
} from "@/lib/booking/payment-summary";

import {
  prisma,
} from "@/lib/prisma";

export type ReservationCheckoutDb =
  Pick<
    typeof prisma,
    | "reservation"
    | "business"
    | "businessType"
    | "user"
    | "payment"
    | "refund"
    | "reservationResource"
    | "reservationChange"
  >;

type CheckOutHotelReservationInput = {
  reservationId:
    string;

  changedById:
    string;

  reason:
    string | null;

  requestedAt:
    Date;

  db:
    ReservationCheckoutDb;
};

/*
 * Registra el check-out operativo de una
 * reserva hotelera.
 *
 * La función espera recibir un cliente
 * transaccional. La ruta HTTP será responsable
 * de ejecutar toda la operación con aislamiento
 * Serializable.
 *
 * Esta operación NO:
 *
 * - acorta Reservation.endAt
 * - recalcula precios
 * - crea reembolsos
 * - elimina ReservationResource
 * - marca la reserva como COMPLETED
 */
export async function checkOutHotelReservation({
  reservationId,

  changedById,

  reason,

  requestedAt,

  db,
}: CheckOutHotelReservationInput) {
  const normalizedReason =
    reason?.trim() ||
    null;

  /*
   * Las consultas se mantienen secuenciales
   * para no lanzar operaciones concurrentes
   * sobre el mismo cliente pg transaccional.
   */
  const reservation =
    await db.reservation.findUnique({
      where: {
        id:
          reservationId,
      },

      select: {
        id:
          true,

        businessId:
          true,

        confirmationCode:
          true,

        status:
          true,

        startAt:
          true,

        endAt:
          true,

        subtotal:
          true,

        total:
          true,

        paymentOption:
          true,
      },
    });

  if (
    !reservation
  ) {
    throw new Error(
      "RESERVATION_NOT_FOUND",
    );
  }

  const business =
    await db.business.findUnique({
      where: {
        id:
          reservation.businessId,
      },

      select: {
        id:
          true,

        businessTypeId:
          true,
      },
    });

  if (
    !business
  ) {
    throw new Error(
      "CHECK_OUT_BUSINESS_NOT_FOUND",
    );
  }

  const businessType =
    await db.businessType.findUnique({
      where: {
        id:
          business.businessTypeId,
      },

      select: {
        slug:
          true,
      },
    });

  if (
    !businessType ||
    businessType.slug !==
      "hotel"
  ) {
    throw new Error(
      "CHECK_OUT_VERTICAL_NOT_IMPLEMENTED",
    );
  }

  const actor =
    await db.user.findFirst({
      where: {
        id:
          changedById,

        businessId:
          reservation.businessId,

        isActive:
          true,
      },

      select: {
        id:
          true,

        name:
          true,

        role:
          true,
      },
    });

  if (
    !actor
  ) {
    throw new Error(
      "CHECK_OUT_ACTOR_NOT_VALID",
    );
  }

  const payments =
    await db.payment.findMany({
      where: {
        reservationId:
          reservation.id,
      },

      select: {
        id:
          true,

        amount:
          true,

        status:
          true,
      },

      orderBy: {
        createdAt:
          "asc",
      },
    });

  const paymentIds =
    payments.map(
      (
        payment,
      ) =>
        payment.id,
    );

  const refunds =
    paymentIds.length ===
      0
      ? []
      : await db.refund.findMany({
          where: {
            paymentId: {
              in:
                paymentIds,
            },
          },

          select: {
            paymentId:
              true,

            amount:
              true,

            status:
              true,
          },

          orderBy: {
            createdAt:
              "asc",
          },
        });

  const refundsByPaymentId =
    new Map<
      string,
      typeof refunds
    >();

  for (
    const refund of
    refunds
  ) {
    const current =
      refundsByPaymentId.get(
        refund.paymentId,
      ) ??
      [];

    current.push(
      refund,
    );

    refundsByPaymentId.set(
      refund.paymentId,
      current,
    );
  }

  const paymentsForSummary =
    payments.map(
      (
        payment,
      ) => ({
        amount:
          payment.amount,

        status:
          payment.status,

        refunds:
          refundsByPaymentId.get(
            payment.id,
          ) ??
          [],
      }),
    );

  const paymentSummary =
    calculatePaymentSummary({
      total:
        Number(
          reservation.total,
        ),

      paymentOption:
        reservation.paymentOption,

      payments:
        paymentsForSummary,
    });

  const checkoutValidation =
    validateReservationForCheckout({
      status:
        reservation.status,

      scheduledEndAt:
        reservation.endAt,

      requestedAt,

      reason:
        normalizedReason,

      paymentSummary,
    });

  /*
   * Estas relaciones se conservan como
   * evidencia histórica.
   *
   * Al salir de ACTIVE_RESERVATION_STATUSES,
   * dejan automáticamente de consumir
   * inventario futuro.
   */
  const retainedAssignments =
    await db.reservationResource.findMany({
      where: {
        reservationId:
          reservation.id,
      },

      select: {
        id:
          true,

        reservationServiceId:
          true,

        reservationOptionId:
          true,

        resourceId:
          true,
      },

      orderBy: {
        createdAt:
          "asc",
      },
    });

  const change =
    await db.reservationChange.create({
      data: {
        businessId:
          reservation.businessId,

        reservationId:
          reservation.id,

        type:
          "CHECK_OUT",

        changedById:
          actor.id,

        reason:
          normalizedReason,

        /*
         * Las fechas y precios contractuales
         * permanecen sin modificaciones.
         */
        oldStartAt:
          reservation.startAt,

        newStartAt:
          reservation.startAt,

        oldEndAt:
          reservation.endAt,

        newEndAt:
          reservation.endAt,

        oldSubtotal:
          reservation.subtotal,

        newSubtotal:
          reservation.subtotal,

        oldTotal:
          reservation.total,

        newTotal:
          reservation.total,

        oldStatus:
          reservation.status,

        newStatus:
          checkoutValidation.nextStatus,

        details: {
          operation:
            "CHECK_OUT",

          vertical:
            "hotel",

          timing:
            checkoutValidation.timing,

          scheduledStartAt:
            reservation.startAt.toISOString(),

          scheduledEndAt:
            reservation.endAt.toISOString(),

          checkedOutAt:
            requestedAt.toISOString(),

          earlyCheckout:
            checkoutValidation.timing ===
            "EARLY",

          contract: {
            datesPreserved:
              true,

            pricePreserved:
              true,
          },

          financial: {
            total:
              paymentSummary.total,

            grossPaid:
              paymentSummary.grossPaid,

            pending:
              paymentSummary.pending,

            refundPending:
              paymentSummary.refundPending,

            refunded:
              paymentSummary.refunded,

            netPaid:
              paymentSummary.netPaid,

            balance:
              paymentSummary.balance,

            hasRefundPending:
              checkoutValidation.hasRefundPending,
          },

          resources: {
            assignmentsRetained:
              true,

            inventoryReleasedByStatus:
              true,

            assignmentCount:
              retainedAssignments.length,

            assignmentIds:
              retainedAssignments.map(
                (
                  assignment,
                ) =>
                  assignment.id,
              ),
          },
        },

        createdAt:
          requestedAt,
      },
    });

  const updatedReservation =
    await db.reservation.update({
      where: {
        id:
          reservation.id,
      },

      data: {
        status:
          checkoutValidation.nextStatus,
      },

      select: {
        id:
          true,

        businessId:
          true,

        confirmationCode:
          true,

        status:
          true,

        startAt:
          true,

        endAt:
          true,

        subtotal:
          true,

        total:
          true,

        paymentOption:
          true,
      },
    });

  const financialState =
    calculateReservationFinancialState({
      status:
        updatedReservation.status,

      paymentSummary,
    });

  return {
    reservation: {
      id:
        updatedReservation.id,

      confirmationCode:
        updatedReservation.confirmationCode,

      status:
        updatedReservation.status,

      startAt:
        updatedReservation.startAt,

      endAt:
        updatedReservation.endAt,

      subtotal:
        Number(
          updatedReservation.subtotal,
        ),

      total:
        Number(
          updatedReservation.total,
        ),

      paymentOption:
        updatedReservation.paymentOption,
    },

    actor,

    checkout: {
      timing:
        checkoutValidation.timing,

      scheduledEndAt:
        reservation.endAt,

      checkedOutAt:
        requestedAt,

      earlyCheckout:
        checkoutValidation.timing ===
        "EARLY",

      hasRefundPending:
        checkoutValidation.hasRefundPending,
    },

    change,

    resources: {
      retained:
        retainedAssignments,

      assignmentCount:
        retainedAssignments.length,

      inventoryReleasedByStatus:
        true,
    },

    paymentSummary,

    financialState,
  };
}