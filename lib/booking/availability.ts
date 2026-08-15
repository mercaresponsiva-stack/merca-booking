import {
  getBlockedResourceIds,
  getOverlapWhere,
  isBusinessBlocked,
  isResourceTypeBlocked,
  isServiceBlocked,
} from "@/lib/booking/resource-availability";

import { ACTIVE_RESERVATION_STATUSES } from "@/lib/booking/reservation-state";

import { prisma } from "@/lib/prisma";

/*
 * Solo declaramos las partes de Prisma
 * que necesita este Core.
 *
 * Esto permite utilizar:
 *
 * - prisma global
 * - TransactionClient
 *
 * sin acoplar Availability a una ruta HTTP.
 */
export type BookingAvailabilityDb = Pick<
  typeof prisma,
  "service" | "reservationService" | "block"
>;

export type AvailabilityInput = {
  businessId: string;

  startAt: Date;
  endAt: Date;

  /*
   * Permite consultar uno o varios
   * Services específicos.
   *
   * Si se omite, se evalúan todos
   * los Services activos del Business.
   */
  serviceIds?: string[];

  /*
   * Fundamental para reprogramación.
   *
   * La reserva que estamos moviendo
   * no debe contarse como demanda
   * contra sí misma.
   */
  excludeReservationId?: string;

  /*
   * Por defecto usa prisma.
   *
   * Durante operaciones críticas,
   * como reschedule, podremos pasar
   * el TransactionClient.
   */
  db?: BookingAvailabilityDb;
};

export type ResourceTypeAvailability = {
  resourceTypeId: string;

  name: string;

  requiredQuantity: number;

  totalResources: number;

  assignedResources: number;

  blockedResources: number;

  unassignedResourceDemand: number;

  availableUnits: number;
};

export type ServiceAvailability = {
  serviceId: string;

  name: string;
  slug: string;

  description: string | null;

  available: number;

  resourceTypes: ResourceTypeAvailability[];
};

