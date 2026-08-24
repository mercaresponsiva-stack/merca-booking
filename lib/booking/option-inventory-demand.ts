import { ACTIVE_RESERVATION_STATUSES } from "@/lib/booking/reservation-state";

import {
  resolveReservationOptionActiveQuantity,
} from "@/lib/booking/reservation-option-quantity";

import { prisma } from "@/lib/prisma";

/*
 * Solo necesitamos el delegate de ReservationOption.
 *
 * Igual que availability.ts, esto permite utilizar
 * tanto prisma global como un TransactionClient.
 */
export type OptionInventoryDemandDb = Pick<
  typeof prisma,
  | "reservationOption"
  | "reservation"
  | "serviceOptionResourceType"
  | "reservationResource"
>;

export type ReservationOptionDemandItem = {
  reservationOptionId: string;
  reservationId: string;

  startAt: Date;
  endAt: Date;

  quantity: number;
  requiredQuantity: number;

  requiredResources: number;
  assignedResources: number;
  unassignedResources: number;

  assignedResourceIds: string[];
};

export type ReservationOptionInventoryDemand = {
  resourceTypeId: string;

  totalDemand: number;

  assignedResourceIds: string[];
  assignedResourceCount: number;

  unassignedResourceDemand: number;

  reservationOptions:
    ReservationOptionDemandItem[];
};

type GetReservationOptionInventoryDemandInput = {
  businessId: string;

  resourceTypeId: string;

  startAt: Date;
  endAt: Date;

  excludeReservationId?: string;

  db?: OptionInventoryDemandDb;
};

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

