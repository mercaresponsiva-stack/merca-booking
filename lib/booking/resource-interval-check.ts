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

  const overlappingAssignment = await db.reservationResource.findFirst({
    where: {
      resourceId,

      reservationId: {
        not: reservationId,
      },

      reservation: {
        businessId,

        status: {
          in: [...ACTIVE_RESERVATION_STATUSES],
        },

        ...getOverlapWhere(startAt, endAt),
      },
    },

    select: {
      reservation: {
        select: {
          id: true,

          confirmationCode: true,
        },
      },
    },
  });

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
    const assignmentStartAt =
      assignment.reservationOption
        ?.startAt ??
      startAt;

    const assignmentEndAt =
      assignment.reservationOption
        ?.endAt ??
      endAt;

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
        assignmentStartAt,

      endAt:
        assignmentEndAt,

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