export async function getAvailability({
  businessId,
  startAt,
  endAt,
  serviceIds,
  excludeReservationId,
  db = prisma,
}: AvailabilityInput) {
  if (endAt <= startAt) {
    throw new Error("INVALID_AVAILABILITY_INTERVAL");
  }

  /*
   * Una lista explícitamente vacía
   * significa que no hay Services
   * que evaluar.
   */
  if (serviceIds && serviceIds.length === 0) {
    return {
      businessId,

      startAt,
      endAt,

      services: [] as ServiceAvailability[],
    };
  }

  // ─────────────────────────────────────────────
  // SERVICES
  //
  // Core no pregunta:
  //
  // - adultos
  // - niños
  // - noches
  // - tarifas
  // - tipo de negocio
  //
  // Solo necesita conocer los recursos
  // requeridos por cada Service.
  // ─────────────────────────────────────────────

  const services = await db.service.findMany({
    where: {
      businessId,

      isActive: true,

      ...(serviceIds
        ? {
            id: {
              in: serviceIds,
            },
          }
        : {}),
    },

    include: {
      resourceTypes: {
        include: {
          resourceType: {
            include: {
              resources: {
                where: {
                  isActive: true,
                },

                orderBy: {
                  name: "asc",
                },
              },
            },
          },
        },
      },
    },

    orderBy: {
      name: "asc",
    },
  });

  const results: ServiceAvailability[] = [];

  // ─────────────────────────────────────────────
  // EACH SERVICE
  // ─────────────────────────────────────────────

  for (const service of services) {
    /*
     * Este módulo calcula disponibilidad
     * basada en recursos físicos.
     *
     * Services sin ResourceType podrán
     * tener otra estrategia de disponibilidad
     * cuando integremos Schedule /
     * AvailabilityRule.
     */
    if (service.resourceTypes.length === 0) {
      continue;
    }

    // ───────────────────────────────────────────
    // OVERLAPPING DEMAND
    // ───────────────────────────────────────────

    const overlappingReservationServices = await db.reservationService.findMany(
      {
        where: {
          serviceId: service.id,

          reservation: {
            businessId,

            status: {
              in: [...ACTIVE_RESERVATION_STATUSES],
            },

            ...getOverlapWhere(startAt, endAt),

            ...(excludeReservationId
              ? {
                  id: {
                    not: excludeReservationId,
                  },
                }
              : {}),
          },
        },

        select: {
          id: true,

          quantity: true,

          resources: {
            select: {
              resourceId: true,

              resource: {
                select: {
                  resourceTypeId: true,
                },
              },
            },
          },
        },
      },
    );

    // ───────────────────────────────────────────
    // BLOCKS
    // ───────────────────────────────────────────

    const blocks = await db.block.findMany({
      where: {
        businessId,

        ...getOverlapWhere(startAt, endAt),

        OR: [
          {
            serviceId: null,
          },

          {
            serviceId: service.id,
          },

          /*
           * Un Resource físico
           * bloqueado debe respetarse
           * independientemente del
           * Service asociado al Block.
           */
          {
            resourceId: {
              not: null,
            },
          },
        ],
      },

      select: {
        serviceId: true,

        resourceTypeId: true,

        resourceId: true,
      },
    });

    // ───────────────────────────────────────────
    // BUSINESS BLOCK
    // ───────────────────────────────────────────

    if (isBusinessBlocked(blocks)) {
      continue;
    }

    // ───────────────────────────────────────────
    // SERVICE BLOCK
    // ───────────────────────────────────────────

    if (isServiceBlocked(blocks, service.id)) {
      continue;
    }

    // ───────────────────────────────────────────
    // RESOURCE REQUIREMENTS
    // ───────────────────────────────────────────

    const resourceAvailability: ResourceTypeAvailability[] = [];

    for (const requirement of service.resourceTypes) {
      const resourceType = requirement.resourceType;

      const resources = resourceType.resources;

      const requiredQuantity = Math.max(requirement.requiredQuantity, 1);

      const totalResources = resources.length;

      if (totalResources === 0) {
        resourceAvailability.push({
          resourceTypeId: resourceType.id,

          name: resourceType.name,

          requiredQuantity,

          totalResources: 0,

          assignedResources: 0,

          blockedResources: 0,

          unassignedResourceDemand: 0,

          availableUnits: 0,
        });

        continue;
      }

      const resourceIds = new Set(resources.map((resource) => resource.id));

      // ─────────────────────────────────────────
      // ASSIGNED RESOURCES
      // ─────────────────────────────────────────

      const assignedResourceIds = new Set<string>();

      for (const reservationService of overlappingReservationServices) {
        for (const reservationResource of reservationService.resources) {
          if (
            reservationResource.resource.resourceTypeId === resourceType.id &&
            resourceIds.has(reservationResource.resourceId)
          ) {
            assignedResourceIds.add(reservationResource.resourceId);
          }
        }
      }

      // ─────────────────────────────────────────
      // UNASSIGNED DEMAND
      // ─────────────────────────────────────────

      let unassignedResourceDemand = 0;

      for (const reservationService of overlappingReservationServices) {
        const assignedForThisType = reservationService.resources.filter(
          (reservationResource) =>
            reservationResource.resource.resourceTypeId === resourceType.id,
        ).length;

        const requiredForReservation =
          reservationService.quantity * requiredQuantity;

        const missingResources = Math.max(
          requiredForReservation - assignedForThisType,

          0,
        );

        unassignedResourceDemand += missingResources;
      }

      // ─────────────────────────────────────────
      // RESOURCE TYPE BLOCK
      // ─────────────────────────────────────────

      if (isResourceTypeBlocked(blocks, service.id, resourceType.id)) {
        resourceAvailability.push({
          resourceTypeId: resourceType.id,

          name: resourceType.name,

          requiredQuantity,

          totalResources,

          assignedResources: assignedResourceIds.size,

          blockedResources: totalResources,

          unassignedResourceDemand,

          availableUnits: 0,
        });

        continue;
      }

      // ─────────────────────────────────────────
      // RESOURCE BLOCKS
      // ─────────────────────────────────────────

      const blockedResourceIds = getBlockedResourceIds(blocks, resourceIds);

      // ─────────────────────────────────────────
      // PHYSICALLY FREE RESOURCES
      // ─────────────────────────────────────────

      const physicallyFreeResources = resources.filter(
        (resource) =>
          !assignedResourceIds.has(resource.id) &&
          !blockedResourceIds.has(resource.id),
      );

      /*
       * Una ReservationService todavía
       * sin Resource asignado sigue
       * consumiendo inventario.
       */
      const resourcesAfterDemand = Math.max(
        physicallyFreeResources.length - unassignedResourceDemand,

        0,
      );

      /*
       * Un Service podría requerir
       * más de una unidad del mismo
       * ResourceType.
       */
      const availableUnits = Math.floor(
        resourcesAfterDemand / requiredQuantity,
      );

      resourceAvailability.push({
        resourceTypeId: resourceType.id,

        name: resourceType.name,

        requiredQuantity,

        totalResources,

        assignedResources: assignedResourceIds.size,

        blockedResources: blockedResourceIds.size,

        unassignedResourceDemand,

        availableUnits,
      });
    }

    // ───────────────────────────────────────────
    // SERVICE AVAILABILITY
    //
    // Si requiere varios ResourceTypes,
    // el recurso más escaso determina
    // cuántas unidades pueden venderse.
    // ───────────────────────────────────────────

    const available = Math.min(
      ...resourceAvailability.map(
        (resourceType) => resourceType.availableUnits,
      ),
    );

    if (available <= 0) {
      continue;
    }

    results.push({
      serviceId: service.id,

      name: service.name,

      slug: service.slug,

      description: service.description,

      available,

      resourceTypes: resourceAvailability,
    });
  }

  return {
    businessId,

    startAt,
    endAt,

    services: results,
  };
}
