import {
  getAvailability,
  type BookingAvailabilityDb,
} from "@/lib/booking/availability";

import {
  calculateHotelNights,
  calculateHotelPrice,
} from "@/lib/booking/verticals/hotel/pricing";

import { prisma } from "@/lib/prisma";

type HotelAvailabilityInput = {
  businessId: string;

  startAt: Date;
  endAt: Date;

  checkIn: string;
  checkOut: string;

  adults: number;
  children: number;

  serviceIds?: string[];

  includeInactiveServices?: boolean;

  excludeReservationId?: string;

  db?: BookingAvailabilityDb;
};

export async function getHotelAvailability({
  businessId,

  startAt,
  endAt,

  checkIn,
  checkOut,

  adults,
  children,

  serviceIds,

  includeInactiveServices = false,

  excludeReservationId,

  db = prisma,
}: HotelAvailabilityInput) {
  const totalGuests = adults + children;

  // ─────────────────────────────────────────────
  // HOTEL-SPECIFIC SERVICE FILTER
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
            lte: endAt,
          },

          endDate: {
            gte: startAt,
          },
        },

        orderBy: {
          startDate: "desc",
        },
      },
    },

    orderBy: {
      name: "asc",
    },
  });

  const eligibleServiceIds = services.map((service) => service.id);

  // ─────────────────────────────────────────────
  // UNIVERSAL INVENTORY
  // ─────────────────────────────────────────────

  const inventory = await getAvailability({
    businessId,

    startAt,
    endAt,

    serviceIds: eligibleServiceIds,

    includeInactiveServices,

    excludeReservationId,

    db,
  });

  const inventoryByServiceId = new Map(
    inventory.services.map((service) => [service.serviceId, service]),
  );

  const results = [];

  // ─────────────────────────────────────────────
  // HOTEL QUOTING
  // ─────────────────────────────────────────────

  for (const service of services) {
    const availability = inventoryByServiceId.get(service.id);

    if (!availability) {
      continue;
    }

    const pricing = calculateHotelPrice(checkIn, checkOut, service.rates);

    results.push({
      serviceId: service.id,

      name: service.name,

      slug: service.slug,

      description: service.description,

      maxPeople: service.maxPeople,

      maxAdults: service.maxAdults,

      maxChildren: service.maxChildren,

      available: availability.available,

      resourceTypes: availability.resourceTypes,

      pricing: {
        nightlyPrices: pricing.nightlyPrices,

        total: pricing.total,
      },

      total: pricing.total,
    });
  }

  return {
    businessId,

    startAt,
    endAt,

    checkIn,
    checkOut,

    adults,
    children,

    totalGuests,

    nights: calculateHotelNights(checkIn, checkOut),

    services: results,
  };
}