export async function getReservationOptionInventoryDemand({
  businessId,

  resourceTypeId,

  startAt,
  endAt,

  excludeReservationId,

  db = prisma,
}: GetReservationOptionInventoryDemandInput): Promise<ReservationOptionInventoryDemand> {
  if (
    endAt <=
    startAt
  ) {
    throw new Error(
      "INVALID_OPTION_DEMAND_INTERVAL",
    );
  }

  /*
   * No podemos resolver completamente
   * el intervalo efectivo dentro de SQL:
   *
   * ReservationOption.startAt ?? Reservation.startAt
   * ReservationOption.endAt   ?? Reservation.endAt
   *
   * Por eso recuperamos únicamente
   * candidatos relevantes para este
   * ResourceType y luego hacemos el
   * overlap exacto en memoria.
   */
  /*
   * Recuperamos únicamente campos escalares.
   *
   * Reservation, requisitos y assignments
   * se consultan después mediante delegates
   * raíz y de forma secuencial.
   */
  const candidates =
    await db.reservationOption.findMany({
      where: {
        reservation: {
          businessId,

          status: {
            in: [
              ...ACTIVE_RESERVATION_STATUSES,
            ],
          },

          ...(excludeReservationId
            ? {
                id: {
                  not:
                    excludeReservationId,
                },
              }
            : {}),
        },

        serviceOption: {
          is: {
            resourceTypes: {
              some: {
                resourceTypeId,
              },
            },
          },
        },
      },

      select: {
        id:
          true,

        reservationId:
          true,

        serviceOptionId:
          true,

        includedQuantity:
          true,

        optionalQuantity:
          true,

        removedOptionalQuantity:
          true,

        startAt:
          true,

        endAt:
          true,
      },
    });

  const reservationIds = [
    ...new Set(
      candidates.map(
        (option) =>
          option.reservationId,
      ),
    ),
  ];

  const serviceOptionIds = [
    ...new Set(
      candidates.flatMap(
        (option) =>
          option.serviceOptionId
            ? [option.serviceOptionId]
            : [],
      ),
    ),
  ];

  const reservationOptionIds =
    candidates.map(
      (option) =>
        option.id,
    );

  const reservations =
    reservationIds.length > 0
      ? await db.reservation.findMany({
          where: {
            id: {
              in:
                reservationIds,
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

          orderBy: {
            id:
              "asc",
          },
        })
      : [];

  const requirements =
    serviceOptionIds.length > 0
      ? await db.serviceOptionResourceType.findMany({
          where: {
            serviceOptionId: {
              in:
                serviceOptionIds,
            },

            resourceTypeId,
          },

          select: {
            serviceOptionId:
              true,

            requiredQuantity:
              true,
          },

          orderBy: {
            id:
              "asc",
          },
        })
      : [];

  const assignments =
    reservationOptionIds.length > 0
      ? await db.reservationResource.findMany({
          where: {
            reservationOptionId: {
              in:
                reservationOptionIds,
            },

            resource: {
              resourceTypeId,
            },
          },

          select: {
            reservationOptionId:
              true,

            resourceId:
              true,
          },

          orderBy: {
            id:
              "asc",
          },
        })
      : [];

  const reservationById =
    new Map<
      string,
      (typeof reservations)[number]
    >();

  for (
    const reservation of
    reservations
  ) {
    reservationById.set(
      reservation.id,
      reservation,
    );
  }

  const requirementByServiceOptionId =
    new Map<
      string,
      (typeof requirements)[number]
    >();

  for (
    const requirement of
    requirements
  ) {
    requirementByServiceOptionId.set(
      requirement.serviceOptionId,
      requirement,
    );
  }

  const assignedIdsByReservationOptionId =
    new Map<
      string,
      string[]
    >();

  for (
    const assignment of
    assignments
  ) {
    if (
      !assignment.reservationOptionId
    ) {
      continue;
    }

    const current =
      assignedIdsByReservationOptionId.get(
        assignment.reservationOptionId,
      ) ?? [];

    current.push(
      assignment.resourceId,
    );

    assignedIdsByReservationOptionId.set(
      assignment.reservationOptionId,
      current,
    );
  }

  const reservationOptions:
    ReservationOptionDemandItem[] =
    [];

  const assignedResourceIds =
    new Set<string>();

  let totalDemand =
    0;

  let unassignedResourceDemand =
    0;

  for (
    const option of
    candidates
  ) {
    const reservation =
      reservationById.get(
        option.reservationId,
      );

    if (!reservation) {
      throw new Error(
        "RESERVATION_OPTION_RESERVATION_NOT_FOUND",
      );
    }

    const effectiveStartAt =
      option.startAt ??
      reservation.startAt;

    const effectiveEndAt =
      option.endAt ??
      reservation.endAt;

    if (
      effectiveEndAt <=
      effectiveStartAt
    ) {
      throw new Error(
        "INVALID_RESERVATION_OPTION_INTERVAL",
      );
    }

    if (
      !intervalsOverlap(
        effectiveStartAt,
        effectiveEndAt,

        startAt,
        endAt,
      )
    ) {
      continue;
    }

    /*
     * La relacion es unica por:
     *
     * ServiceOption + ResourceType
     *
     * por lo que esperamos como maximo
     * un requisito de este tipo.
     */
    const requirement =
      option.serviceOptionId
        ? requirementByServiceOptionId.get(
            option.serviceOptionId,
          )
        : undefined;

    if (!requirement) {
      continue;
    }

    /*
     * ReservationOption conserva las
     * cantidades originales del snapshot.
     *
     * El inventario debe considerar solo
     * aquello que sigue contractualmente
     * activo después de OPTION_REMOVED.
     */
    const activeQuantity =
      resolveReservationOptionActiveQuantity({
        includedQuantity:
          option.includedQuantity,

        optionalQuantity:
          option.optionalQuantity,

        removedOptionalQuantity:
          option.removedOptionalQuantity,
      });

    const quantity =
      activeQuantity
        .activeQuantity;

    /*
     * Una Option puramente opcional que fue
     * retirada por completo ya no consume
     * ningún recurso físico.
     *
     * Tampoco propagamos ReservationResource
     * históricos/stale hacia el inventario:
     * OPTION_REMOVED será responsable de
     * eliminar esas asignaciones.
     */
    if (
      quantity ===
      0
    ) {
      continue;
    }

    const requiredQuantity =
      Math.max(
        requirement.requiredQuantity,
        1,
      );

    const requiredResources =
      quantity *
      requiredQuantity;

    const optionAssignedIds = [
      ...new Set(
        assignedIdsByReservationOptionId.get(
          option.id,
        ) ?? [],
      ),
    ];

    const assignedResources =
      optionAssignedIds.length;

    const unassignedResources =
      Math.max(
        requiredResources -
          assignedResources,

        0,
      );

    for (
      const resourceId of
      optionAssignedIds
    ) {
      assignedResourceIds.add(
        resourceId,
      );
    }

    totalDemand +=
      requiredResources;

    unassignedResourceDemand +=
      unassignedResources;

    reservationOptions.push({
      reservationOptionId:
        option.id,

      reservationId:
        reservation.id,

      startAt:
        effectiveStartAt,

      endAt:
        effectiveEndAt,

      quantity,

      requiredQuantity,

      requiredResources,

      assignedResources,

      unassignedResources,

      assignedResourceIds:
        optionAssignedIds,
    });
  }

  return {
    resourceTypeId,

    totalDemand,

    assignedResourceIds: [
      ...assignedResourceIds,
    ],

    assignedResourceCount:
      assignedResourceIds.size,

    unassignedResourceDemand,

    reservationOptions,
  };
}
