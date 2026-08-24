import {
  getBlockedResourceIds,
  getOverlapWhere,
  isBusinessBlocked,
  isResourceTypeBlocked,
  isServiceBlocked,
} from "@/lib/booking/resource-availability";

import {
  getReservationOptionInventoryDemand,
} from "@/lib/booking/option-inventory-demand";

import {
  ACTIVE_RESERVATION_STATUSES,
} from "@/lib/booking/reservation-state";

import { prisma } from "@/lib/prisma";

export type ResourceTypeInventoryDb =
  Pick<
    typeof prisma,
    | "resource"
    | "reservation"
    | "reservationService"
    | "reservationOption"
    | "serviceResourceType"
    | "serviceOptionResourceType"
    | "reservationResource"
    | "block"
  >;

export type ResourceTypeInventoryState = {
  resourceTypeId: string;

  totalResources: number;

  assignedResourceIds: string[];
  assignedResourceCount: number;

  blockedResourceIds: string[];
  blockedResourceCount: number;

  serviceUnassignedResourceDemand:
    number;

  optionUnassignedResourceDemand:
    number;

  unassignedResourceDemand:
    number;

  availableResourceIds: string[];
  availableResourceCount: number;
};

type GetResourceTypeInventoryStateInput = {
  businessId: string;

  resourceTypeId: string;

  startAt: Date;
  endAt: Date;

  /*
   * Contexto del Service que desea
   * utilizar el inventario.
   *
   * Es necesario para respetar Blocks
   * específicos de un Service.
   */
  serviceId?: string;

  /*
   * Utilizado principalmente durante
   * reprogramaciones.
   */
  excludeReservationId?: string;

  db?: ResourceTypeInventoryDb;
};

