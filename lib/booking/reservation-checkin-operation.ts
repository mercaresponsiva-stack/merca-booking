import {
  calculatePaymentSummary,
} from "@/lib/booking/payment-summary";

import {
  calculateReservationFinancialState,
} from "@/lib/booking/reservation-financial-state";

import {
  validateReservationForCheckin,
} from "@/lib/booking/reservation-checkin-policy";

import {
  getReservationTransitionPolicyViolation,
} from "@/lib/booking/reservation-policy";

import {
  evaluateAssignedResourcesForInterval,
} from "@/lib/booking/resource-interval-check";

import {
  prisma,
} from "@/lib/prisma";

export type ReservationCheckinDb =
  Pick<
    typeof prisma,
    | "reservation"
    | "business"
    | "businessType"
    | "user"
    | "reservationService"
    | "serviceResourceType"
    | "reservationOption"
    | "serviceOptionResourceType"
    | "reservationResource"
    | "resource"
    | "payment"
    | "refund"
    | "block"
    | "reservationChange"
  >;

type CheckInHotelReservationInput = {
  reservationId:
    string;

  changedById:
    string;

  reason:
    string | null;

  requestedAt:
    Date;

  db:
    ReservationCheckinDb;
};

/*
 * Registra el ingreso operativo de una
 * reserva hotelera.
 *
 * La función espera un cliente transaccional.
 * La ruta HTTP debe ejecutarla con aislamiento
 * Serializable.
 *
 * Esta operación:
 *
 * - conserva fechas y precios contractuales
 * - conserva las asignaciones físicas
 * - valida nuevamente pagos y recursos
 * - registra actor, hora real y auditoría
 * - cambia únicamente CONFIRMED a CHECKED_IN
 */
