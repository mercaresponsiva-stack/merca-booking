import {
  calculateReservationFinancialState,
} from "@/lib/booking/reservation-financial-state";

import {
  validateReservationForCompletion,
} from "@/lib/booking/reservation-checkout-policy";

import {
  calculatePaymentSummary,
} from "@/lib/booking/payment-summary";

import {
  prisma,
} from "@/lib/prisma";

export type ReservationCompletionDb =
  Pick<
    typeof prisma,
    | "reservation"
    | "user"
    | "payment"
    | "refund"
    | "reservationResource"
    | "reservationChange"
  >;

type CompleteCheckedOutReservationInput = {
  reservationId:
    string;

  changedById:
    string;

  reason:
    string | null;

  requestedAt:
    Date;

  db:
    ReservationCompletionDb;
};

/*
 * Registra el cierre administrativo definitivo
 * de una reserva que ya tiene check-out.
 *
 * La función espera recibir un cliente
 * transaccional. La ruta HTTP será responsable
 * de ejecutar toda la operación con aislamiento
 * Serializable.
 *
 * Esta operación NO:
 *
 * - modifica fechas contractuales
 * - modifica precios
 * - crea pagos
 * - crea reembolsos
 * - elimina asignaciones históricas
 * - ejecuta nuevamente el check-out
 */
export async function completeCheckedOutReservation({
  reservationId,

  changedById,

  reason,

  requestedAt,

  db,
}: CompleteCheckedOutReservationInput) {
  const normalizedReason =
    reason?.trim() ||
    null;

  /*
   * Todas las consultas son secuenciales
   * para no ejecutar operaciones concurrentes
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
      "COMPLETION_ACTOR_NOT_VALID",
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

  /*
   * Revalidamos la liquidación financiera dentro
   * de la misma transacción que aplicará el cierre.
   *
   * Debe cumplirse:
   *
   * - status CHECKED_OUT
   * - balance = 0
   * - pending = 0
   * - refundPending = 0
   * - netPaid = total
   */
  const completionValidation =
    validateReservationForCompletion({
      status:
        reservation.status,

      paymentSummary,
    });

  /*
   * Las asignaciones se conservan como historial.
   *
   * CHECKED_OUT ya se encuentra fuera de
   * ACTIVE_RESERVATION_STATUSES, por lo que estas
   * relaciones no consumen inventario operativo.
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
          "COMPLETION",

        changedById:
          actor.id,

        reason:
          normalizedReason,

        /*
         * El cierre administrativo no altera
         * el contrato histórico.
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
          completionValidation.nextStatus,

        details: {
          operation:
            "COMPLETION",

          completedAt:
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

            financiallySettled:
              true,
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
          completionValidation.nextStatus,
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

    completion: {
      completedAt:
        requestedAt,

      financiallySettled:
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