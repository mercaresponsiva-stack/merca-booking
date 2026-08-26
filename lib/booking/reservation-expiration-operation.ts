import {
  calculateReservationFinancialState,
} from "@/lib/booking/reservation-financial-state";

import {
  calculatePaymentSummary,
} from "@/lib/booking/payment-summary";

import {
  validateReservationForExpiration,
} from "@/lib/booking/reservation-expiration-policy";

import {
  prisma,
} from "@/lib/prisma";

export type ReservationExpirationDb =
  Pick<
    typeof prisma,
    | "reservation"
    | "payment"
    | "refund"
    | "reservationResource"
    | "reservationChange"
  >;

type ExpirePendingReservationInput = {
  reservationId:
    string;

  requestedAt:
    Date;

  db:
    ReservationExpirationDb;
};

/*
 * Expires an abandoned pending reservation.
 *
 * The caller must provide a transactional client.
 * The HTTP or batch boundary is responsible for
 * executing the operation with Serializable
 * isolation.
 *
 * This operation does not:
 *
 * - create a Cancellation
 * - create or modify Refund records
 * - modify contractual dates or prices
 * - remove ReservationResource records
 * - attribute the expiration to a human actor
 */
export async function expirePendingReservation({
  reservationId,

  requestedAt,

  db,
}: ExpirePendingReservationInput) {
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

        createdAt:
          true,

        expiresAt:
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

  /*
   * Payment and refund reads remain sequential so
   * the same transactional pg client never receives
   * concurrent operations.
   */
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

  const expirationValidation =
    validateReservationForExpiration({
      status:
        reservation.status,

      expiresAt:
        reservation.expiresAt,

      requestedAt,

      paymentOption:
        reservation.paymentOption,

      paymentSummary,
    });

  /*
   * Assignments remain as historical evidence.
   * EXPIRED is outside ACTIVE_RESERVATION_STATUSES,
   * so these rows stop consuming inventory without
   * being deleted.
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
          "EXPIRATION",

        changedById:
          null,

        reason:
          null,

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
          expirationValidation.nextStatus,

        details: {
          operation:
            "EXPIRATION",

          scope:
            "universal",

          reservationCreatedAt:
            reservation.createdAt.toISOString(),

          expiresAt:
            expirationValidation
              .expiresAt
              .toISOString(),

          expiredAt:
            expirationValidation
              .expiredAt
              .toISOString(),

          paymentContract:
            expirationValidation
              .paymentContract,

          contract: {
            datesPreserved:
              true,

            pricePreserved:
              true,

            expirationDeadlinePreserved:
              true,
          },

          financial: {
            total:
              paymentSummary.total,

            paymentOption:
              reservation.paymentOption,

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

            requiredInitialPayment:
              paymentSummary
                .requiredInitialPayment,

            initialPaymentRemaining:
              paymentSummary
                .initialPaymentRemaining,

            initialPaymentSatisfied:
              paymentSummary
                .initialPaymentSatisfied,

            pendingPaymentsResolved:
              true,

            refundsResolved:
              true,

            retainedFundsResolved:
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

          sideEffects: {
            cancellationCreated:
              false,

            refundsCreated:
              false,
          },
        },

        createdAt:
          expirationValidation
            .expiredAt,
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
          expirationValidation.nextStatus,
      },

      select: {
        id:
          true,

        confirmationCode:
          true,

        status:
          true,

        createdAt:
          true,

        expiresAt:
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
        updatedReservation
          .confirmationCode,

      status:
        updatedReservation.status,

      createdAt:
        updatedReservation.createdAt,

      expiresAt:
        updatedReservation.expiresAt,

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

    expiration: {
      reservationCreatedAt:
        reservation.createdAt,

      expiresAt:
        expirationValidation.expiresAt,

      expiredAt:
        expirationValidation.expiredAt,

      paymentContract:
        expirationValidation.paymentContract,

      pendingPaymentsResolved:
        true,

      refundsResolved:
        true,

      retainedFundsResolved:
        true,

      cancellationCreated:
        false,

      refundsCreated:
        false,
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
