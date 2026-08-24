import {
  getOverlapWhere,
  isResourceBlocked,
} from "@/lib/booking/resource-availability";

import { ACTIVE_RESERVATION_STATUSES } from "@/lib/booking/reservation-state";

import { prisma } from "@/lib/prisma";

export type ResourceIntervalCheckDb = Pick<
  typeof prisma,
  | "reservationResource"
  | "reservation"
  | "reservationOption"
  | "reservationService"
  | "resource"
  | "block"
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
  /*
   * Las relaciones se cargan mediante
   * consultas escalares secuenciales.
   *
   * Esto evita que Prisma adapter-pg
   * ejecute varias consultas de relación
   * simultáneamente sobre el mismo Client
   * de una transacción interactiva.
   */
  const assignmentCandidates =
    await db.reservationResource.findMany({
      where: {
        resourceId,

        reservationId: {
          not:
            reservationId,
        },
      },

      select: {
        reservationId:
          true,

        reservationOptionId:
          true,
      },
    });

  const candidateReservationIds =
    [
      ...new Set(
        assignmentCandidates.map(
          (
            assignment,
          ) =>
            assignment.reservationId,
        ),
      ),
    ];

  const candidateReservations =
    candidateReservationIds.length ===
    0
      ? []
      : await db.reservation.findMany({
          where: {
            id: {
              in:
                candidateReservationIds,
            },

            businessId,

            status: {
              in: [
                ...ACTIVE_RESERVATION_STATUSES,
              ],
            },
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
          },
        });

  const candidateReservationsById =
    new Map<
      string,
      (typeof candidateReservations)[number]
    >();

  for (
    const reservation of
    candidateReservations
  ) {
    candidateReservationsById.set(
      reservation.id,
      reservation,
    );
  }

  const relevantAssignmentCandidates =
    assignmentCandidates.filter(
      (
        assignment,
      ) =>
        candidateReservationsById.has(
          assignment.reservationId,
        ),
    );

  const candidateOptionIds =
    new Set<string>();

  for (
    const assignment of
    relevantAssignmentCandidates
  ) {
    if (
      assignment.reservationOptionId
    ) {
      candidateOptionIds.add(
        assignment.reservationOptionId,
      );
    }
  }

  const candidateOptions =
    candidateOptionIds.size ===
    0
      ? []
      : await db.reservationOption.findMany({
          where: {
            id: {
              in: [
                ...candidateOptionIds,
              ],
            },
          },

          select: {
            id:
              true,

            startAt:
              true,

            endAt:
              true,
          },
        });

  const candidateOptionsById =
    new Map<
      string,
      (typeof candidateOptions)[number]
    >();

  for (
    const option of
    candidateOptions
  ) {
    candidateOptionsById.set(
      option.id,
      option,
    );
  }

  let overlappingReservation:
    | (typeof candidateReservations)[number]
    | null =
    null;

  for (
    const assignment of
    relevantAssignmentCandidates
  ) {
    const candidateReservation =
      candidateReservationsById.get(
        assignment.reservationId,
      );

    if (
      !candidateReservation
    ) {
      continue;
    }

    const candidateOption =
      assignment.reservationOptionId
        ? candidateOptionsById.get(
            assignment.reservationOptionId,
          ) ??
          null
        : null;

    const effectiveInterval =
      resolveAssignedResourceEffectiveInterval({
        reservationStartAt:
          candidateReservation.startAt,

        reservationEndAt:
          candidateReservation.endAt,

        optionStartAt:
          candidateOption?.startAt ??
          null,

        optionEndAt:
          candidateOption?.endAt ??
          null,
      });

    if (
      intervalsOverlap(
        effectiveInterval.startAt,
        effectiveInterval.endAt,
        startAt,
        endAt,
      )
    ) {
      overlappingReservation =
        candidateReservation;

      break;
    }
  }

  if (
    overlappingReservation
  ) {
    return {
      available: false,

      reason:
        "RESOURCE_ALREADY_OCCUPIED",

      conflictReservation: {
        id:
          overlappingReservation.id,

        confirmationCode:
          overlappingReservation.confirmationCode,
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
  /*
   * Primero recuperamos únicamente las
   * llaves persistidas de cada asignación.
   *
   * Después cargamos Resource,
   * ReservationOption y ReservationService
   * mediante consultas escalares esperadas
   * secuencialmente.
   */
  const assignments =
    await db.reservationResource.findMany({
      where: {
        reservationId,
      },

      select: {
        id:
          true,

        resourceId:
          true,

        reservationServiceId:
          true,

        reservationOptionId:
          true,
      },
    });

  const resourceIds =
    [
      ...new Set(
        assignments.map(
          (
            assignment,
          ) =>
            assignment.resourceId,
        ),
      ),
    ];

  const resources =
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

            isActive:
              true,

            resourceTypeId:
              true,
          },
        });

  const resourcesById =
    new Map<
      string,
      (typeof resources)[number]
    >();

  for (
    const resource of
    resources
  ) {
    resourcesById.set(
      resource.id,
      resource,
    );
  }

  const reservationOptionIds =
    new Set<string>();

  for (
    const assignment of
    assignments
  ) {
    if (
      assignment.reservationOptionId
    ) {
      reservationOptionIds.add(
        assignment.reservationOptionId,
      );
    }
  }

  const reservationOptions =
    reservationOptionIds.size ===
    0
      ? []
      : await db.reservationOption.findMany({
          where: {
            id: {
              in: [
                ...reservationOptionIds,
              ],
            },
          },

          select: {
            id:
              true,

            reservationServiceId:
              true,

            startAt:
              true,

            endAt:
              true,
          },
        });

  const reservationOptionsById =
    new Map<
      string,
      (typeof reservationOptions)[number]
    >();

  for (
    const reservationOption of
    reservationOptions
  ) {
    reservationOptionsById.set(
      reservationOption.id,
      reservationOption,
    );
  }

  const reservationServiceIds =
    new Set<string>();

  for (
    const assignment of
    assignments
  ) {
    if (
      assignment.reservationServiceId
    ) {
      reservationServiceIds.add(
        assignment.reservationServiceId,
      );
    }
  }

  for (
    const reservationOption of
    reservationOptions
  ) {
    if (
      reservationOption.reservationServiceId
    ) {
      reservationServiceIds.add(
        reservationOption.reservationServiceId,
      );
    }
  }

  const reservationServices =
    reservationServiceIds.size ===
    0
      ? []
      : await db.reservationService.findMany({
          where: {
            id: {
              in: [
                ...reservationServiceIds,
              ],
            },
          },

          select: {
            id:
              true,

            serviceId:
              true,
          },
        });

  const reservationServicesById =
    new Map<
      string,
      (typeof reservationServices)[number]
    >();

  for (
    const reservationService of
    reservationServices
  ) {
    reservationServicesById.set(
      reservationService.id,
      reservationService,
    );
  }

  const results:
    AssignedResourceDisposition[] =
    [];

  for (
    const assignment of
    assignments
  ) {
    const resource =
      resourcesById.get(
        assignment.resourceId,
      );

    if (
      !resource
    ) {
      throw new Error(
        "RESERVATION_RESOURCE_RESOURCE_NOT_FOUND",
      );
    }

    const reservationOption =
      assignment.reservationOptionId
        ? reservationOptionsById.get(
            assignment.reservationOptionId,
          ) ??
          null
        : null;

    const directServiceId =
      assignment.reservationServiceId
        ? reservationServicesById.get(
            assignment.reservationServiceId,
          )
            ?.serviceId ??
          null
        : null;

    const optionReservationServiceId =
      reservationOption
        ?.reservationServiceId ??
      null;

    const optionServiceId =
      optionReservationServiceId
        ? reservationServicesById.get(
            optionReservationServiceId,
          )
            ?.serviceId ??
          null
        : null;

    const serviceId =
      directServiceId ??
      optionServiceId;

    const resourceTypeId =
      resource.resourceTypeId ??
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
          reservationOption
            ?.startAt ??
          null,

        optionEndAt:
          reservationOption
            ?.endAt ??
          null,
      });

    // ───────────────────────────────────────────
    // INACTIVE RESOURCE
    // ───────────────────────────────────────────

    if (
      !resource.isActive
    ) {
      results.push({
        action:
          "RELEASE",

        assignmentId:
          assignment.id,

        resourceId:
          assignment.resourceId,

        serviceId,

        resourceTypeId,

        reason:
          "RESOURCE_INACTIVE",
      });

      continue;
    }

    // ───────────────────────────────────────────
    // RESOURCE TYPE REQUIRED
    // ───────────────────────────────────────────

    if (
      !resourceTypeId
    ) {
      results.push({
        action:
          "RELEASE",

        assignmentId:
          assignment.id,

        resourceId:
          assignment.resourceId,

        serviceId,

        resourceTypeId:
          null,

        reason:
          "RESOURCE_TYPE_NOT_CONFIGURED",
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

    if (
      !serviceId
    ) {
      results.push({
        action:
          "RELEASE",

        assignmentId:
          assignment.id,

        resourceId:
          assignment.resourceId,

        serviceId:
          null,

        resourceTypeId,

        reason:
          "RESERVATION_SERVICE_NOT_LINKED",
      });

      continue;
    }

    // ───────────────────────────────────────────
    // NEW INTERVAL
    // ───────────────────────────────────────────

    const availability =
      await checkResourceForInterval({
        businessId,

        reservationId,

        serviceId,

        resourceTypeId,

        resourceId:
          assignment.resourceId,

        startAt:
          assignmentInterval.startAt,

        endAt:
          assignmentInterval.endAt,

        db,
      });

    if (
      !availability.available
    ) {
      results.push({
        action:
          "RELEASE",

        assignmentId:
          assignment.id,

        resourceId:
          assignment.resourceId,

        serviceId,

        resourceTypeId,

        reason:
          availability.reason,

        ...(availability.conflictReservation
          ? {
              conflictReservation:
                availability.conflictReservation,
            }
          : {}),
      });

      continue;
    }

    results.push({
      action:
        "KEEP",

      assignmentId:
        assignment.id,

      resourceId:
        assignment.resourceId,

      serviceId,

      resourceTypeId,
    });
  }

  return {
    assignments:
      results,

    keep:
      results.filter(
        (
          result,
        ): result is Extract<
          AssignedResourceDisposition,
          {
            action:
              "KEEP";
          }
        > =>
          result.action ===
          "KEEP",
      ),

    release:
      results.filter(
        (
          result,
        ): result is Extract<
          AssignedResourceDisposition,
          {
            action:
              "RELEASE";
          }
        > =>
          result.action ===
          "RELEASE",
      ),

    canKeepAll:
      results.every(
        (
          result,
        ) =>
          result.action ===
          "KEEP",
      ),
  };
}
