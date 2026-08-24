import {
  getOverlapWhere,
  isResourceBlocked,
} from "@/lib/booking/resource-availability";

import { ACTIVE_RESERVATION_STATUSES } from "@/lib/booking/reservation-state";

import { prisma } from "@/lib/prisma";

export type ResourceIntervalCheckDb = Pick<
  typeof prisma,
  "reservationResource" | "block"
>;

export type ResourceIntervalUnavailableReason =
  | "RESOURCE_ALREADY_OCCUPIED"
  | "RESOURCE_BLOCKED";

type CheckResourceForIntervalInput = {
  businessId: string;

  reservationId: string;

  serviceId: string;

  resourceTypeId: string;

  resourceId: string;

  startAt: Date;
  endAt: Date;

  db?: ResourceIntervalCheckDb;
};

export type ResourceIntervalCheckResult =
  | {
      available: true;
    }
  | {
      available: false;

      reason: ResourceIntervalUnavailableReason;

      conflictReservation?: {
        id: string;
        confirmationCode: string;
      };
    };

type AssignedResourceEffectiveIntervalInput = {
  reservationStartAt: Date;
  reservationEndAt: Date;

  optionStartAt:
    Date | null;

  optionEndAt:
    Date | null;
};

/*
 * Resuelve el intervalo que realmente ocupa
 * una asignación física:
 *
 * ReservationService:
 * usa el intervalo general.
 *
 * ReservationOption null/null:
 * hereda el intervalo general.
 *
 * ReservationOption con fechas:
 * conserva su intervalo propio.
 */
function resolveAssignedResourceEffectiveInterval({
  reservationStartAt,
  reservationEndAt,

  optionStartAt,
  optionEndAt,
}: AssignedResourceEffectiveIntervalInput) {
  const hasOptionStartAt =
    optionStartAt !==
    null;

  const hasOptionEndAt =
    optionEndAt !==
    null;

  if (
    hasOptionStartAt !==
    hasOptionEndAt
  ) {
    throw new Error(
      "RESERVATION_OPTION_INTERVAL_INCOMPLETE",
    );
  }

  const startAt =
    optionStartAt ??
    reservationStartAt;

  const endAt =
    optionEndAt ??
    reservationEndAt;

  if (
    endAt <=
    startAt
  ) {
    throw new Error(
      "INVALID_RESERVATION_RESOURCE_EFFECTIVE_INTERVAL",
    );
  }

  return {
    startAt,
    endAt,
  };
}

function intervalsOverlap(
  firstStartAt: Date,
  firstEndAt: Date,

  secondStartAt: Date,
  secondEndAt: Date,
) {
  return (
    firstStartAt <
      secondEndAt &&
    firstEndAt >
      secondStartAt
  );
}

/*
 * Comprueba si un Resource concreto
 * puede utilizarse durante un intervalo.
 *
 * Es universal:
 *
 * Hotel:
 * Resource = habitación
 *
 * Restaurante:
 * Resource = mesa
 *
 * Clínica:
 * Resource = consultorio / profesional
 *
 * Salón:
 * Resource = silla / profesional
 */
