import {
  calculatePaymentSummary,
} from "@/lib/booking/payment-summary";

import {
  calculateReservationFinancialState,
} from "@/lib/booking/reservation-financial-state";

import {
  validateReservationForConfirmation,
} from "@/lib/booking/reservation-confirmation-policy";

import { prisma } from "@/lib/prisma";

export const RESERVATION_CONFIRMATION_ALLOWED_ROLES = [
  "OWNER",
  "ADMIN",
  "RECEPTIONIST",
] as const;

export type ReservationConfirmationDb =
  Pick<
    typeof prisma,
    | "businessMembership"
    | "payment"
    | "reservation"
    | "reservationChange"
    | "reservationResource"
  >;

type ConfirmReservationInput = {
  reservationId: string;

  // Negocio y actor obtenidos de la autorización del servidor.
  businessId: string;

  changedById: string;

  reason?: string | null;

  confirmedAt?: Date;

  /*
   * Debe recibirse desde una transacción
   * interactiva Serializable.
   */
  db: ReservationConfirmationDb;
};

/*
 * Confirma una reserva de forma controlada.
 *
 * Esta operación:
 *
 * - cambia únicamente PENDING a CONFIRMED
 * - vuelve a calcular el estado financiero
 * - valida la membresía activa del actor dentro del negocio
 * - conserva fechas, precios y recursos
 * - registra una auditoría CONFIRMATION
 *
 * No confirma automáticamente al registrar
 * un pago. De esta forma, el movimiento
 * financiero y la decisión contractual
 * permanecen como operaciones separadas.
 */
export async function confirmReservation({
  reservationId,

  businessId,

  changedById,

  reason,

  confirmedAt =
    new Date(),

  db,
}: ConfirmReservationInput) {
  if (
    !(
      confirmedAt instanceof
      Date
    ) ||
    !Number.isFinite(
      confirmedAt.getTime(),
    )
  ) {
    throw new Error(
      "INVALID_CONFIRMATION_TIMESTAMP",
    );
  }

  // Evitamos que un identificador ausente omita accidentalmente un filtro.
  if (
    typeof reservationId !== "string" ||
    !reservationId.trim() ||
    typeof businessId !== "string" ||
    !businessId.trim()
  ) {
    throw new Error("RESERVATION_NOT_FOUND");
  }

  if (typeof changedById !== "string" || !changedById.trim()) {
    throw new Error("CONFIRMATION_ACTOR_NOT_VALID");
  }

  const reservation =
    await db.reservation.findFirst({
      where: {
        id:
          reservationId,

        businessId,
      },

      select: {
        id:
          true,

        businessId:
          true,

        confirmationCode:
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

        status:
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
   * Revalidamos la membresía dentro de la misma transacción.
   * User.businessId y User.role no conceden acceso a esta operación.
   */
  const actorMembership = await db.businessMembership.findFirst({
    where: {
      businessId,
      userId: changedById,
      isActive: true,
      role: { in: [...RESERVATION_CONFIRMATION_ALLOWED_ROLES] },
      user: { is: { isActive: true } },
      business: { is: { isActive: true } },
    },
    select: {
      role: true,
      user: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  if (!actorMembership) {
    throw new Error("CONFIRMATION_ACTOR_NOT_VALID");
  }

  const actor = {
    id: actorMembership.user.id,
    name: actorMembership.user.name,
    role: actorMembership.role,
  };

  /*
   * Recalculamos los pagos dentro de la
   * misma transacción que confirmará la
   * reserva.
   */
  const payments =
    await db.payment.findMany({
      where: {
        reservationId:
          reservation.id,

        businessId,
      },

      select: {
        amount:
          true,

        status:
          true,

        refunds: {
          where: {
            businessId,
            reservationId: reservation.id,
          },

          select: {
            amount:
              true,

            status:
              true,
          },
        },
      },

      orderBy: {
        createdAt:
          "asc",
      },
    });

  const paymentSummary =
    calculatePaymentSummary({
      total:
        Number(
          reservation.total,
        ),

      paymentOption:
        reservation.paymentOption,

      payments,
    });

  const confirmationValidation =
    validateReservationForConfirmation({
      status:
        reservation.status,

      initialPaymentSatisfied:
        paymentSummary
          .initialPaymentSatisfied,

      reason,
    });

  /*
   * PENDING y CONFIRMED pertenecen a los
   * estados activos. Las asignaciones no
   * deben eliminarse ni modificarse.
   */
  const retainedResources =
    await db.reservationResource.findMany({
      where: {
        reservationId:
          reservation.id,

        resource: { is: { businessId } },

        AND: [
          {
            OR: [
              { reservationServiceId: null },
              { reservationService: { is: { reservationId: reservation.id } } },
            ],
          },
          {
            OR: [
              { reservationOptionId: null },
              { reservationOption: { is: { reservationId: reservation.id } } },
            ],
          },
        ],
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
          "CONFIRMATION",

        changedById:
          actor.id,

        reason:
          confirmationValidation
            .reason,

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
          confirmationValidation
            .nextStatus,

        details: {
          operation:
            "CONFIRMATION",

          scope:
            "universal",

          confirmedAt:
            confirmedAt.toISOString(),

          contract: {
            datesPreserved:
              true,

            pricePreserved:
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
              paymentSummary
                .refundPending,

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

            remainingBalancePayable:
              paymentSummary.balance >
              0,

            newPaymentsAllowed:
              true,
          },

          resources: {
            assignmentCount:
              retainedResources.length,

            assignmentIds:
              retainedResources.map(
                (
                  assignment,
                ) =>
                  assignment.id,
              ),

            assignmentsRetained:
              true,

            inventoryContinuesByStatus:
              true,
          },
        },

        createdAt:
          confirmedAt,
      },
    });

  const updatedReservation =
    await db.reservation.update({
      where: {
        id:
          reservation.id,

        businessId,
      },

      data: {
        status:
          confirmationValidation
            .nextStatus,
      },

      select: {
        id:
          true,

        confirmationCode:
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

        status:
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
        updatedReservation
          .paymentOption,
    },

    actor,

    confirmation: {
      confirmedAt,

      initialPaymentSatisfied:
        paymentSummary
          .initialPaymentSatisfied,

      requiredInitialPayment:
        paymentSummary
          .requiredInitialPayment,

      initialPaymentRemaining:
        paymentSummary
          .initialPaymentRemaining,

      remainingBalance:
        paymentSummary.balance,
    },

    change,

    resources: {
      retained:
        retainedResources,

      assignmentCount:
        retainedResources.length,

      assignmentsRetained:
        true,

      inventoryContinuesByStatus:
        true,
    },

    paymentSummary,

    financialState,
  };
}