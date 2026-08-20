import {
  getOverlapWhere,
  isBusinessBlocked,
  isServiceBlocked,
} from "@/lib/booking/resource-availability";

import {
  getResourceTypeInventoryState,
} from "@/lib/booking/resource-type-inventory";

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
  | "service"
  | "resource"
  | "reservationService"
  | "reservationOption"
  | "block"
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
   * Normalmente un Service inactivo
   * no debe formar parte de la
   * disponibilidad vendible.
   *
   * Operaciones sobre reservas ya
   * existentes, como reschedule,
   * pueden habilitarlo explícitamente.
   */
  includeInactiveServices?: boolean;

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
  includeInactiveServices = false,
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

      ...(!includeInactiveServices
        ? {
            isActive: true,
          }
        : {}),

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
      const resourceType =
        requirement.resourceType;

      const requiredQuantity =
        Math.max(
          requirement.requiredQuantity,
          1,
        );

      /*
       * La fuente de verdad física ya
       * no vive dentro del Service.
       *
       * El ResourceType representa un
       * pool global que puede estar
       * siendo consumido por:
       *
       * - ReservationService
       * - ReservationOption
       * - varios Services distintos
       *
       * además de Blocks y asignaciones
       * físicas concretas.
       */
      const inventory =
        await getResourceTypeInventoryState({
          businessId,

          resourceTypeId:
            resourceType.id,

          startAt,
          endAt,

          serviceId:
            service.id,

          excludeReservationId,

          db,
        });

      /*
       * availableResourceCount expresa
       * unidades físicas todavía libres.
       *
       * Si una nueva unidad del Service
       * requiere más de un Resource del
       * mismo tipo, dividimos el pool
       * restante entre ese requisito.
       */
      const availableUnits =
        Math.floor(
          inventory.availableResourceCount /
            requiredQuantity,
        );

      resourceAvailability.push({
        resourceTypeId:
          resourceType.id,

        name:
          resourceType.name,

        requiredQuantity,

        totalResources:
          inventory.totalResources,

        assignedResources:
          inventory.assignedResourceCount,

        blockedResources:
          inventory.blockedResourceCount,

        unassignedResourceDemand:
          inventory.unassignedResourceDemand,

        availableUnits,
      });
    }

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