export async function checkResourceForInterval({
  businessId,
  reservationId,
  serviceId,
  resourceTypeId,
  resourceId,
  startAt,
  endAt,
  db = prisma,
}: CheckResourceForIntervalInput): Promise<ResourceIntervalCheckResult> {
  if (endAt <= startAt) {
    throw new Error("INVALID_RESOURCE_INTERVAL");
  }

  // ─────────────────────────────────────────────
  // OTHER RESERVATION USING RESOURCE
  //
  // La propia reserva queda excluida.
  // Esto es fundamental durante reschedule.
  // ─────────────────────────────────────────────

  /*
   * No filtramos por Reservation.startAt/endAt
   * dentro de SQL.
   *
   * Una asignación de ReservationOption puede
   * tener un intervalo propio distinto al de
   * su Reservation.
   */
  const assignmentCandidates =
    await db.reservationResource.findMany({
      where: {
        resourceId,

        reservationId: {
          not:
            reservationId,
        },

        reservation: {
          businessId,

          status: {
            in: [
              ...ACTIVE_RESERVATION_STATUSES,
            ],
          },
        },
      },

      select: {
        reservation: {
          select: {
            id:
              true,

            confirmationCode:
              true,

            startAt:
              true,

            endAt:
              true,
          },
        },

        reservationOption: {
          select: {
            startAt:
              true,

            endAt:
              true,
          },
        },
      },
    });

  const overlappingAssignment =
    assignmentCandidates.find(
      (
        assignment,
      ) => {
        const effectiveInterval =
          resolveAssignedResourceEffectiveInterval({
            reservationStartAt:
              assignment
                .reservation
                .startAt,

            reservationEndAt:
              assignment
                .reservation
                .endAt,

            optionStartAt:
              assignment
                .reservationOption
                ?.startAt ??
              null,

            optionEndAt:
              assignment
                .reservationOption
                ?.endAt ??
              null,
          });

        return intervalsOverlap(
          effectiveInterval
            .startAt,

          effectiveInterval
            .endAt,

          startAt,
          endAt,
        );
      },
    );

  if (overlappingAssignment) {
    return {
      available: false,

      reason: "RESOURCE_ALREADY_OCCUPIED",

      conflictReservation: {
        id: overlappingAssignment.reservation.id,

        confirmationCode: overlappingAssignment.reservation.confirmationCode,
      },
    };
  }

  // ─────────────────────────────────────────────
  // BLOCKS
  //
  // Respeta:
  //
  // Business
  // Service
  // ResourceType
  // Resource específico
  // ─────────────────────────────────────────────

  const blocks = await db.block.findMany({
    where: {
      businessId,

      ...getOverlapWhere(startAt, endAt),

      OR: [
        {
          serviceId: null,
        },

        {
          serviceId,
        },

        /*
         * Un Resource específico
         * debe respetarse incluso si
         * el Block conserva otro
         * serviceId.
         */
        {
          resourceId,
        },
      ],
    },

    select: {
      serviceId: true,

      resourceTypeId: true,

      resourceId: true,
    },
  });

  const blocked = isResourceBlocked(blocks, {
    serviceId,

    resourceTypeId,

    resourceId,
  });

  if (blocked) {
    return {
      available: false,

      reason: "RESOURCE_BLOCKED",
    };
  }

  return {
    available: true,
  };
}

export type AssignedResourceDisposition =
  | {
      action: "KEEP";

      assignmentId: string;

      resourceId: string;

      serviceId: string;

      resourceTypeId: string;
    }
  | {
      action: "RELEASE";

      assignmentId: string;

      resourceId: string;

      serviceId: string | null;

      resourceTypeId: string | null;

      reason:
        | ResourceIntervalUnavailableReason
        | "RESOURCE_INACTIVE"
        | "RESOURCE_TYPE_NOT_CONFIGURED"
        | "RESERVATION_SERVICE_NOT_LINKED";

      conflictReservation?: {
        id: string;
        confirmationCode: string;
      };
    };

type EvaluateAssignedResourcesInput = {
  businessId: string;

  reservationId: string;

  startAt: Date;
  endAt: Date;

  db?: ResourceIntervalCheckDb;
};

