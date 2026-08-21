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
  "reservationOption"
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
        id: true,

        includedQuantity: true,
        optionalQuantity: true,
        removedOptionalQuantity: true,

        startAt: true,
        endAt: true,

        reservation: {
          select: {
            id: true,

            startAt: true,
            endAt: true,
          },
        },

        serviceOption: {
          select: {
            resourceTypes: {
              where: {
                resourceTypeId,
              },

              select: {
                requiredQuantity:
                  true,
              },
            },
          },
        },

        resources: {
          where: {
            resource: {
              resourceTypeId,
            },
          },

          select: {
            resourceId: true,
          },
        },
      },
    });

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
    const option of candidates
  ) {
    const effectiveStartAt =
      option.startAt ??
      option.reservation
        .startAt;

    const effectiveEndAt =
      option.endAt ??
      option.reservation
        .endAt;

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
      option.serviceOption
        ?.resourceTypes[0];

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

    const optionAssignedIds =
      [
        ...new Set(
          option.resources.map(
            (
              resource,
            ) =>
              resource.resourceId,
          ),
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
        option.reservation.id,

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