export async function checkInHotelReservation({
  reservationId,

  changedById,

  reason,

  requestedAt,

  db,
}: CheckInHotelReservationInput) {
  const normalizedReason =
    reason?.trim() ||
    null;

  /*
   * Las consultas son secuenciales para no
   * ejecutar operaciones simultáneas sobre
   * el mismo cliente pg transaccional.
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
      "CHECK_IN_BUSINESS_NOT_FOUND",
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
      "CHECK_IN_VERTICAL_NOT_IMPLEMENTED",
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
      "CHECK_IN_ACTOR_NOT_VALID",
    );
  }

  const checkinValidation =
    validateReservationForCheckin({
      status:
        reservation.status,

      scheduledStartAt:
        reservation.startAt,

      scheduledEndAt:
        reservation.endAt,

      requestedAt,

      reason:
        normalizedReason,
    });

  const reservationServices =
    await db.reservationService.findMany({
      where: {
        reservationId:
          reservation.id,
      },

      select: {
        id:
          true,

        serviceId:
          true,

        quantity:
          true,
      },

      orderBy: {
        createdAt:
          "asc",
      },
    });

  const serviceIds = [
    ...new Set(
      reservationServices.map(
        (
          reservationService,
        ) =>
          reservationService.serviceId,
      ),
    ),
  ];

  const serviceRequirements =
    serviceIds.length ===
      0
      ? []
      : await db.serviceResourceType.findMany({
          where: {
            serviceId: {
              in:
                serviceIds,
            },
          },

          select: {
            serviceId:
              true,

            resourceTypeId:
              true,

            requiredQuantity:
              true,
          },
        });

  const serviceRequirementsByServiceId =
    new Map<
      string,
      Array<{
        resourceTypeId:
          string;

        requiredQuantity:
          number;
      }>
    >();

  for (
    const requirement of
    serviceRequirements
  ) {
    const current =
      serviceRequirementsByServiceId.get(
        requirement.serviceId,
      ) ??
      [];

    current.push({
      resourceTypeId:
        requirement.resourceTypeId,

      requiredQuantity:
        requirement.requiredQuantity,
    });

    serviceRequirementsByServiceId.set(
      requirement.serviceId,
      current,
    );
  }

  const reservationOptions =
    await db.reservationOption.findMany({
      where: {
        reservationId:
          reservation.id,
      },

      select: {
        id:
          true,

        includedQuantity:
          true,

        optionalQuantity:
          true,

        removedOptionalQuantity:
          true,

        serviceOptionId:
          true,
      },

      orderBy: {
        createdAt:
          "asc",
      },
    });

  const serviceOptionIds =
    new Set<string>();

  for (
    const reservationOption of
    reservationOptions
  ) {
    if (
      reservationOption.serviceOptionId
    ) {
      serviceOptionIds.add(
        reservationOption.serviceOptionId,
      );
    }
  }

  const optionRequirements =
    serviceOptionIds.size ===
      0
      ? []
      : await db.serviceOptionResourceType.findMany({
          where: {
            serviceOptionId: {
              in: [
                ...serviceOptionIds,
              ],
            },
          },

          select: {
            serviceOptionId:
              true,

            resourceTypeId:
              true,

            requiredQuantity:
              true,
          },
        });

  const optionRequirementsByServiceOptionId =
    new Map<
      string,
      Array<{
        resourceTypeId:
          string;

        requiredQuantity:
          number;
      }>
    >();

  for (
    const requirement of
    optionRequirements
  ) {
    const current =
      optionRequirementsByServiceOptionId.get(
        requirement.serviceOptionId,
      ) ??
      [];

    current.push({
      resourceTypeId:
        requirement.resourceTypeId,

      requiredQuantity:
        requirement.requiredQuantity,
    });

    optionRequirementsByServiceOptionId.set(
      requirement.serviceOptionId,
      current,
    );
  }

  const reservationResources =
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

  const resourceIds = [
    ...new Set(
      reservationResources.map(
        (
          assignment,
        ) =>
          assignment.resourceId,
      ),
    ),
  ];

  const assignedResources =
    resourceIds.length ===
      0
      ? []
      : await db.resource.findMany({
          where: {
            id: {
              in:
                resourceIds,
            },
          },

          select: {
            id:
              true,

            resourceTypeId:
              true,
          },
        });

  const resourceTypeIdByResourceId =
    new Map<
      string,
      string | null
    >();

  for (
    const resource of
    assignedResources
  ) {
    resourceTypeIdByResourceId.set(
      resource.id,
      resource.resourceTypeId,
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

  const servicesForPolicy =
    reservationServices.map(
      (
        reservationService,
      ) => ({
        quantity:
          reservationService.quantity,

        service: {
          resourceTypes:
            serviceRequirementsByServiceId.get(
              reservationService.serviceId,
            ) ??
            [],
        },

        resources:
          reservationResources
            .filter(
              (
                assignment,
              ) =>
                assignment.reservationServiceId ===
                reservationService.id,
            )
            .map(
              (
                assignment,
              ) => ({
                resource: {
                  resourceTypeId:
                    resourceTypeIdByResourceId.get(
                      assignment.resourceId,
                    ) ??
                    null,
                },
              }),
            ),
      }),
    );

  const optionsForPolicy =
    reservationOptions.map(
      (
        reservationOption,
      ) => ({
        includedQuantity:
          reservationOption.includedQuantity,

        optionalQuantity:
          reservationOption.optionalQuantity,

        removedOptionalQuantity:
          reservationOption.removedOptionalQuantity,

        serviceOption:
          reservationOption.serviceOptionId
            ? {
                resourceTypes:
                  optionRequirementsByServiceOptionId.get(
                    reservationOption.serviceOptionId,
                  ) ??
                  [],
              }
            : null,

        resources:
          reservationResources
            .filter(
              (
                assignment,
              ) =>
                assignment.reservationOptionId ===
                reservationOption.id,
            )
            .map(
              (
                assignment,
              ) => ({
                resource: {
                  resourceTypeId:
                    resourceTypeIdByResourceId.get(
                      assignment.resourceId,
                    ) ??
                    null,
                },
              }),
            ),
      }),
    );

  const policyViolation =
    getReservationTransitionPolicyViolation({
      targetStatus:
        checkinValidation.nextStatus,

      paymentSummary,

      services:
        servicesForPolicy,

      options:
        optionsForPolicy,
    });

  if (
    policyViolation
  ) {
    throw new Error(
      policyViolation,
    );
  }

  /*
   * Si el huésped llega antes, comprobamos
   * disponibilidad desde la hora real.
   *
   * Esto evita ocupar anticipadamente una
   * habitación que todavía esté asignada o
   * bloqueada para otro intervalo.
   *
   * Las fechas contractuales no se modifican.
   */
  const resourceValidationStartAt =
    checkinValidation.earlyCheckin
      ? requestedAt
      : reservation.startAt;

  const resourceEvaluation =
    await evaluateAssignedResourcesForInterval({
      businessId:
        reservation.businessId,

      reservationId:
        reservation.id,

      startAt:
        resourceValidationStartAt,

      endAt:
        reservation.endAt,

      db,
    });

  if (
    !resourceEvaluation.canKeepAll
  ) {
    console.warn(
      "CHECK-IN assigned resource integrity violation:",
      {
        reservationId:
          reservation.id,

        validationStartAt:
          resourceValidationStartAt,

        validationEndAt:
          reservation.endAt,

        unavailableAssignments:
          resourceEvaluation.release.map(
            (
              assignment,
            ) => ({
              assignmentId:
                assignment.assignmentId,

              resourceId:
                assignment.resourceId,

              serviceId:
                assignment.serviceId,

              resourceTypeId:
                assignment.resourceTypeId,

              reason:
                assignment.reason,

              conflictReservation:
                assignment.conflictReservation ??
                null,
            }),
          ),
      },
    );

    throw new Error(
      "ASSIGNED_RESOURCES_UNAVAILABLE_FOR_CHECK_IN",
    );
  }

  const earlyIntervalExpanded =
    resourceValidationStartAt.getTime() <
    reservation.startAt.getTime();

  const change =
    await db.reservationChange.create({
      data: {
        businessId:
          reservation.businessId,

        reservationId:
          reservation.id,

        type:
          "CHECK_IN",

        changedById:
          actor.id,

        reason:
          checkinValidation.reason,

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
          checkinValidation.nextStatus,

        details: {
          operation:
            "CHECK_IN",

          vertical:
            "hotel",

          timing:
            checkinValidation.timing,

          scheduledStartAt:
            reservation.startAt.toISOString(),

          scheduledEndAt:
            reservation.endAt.toISOString(),

          checkedInAt:
            requestedAt.toISOString(),

          earlyCheckin:
            checkinValidation.earlyCheckin,

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

            initialPaymentSatisfied:
              paymentSummary.initialPaymentSatisfied,
          },

          resources: {
            assignmentsRetained:
              true,

            inventoryContinuesByStatus:
              true,

            integrityValidated:
              true,

            assignmentCount:
              reservationResources.length,

            assignmentIds:
              reservationResources.map(
                (
                  assignment,
                ) =>
                  assignment.id,
              ),

            validationStartAt:
              resourceValidationStartAt.toISOString(),

            validationEndAt:
              reservation.endAt.toISOString(),

            earlyIntervalExpanded,
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
          checkinValidation.nextStatus,
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

    checkin: {
      timing:
        checkinValidation.timing,

      scheduledStartAt:
        reservation.startAt,

      scheduledEndAt:
        reservation.endAt,

      checkedInAt:
        requestedAt,

      earlyCheckin:
        checkinValidation.earlyCheckin,
    },

    change,

    resources: {
      retained:
        reservationResources,

      assignmentCount:
        reservationResources.length,

      integrityValidated:
        true,

      validationStartAt:
        resourceValidationStartAt,

      validationEndAt:
        reservation.endAt,

      earlyIntervalExpanded,
    },

    paymentSummary,

    financialState,
  };
}