export async function evaluateAssignedResourcesForInterval({
  businessId,
  reservationId,
  startAt,
  endAt,
  db = prisma,
}: EvaluateAssignedResourcesInput) {
  const assignments = await db.reservationResource.findMany({
    where: {
      reservationId,
    },

    select: {
      id: true,

      resourceId: true,

      reservationService: {
        select: {
          serviceId: true,
        },
      },

      reservationOption: {
        select: {
          startAt: true,

          endAt: true,

          reservationService: {
            select: {
              serviceId: true,
            },
          },
        },
      },

      resource: {
        select: {
          id: true,

          isActive: true,

          resourceTypeId: true,
        },
      },
    },
  });

  const results: AssignedResourceDisposition[] = [];

  for (const assignment of assignments) {
    const optionReservationServiceId =
      assignment.reservationOption
        ?.reservationService
        ?.serviceId ??
      null;

    const serviceId =
      assignment.reservationService
        ?.serviceId ??
      optionReservationServiceId;

    const resourceTypeId =
      assignment.resource.resourceTypeId ??
      null;

    /*
     * El Resource puede provenir de:
     *
     * ReservationService
     * -> sigue el nuevo intervalo general.
     *
     * ReservationOption
     * -> conserva intervalo propio cuando
     *    existe.
     * -> null/null hereda el nuevo intervalo
     *    general.
     */
    const assignmentInterval =
      resolveAssignedResourceEffectiveInterval({
        reservationStartAt:
          startAt,

        reservationEndAt:
          endAt,

        optionStartAt:
          assignment
            .reservationOption
            ?.startAt ??
          null,

        optionEndAt:
          assignment
            .reservationOption
            ?.endAt ??
          null,
      });

    // ───────────────────────────────────────────
    // INACTIVE RESOURCE
    // ───────────────────────────────────────────

    if (!assignment.resource.isActive) {
      results.push({
        action: "RELEASE",

        assignmentId: assignment.id,

        resourceId: assignment.resourceId,

        serviceId,

        resourceTypeId,

        reason: "RESOURCE_INACTIVE",
      });

      continue;
    }

    // ───────────────────────────────────────────
    // RESOURCE TYPE REQUIRED
    // ───────────────────────────────────────────

    if (!resourceTypeId) {
      results.push({
        action: "RELEASE",

        assignmentId: assignment.id,

        resourceId: assignment.resourceId,

        serviceId,

        resourceTypeId: null,

        reason: "RESOURCE_TYPE_NOT_CONFIGURED",
      });

      continue;
    }

    // ───────────────────────────────────────────
    // SERVICE LINK REQUIRED
    //
    // ReservationResource permite null
    // históricamente, pero para conservar
    // automáticamente el Resource debemos
    // poder determinar a qué Service
    // pertenece.
    // ───────────────────────────────────────────

    if (!serviceId) {
      results.push({
        action: "RELEASE",

        assignmentId: assignment.id,

        resourceId: assignment.resourceId,

        serviceId: null,

        resourceTypeId,

        reason: "RESERVATION_SERVICE_NOT_LINKED",
      });

      continue;
    }

    // ───────────────────────────────────────────
    // NEW INTERVAL
    // ───────────────────────────────────────────

    const availability = await checkResourceForInterval({
      businessId,

      reservationId,

      serviceId,

      resourceTypeId,

      resourceId: assignment.resourceId,

      startAt:
        assignmentInterval
          .startAt,

      endAt:
        assignmentInterval
          .endAt,

      db,
    });

    if (!availability.available) {
      results.push({
        action: "RELEASE",

        assignmentId: assignment.id,

        resourceId: assignment.resourceId,

        serviceId,

        resourceTypeId,

        reason: availability.reason,

        ...(availability.conflictReservation
          ? {
              conflictReservation: availability.conflictReservation,
            }
          : {}),
      });

      continue;
    }

    results.push({
      action: "KEEP",

      assignmentId: assignment.id,

      resourceId: assignment.resourceId,

      serviceId,

      resourceTypeId,
    });
  }

  return {
    assignments: results,

    keep: results.filter(
      (
        result,
      ): result is Extract<AssignedResourceDisposition, { action: "KEEP" }> =>
        result.action === "KEEP",
    ),

    release: results.filter(
      (
        result,
      ): result is Extract<
        AssignedResourceDisposition,
        { action: "RELEASE" }
      > => result.action === "RELEASE",
    ),

    canKeepAll: results.every((result) => result.action === "KEEP"),
  };
}
