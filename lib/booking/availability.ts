import {
  getBlockedResourceIds,
  getOverlapWhere,
  isBusinessBlocked,
  isResourceTypeBlocked,
  isServiceBlocked,
} from "@/lib/booking/resource-availability";

import { ACTIVE_RESERVATION_STATUSES } from "@/lib/booking/reservation-state";

import { prisma } from "@/lib/prisma";

type AvailabilityInput = {
  businessId: string;
  checkIn: Date;
  checkOut: Date;
  adults: number;
  children: number;
};

type ResourceTypeAvailability = {
  resourceTypeId: string;
  name: string;
  requiredQuantity: number;
  totalResources: number;
  assignedResources: number;
  blockedResources: number;
  unassignedResourceDemand: number;
  availableUnits: number;
};

type AvailabilityResult = {
  serviceId: string;
  name: string;
  slug: string;
  description: string | null;

  maxPeople: number;
  maxAdults: number | null;
  maxChildren: number | null;

  available: number;

  resourceTypes: ResourceTypeAvailability[];

  pricing: {
    nightlyPrices: number[];
    total: number;
  };

  total: number;
};

export async function getAvailability({
  businessId,
  checkIn,
  checkOut,
  adults,
  children,
}: AvailabilityInput) {
  const totalGuests = adults + children;

  if (checkOut <= checkIn) {
    throw new Error(
      "La fecha de salida debe ser posterior a la fecha de entrada.",
    );
  }

  // ─────────────────────────────────────────────
  // SERVICES
  //
  // Para hotel:
  // Service = Habitación Standard / Deluxe / Suite
  //
  // Cada Service indica qué ResourceType necesita mediante
  // ServiceResourceType.
  // ─────────────────────────────────────────────

  const services = await prisma.service.findMany({
    where: {
      businessId,
      isActive: true,

      maxPeople: {
        gte: totalGuests,
      },

      maxAdults: {
        gte: adults,
      },

      maxChildren: {
        gte: children,
      },
    },

    include: {
      rates: {
        where: {
          isActive: true,

          startDate: {
            lte: checkOut,
          },

          endDate: {
            gte: checkIn,
          },
        },

        orderBy: {
          startDate: "desc",
        },
      },

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

  const results: AvailabilityResult[] = [];

  // ─────────────────────────────────────────────
  // EVALUATE EACH SERVICE
  // ─────────────────────────────────────────────

  for (const service of services) {
    if (service.resourceTypes.length === 0) {
      continue;
    }

    // ───────────────────────────────────────────
    // OVERLAPPING RESERVATIONS
    //
    // Importante:
    //
    // No contamos solamente ReservationResource.
    //
    // ReservationService representa la demanda real.
    // Esto permite que una reserva SIN recurso físico
    // asignado siga consumiendo disponibilidad.
    //
    // Ejemplo actual:
    //
    // Juan  → Standard → 101
    // Maria → Standard → sin Resource
    //
    // Ambos consumen una habitación.
    // ───────────────────────────────────────────

    const overlappingReservationServices =
      await prisma.reservationService.findMany({
        where: {
          serviceId: service.id,

          reservation: {
            businessId,

            status: {
              in: [...ACTIVE_RESERVATION_STATUSES],
            },

            ...getOverlapWhere(checkIn, checkOut),
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
      });

    // ───────────────────────────────────────────
    // BLOCKS
    //
    // Puede existir:
    //
    // business completo
    // service completo
    // resourceType completo
    // resource específico
    // ───────────────────────────────────────────

    const blocks = await prisma.block.findMany({
      where: {
        businessId,

        ...getOverlapWhere(checkIn, checkOut),

        OR: [
          {
            serviceId: null,
          },

          {
            serviceId: service.id,
          },

          /*
           * Un Resource físico bloqueado
           * debe respetarse aunque el Block
           * conserve un serviceId.
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
    // BUSINESS-WIDE BLOCK
    // ───────────────────────────────────────────

    const businessBlocked = isBusinessBlocked(blocks);

    if (businessBlocked) {
      continue;
    }

    // ───────────────────────────────────────────
    // SERVICE-WIDE BLOCK
    // ───────────────────────────────────────────

    const serviceBlocked = isServiceBlocked(blocks, service.id);

    if (serviceBlocked) {
      continue;
    }

    // ───────────────────────────────────────────
    // RESOURCE REQUIREMENTS
    //
    // Para el hotel normalmente será:
    //
    // Standard Service
    //   requires 1
    // Standard ResourceType
    //
    // Pero esta lógica también permite en el futuro:
    //
    // Consulta
    //   requires 1 doctor
    //   requires 1 consultorio
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
      //
      // Recursos físicos ya ligados a reservas
      // superpuestas.
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
      //
      // Una ReservationService puede consumir
      // disponibilidad aunque todavía no tenga
      // ReservationResource.
      //
      // Esto protege contra overbooking.
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
      //
      // Ejemplo:
      //
      // resourceType = Standard
      // resource = null
      //
      // significa que Standard completo está
      // bloqueado.
      // ─────────────────────────────────────────

      const resourceTypeBlocked = isResourceTypeBlocked(
        blocks,
        service.id,
        resourceType.id,
      );

      if (resourceTypeBlocked) {
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
      // SPECIFIC RESOURCE BLOCKS
      //
      // Ejemplo:
      //
      // Resource 101 bloqueado.
      // ─────────────────────────────────────────

      const blockedResourceIds = getBlockedResourceIds(blocks, resourceIds);

      // ─────────────────────────────────────────
      // PHYSICALLY FREE RESOURCES
      //
      // No asignados
      // y
      // no bloqueados.
      // ─────────────────────────────────────────

      const physicallyFreeResources = resources.filter(
        (resource) =>
          !assignedResourceIds.has(resource.id) &&
          !blockedResourceIds.has(resource.id),
      );

      // Las reservas sin Resource asignado deben
      // apartar inventario antes de ofrecerlo a
      // nuevas reservas.

      const physicalResourcesAfterUnassignedDemand = Math.max(
        physicallyFreeResources.length - unassignedResourceDemand,
        0,
      );

      // Una unidad del servicio podría requerir
      // más de un recurso de este tipo.

      const availableUnits = Math.floor(
        physicalResourcesAfterUnassignedDemand / requiredQuantity,
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
    // Si un servicio requiere más de un tipo de
    // recurso, la capacidad está limitada por el
    // recurso más escaso.
    // ───────────────────────────────────────────

    const available = Math.min(
      ...resourceAvailability.map(
        (resourceType) => resourceType.availableUnits,
      ),
    );

    if (available <= 0) {
      continue;
    }

    // ───────────────────────────────────────────
    // HOTEL PRICING
    //
    // Por ahora mantenemos la lógica nocturna
    // porque el hotel es nuestra primera vertical.
    // ───────────────────────────────────────────

    const nights = calculateNights(checkIn, checkOut);

    const pricing = calculatePrice(checkIn, nights, service.rates);

    results.push({
      serviceId: service.id,

      name: service.name,
      slug: service.slug,
      description: service.description,

      maxPeople: service.maxPeople,
      maxAdults: service.maxAdults,
      maxChildren: service.maxChildren,

      available,

      resourceTypes: resourceAvailability,

      pricing,
      total: pricing.total,
    });
  }

  return {
    businessId,

    checkIn,
    checkOut,

    adults,
    children,
    totalGuests,

    nights: calculateNights(checkIn, checkOut),

    services: results,
  };
}

// ─────────────────────────────────────────────
// HOTEL: NUMBER OF NIGHTS
// ─────────────────────────────────────────────

function calculateNights(checkIn: Date, checkOut: Date) {
  const millisecondsPerDay = 1000 * 60 * 60 * 24;

  return Math.ceil(
    (checkOut.getTime() - checkIn.getTime()) / millisecondsPerDay,
  );
}

// ─────────────────────────────────────────────
// HOTEL: WEEKDAY / WEEKEND PRICING
// ─────────────────────────────────────────────

function calculatePrice(
  checkIn: Date,
  nights: number,
  rates: Array<{
    startDate: Date;
    endDate: Date;
    weekdayPrice: unknown;
    weekendPrice: unknown;
  }>,
) {
  let total = 0;

  const nightlyPrices: number[] = [];

  for (let i = 0; i < nights; i++) {
    const date = new Date(checkIn);

    // UTC para que el resultado no dependa de la
    // zona horaria del proceso Node.
    date.setUTCDate(date.getUTCDate() + i);

    const day = date.getUTCDay();

    const isWeekend = day === 0 || day === 6;

    const rate = rates.find(
      (currentRate) =>
        date >= currentRate.startDate && date <= currentRate.endDate,
    );

    if (!rate) {
      throw new Error(
        `No existe una tarifa para la fecha ${date.toISOString()}`,
      );
    }

    const price = Number(isWeekend ? rate.weekendPrice : rate.weekdayPrice);

    nightlyPrices.push(price);

    total += price;
  }

  return {
    nightlyPrices,
    total,
  };
}
