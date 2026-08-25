import {
  calculateReservationFinancialState,
} from "@/lib/booking/reservation-financial-state";

import {
  toCents,
} from "@/lib/booking/money";

import {
  calculatePaymentSummary,
} from "@/lib/booking/payment-summary";

import {
  validateReservationForNoShow,
} from "@/lib/booking/reservation-no-show-policy";

import {
  prisma,
} from "@/lib/prisma";

export type ReservationNoShowDb =
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

type MarkReservationNoShowInput = {
  reservationId:
    string;

  changedById:
    string;

  reason:
    string | null;

  requestedAt:
    Date;

  db:
    ReservationNoShowDb;
};

/*
 * Registra que el cliente no se presentó.
 *
 * La función espera un cliente transaccional.
 * La ruta HTTP ejecutará la operación completa
 * con aislamiento Serializable.
 *
 * Esta operación NO:
 *
 * - cambia las fechas contractuales
 * - recalcula precios
 * - crea cobros
 * - crea devoluciones
 * - elimina ReservationResource
 * - crea una Cancellation
 */
export async function markReservationNoShow({
  reservationId,

  changedById,

  reason,

  requestedAt,

  db,
}: MarkReservationNoShowInput) {
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

        guests:
          true,

        adults:
          true,

        children:
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
      "NO_SHOW_BUSINESS_NOT_FOUND",
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
    !businessType
  ) {
    throw new Error(
      "NO_SHOW_BUSINESS_TYPE_NOT_FOUND",
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
      "NO_SHOW_ACTOR_NOT_VALID",
    );
  }

  const noShowValidation =
    validateReservationForNoShow({
      status:
        reservation.status,

      scheduledStartAt:
        reservation.startAt,

      requestedAt,

      reason,
    });

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

  /*
   * NO_SHOW deja de ser pagable.
   *
   * Por eso un pago todavía PENDING debe
   * resolverse antes de aplicar el estado:
   * después ya no podría confirmarse como PAID.
   */
  if (
    toCents(
      paymentSummary.pending,
    ) >
    0
  ) {
    throw new Error(
      "PENDING_PAYMENTS_MUST_BE_RESOLVED_FOR_NO_SHOW",
    );
  }

  /*
   * Las asignaciones se conservan como
   * evidencia histórica.
   *
   * Al salir de ACTIVE_RESERVATION_STATUSES
   * dejan de consumir inventario operativo.
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
          "NO_SHOW",

        changedById:
          actor.id,

        reason:
          noShowValidation.reason,

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
          noShowValidation.nextStatus,

        details: {
          operation:
            "NO_SHOW",

          vertical:
            businessType.slug,

          scheduledStartAt:
            reservation.startAt.toISOString(),

          scheduledEndAt:
            reservation.endAt.toISOString(),

          markedNoShowAt:
            requestedAt.toISOString(),

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

            pendingPaymentsResolved:
              true,

            newPaymentsAllowed:
              false,
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
          noShowValidation.nextStatus,
      },

      select: {
        id:
          true,

        confirmationCode:
          true,

        status:
          true,

        startAt:
          true,

        endAt:
          true,

        guests:
          true,

        adults:
          true,

        children:
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

      guests:
        updatedReservation.guests,

      adults:
        updatedReservation.adults,

      children:
        updatedReservation.children,

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

    noShow: {
      vertical:
        businessType.slug,

      scheduledStartAt:
        reservation.startAt,

      scheduledEndAt:
        reservation.endAt,

      markedNoShowAt:
        requestedAt,

      pendingPaymentsResolved:
        true,
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