export async function getResourceTypeInventoryState({
  businessId,

  resourceTypeId,

  startAt,
  endAt,

  serviceId,

  excludeReservationId,

  db = prisma,
}: GetResourceTypeInventoryStateInput): Promise<ResourceTypeInventoryState> {
  if (
    endAt <=
    startAt
  ) {
    throw new Error(
      "INVALID_RESOURCE_TYPE_INVENTORY_INTERVAL",
    );
  }

  /*
   * Pool físico vendible.
   *
   * Los Resources inactivos no forman
   * parte de inventario nuevo.
   */
  const resources =
    await db.resource.findMany({
      where: {
        businessId,

        resourceTypeId,

        isActive:
          true,
      },

      select: {
        id: true,
      },

      orderBy: {
        id: "asc",
      },
    });

  const activeResourceIds =
    new Set(
      resources.map(
        (resource) =>
          resource.id,
      ),
    );

  /*
   * Demanda obligatoria originada por
   * ReservationService.
   *
   * Los filtros permanecen en SQL.
   * Requisitos y assignments se cargan
   * mediante consultas raíz secuenciales.
   */
  const reservationServices =
    await db.reservationService.findMany({
      where: {
        service: {
          businessId,

          resourceTypes: {
            some: {
              resourceTypeId,
            },
          },
        },

        reservation: {
          businessId,

          status: {
            in: [
              ...ACTIVE_RESERVATION_STATUSES,
            ],
          },

          ...getOverlapWhere(
            startAt,
            endAt,
          ),

          ...(excludeReservationId
            ? {
                id: {
                  not:
                    excludeReservationId,
                },
              }
            : {}),
        },
      },

      select: {
        id:
          true,

        serviceId:
          true,

        quantity:
          true,
      },
    });

  const reservationServiceIds =
    reservationServices.map(
      (reservationService) =>
        reservationService.id,
    );

  const serviceIds = [
    ...new Set(
      reservationServices.map(
        (reservationService) =>
          reservationService.serviceId,
      ),
    ),
  ];

  const serviceRequirements =
    serviceIds.length > 0
      ? await db.serviceResourceType.findMany({
          where: {
            serviceId: {
              in:
                serviceIds,
            },

            resourceTypeId,
          },

          select: {
            serviceId:
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

  const serviceAssignments =
    reservationServiceIds.length > 0
      ? await db.reservationResource.findMany({
          where: {
            reservationServiceId: {
              in:
                reservationServiceIds,
            },

            resource: {
              resourceTypeId,
            },
          },

          select: {
            reservationServiceId:
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

  const requirementByServiceId =
    new Map<
      string,
      (typeof serviceRequirements)[number]
    >();

  for (
    const requirement of
    serviceRequirements
  ) {
    requirementByServiceId.set(
      requirement.serviceId,
      requirement,
    );
  }

  const assignedIdsByReservationServiceId =
    new Map<
      string,
      string[]
    >();

  for (
    const assignment of
    serviceAssignments
  ) {
    if (
      !assignment.reservationServiceId
    ) {
      continue;
    }

    const current =
      assignedIdsByReservationServiceId.get(
        assignment.reservationServiceId,
      ) ?? [];

    current.push(
      assignment.resourceId,
    );

    assignedIdsByReservationServiceId.set(
      assignment.reservationServiceId,
      current,
    );
  }

  const serviceAssignedResourceIds =
    new Set<string>();

  let serviceUnassignedResourceDemand =
    0;

  for (
    const reservationService of
    reservationServices
  ) {
    const requirement =
      requirementByServiceId.get(
        reservationService.serviceId,
      );

    if (!requirement) {
      continue;
    }

    const requiredQuantity =
      Math.max(
        requirement.requiredQuantity,
        1,
      );

    const requiredResources =
      Math.max(
        reservationService.quantity,
        0,
      ) *
      requiredQuantity;

    const assignedIds = [
      ...new Set(
        assignedIdsByReservationServiceId.get(
          reservationService.id,
        ) ?? [],
      ),
    ];

    for (
      const resourceId of
      assignedIds
    ) {
      serviceAssignedResourceIds.add(
        resourceId,
      );
    }

    serviceUnassignedResourceDemand +=
      Math.max(
        requiredResources -
          assignedIds.length,

        0,
      );
  }

  /*
   * Demanda originada por opciones.
   *
   * Este helper ya resuelve:
   *
   * - quantity
   * - requiredQuantity
   * - Resource assignments
   * - intervalo propio
   * - intervalo heredado
   * - excludeReservationId
   */
  const optionDemand =
    await getReservationOptionInventoryDemand({
      businessId,

      resourceTypeId,

      startAt,
      endAt,

      excludeReservationId,

      db,
    });

  /*
   * Una asignación física ocupa el
   * Resource independientemente de si
   * nació de:
   *
   * ReservationService
   * o
   * ReservationOption.
   */
  const assignedResourceIds =
    new Set<string>([
      ...serviceAssignedResourceIds,

      ...optionDemand
        .assignedResourceIds,
    ]);

  /*
   * Blocks relevantes para el contexto.
   *
   * Un Block específico de otro Service
   * no debe bloquear este Service.
   *
   * Un Block de Resource físico sí debe
   * respetarse globalmente.
   */
  const blocks =
    await db.block.findMany({
      where: {
        businessId,

        ...getOverlapWhere(
          startAt,
          endAt,
        ),

        OR: [
          {
            serviceId:
              null,
          },

          ...(serviceId
            ? [
                {
                  serviceId,
                },
              ]
            : []),

          {
            resourceId: {
              not:
                null,
            },
          },
        ],
      },

      select: {
        serviceId:
          true,

        resourceTypeId:
          true,

        resourceId:
          true,
      },
    });

  const businessBlocked =
    isBusinessBlocked(
      blocks,
    );

  const serviceBlocked =
    serviceId
      ? isServiceBlocked(
          blocks,
          serviceId,
        )
      : false;

  const resourceTypeBlocked =
    serviceId
      ? isResourceTypeBlocked(
          blocks,

          serviceId,

          resourceTypeId,
        )
      : blocks.some(
          (block) =>
            block.resourceId ===
              null &&
            block.resourceTypeId ===
              resourceTypeId &&
            block.serviceId ===
              null,
        );

  const specificallyBlockedResourceIds =
    getBlockedResourceIds(
      blocks,
      activeResourceIds,
    );

  const blockedResourceIds =
    businessBlocked ||
    serviceBlocked ||
    resourceTypeBlocked
      ? new Set(
          activeResourceIds,
        )
      : specificallyBlockedResourceIds;

  /*
   * Solo los Resources activos forman
   * parte del pool vendible.
   *
   * Una asignación histórica a un
   * Resource ahora inactivo no resta
   * nuevamente del pool activo.
   */
  const physicallyAvailableResourceIds =
    resources
      .map(
        (resource) =>
          resource.id,
      )
      .filter(
        (resourceId) =>
          !assignedResourceIds.has(
            resourceId,
          ) &&
          !blockedResourceIds.has(
            resourceId,
          ),
      );

  const optionUnassignedResourceDemand =
    optionDemand
      .unassignedResourceDemand;

  const unassignedResourceDemand =
    serviceUnassignedResourceDemand +
    optionUnassignedResourceDemand;

  /*
   * La demanda pendiente también ocupa
   * capacidad aunque aún no sepamos qué
   * Resource concreto será asignado.
   */
  const availableResourceCount =
    Math.max(
      physicallyAvailableResourceIds
        .length -
        unassignedResourceDemand,

      0,
    );

  /*
   * Los IDs concretos después de demanda
   * pendiente son solo representativos:
   * todavía no sabemos cuáles terminarán
   * asignándose.
   *
   * Son útiles para conteo/diagnóstico,
   * pero la asignación definitiva siempre
   * debe volver a validar disponibilidad.
   */
  const availableResourceIds =
    physicallyAvailableResourceIds.slice(
      0,
      availableResourceCount,
    );

  return {
    resourceTypeId,

    totalResources:
      resources.length,

    assignedResourceIds: [
      ...assignedResourceIds,
    ],

    assignedResourceCount:
      [
        ...assignedResourceIds,
      ].filter(
        (resourceId) =>
          activeResourceIds.has(
            resourceId,
          ),
      ).length,

    blockedResourceIds: [
      ...blockedResourceIds,
    ],

    blockedResourceCount:
      blockedResourceIds.size,

    serviceUnassignedResourceDemand,

    optionUnassignedResourceDemand,

    unassignedResourceDemand,

    availableResourceIds,

    availableResourceCount,
  };
}
