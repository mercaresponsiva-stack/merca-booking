import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({
  adapter,
});

async function main() {
  console.log("🌱 Starting seed...");

  // ─────────────────────────────────────────────
  // BUSINESS TYPE
  // ─────────────────────────────────────────────

  const hotelType = await prisma.businessType.upsert({
    where: {
      slug: "hotel",
    },
    update: {
      name: "Hotel",
      description: "Negocio de alojamiento y hospedaje",
      isActive: true,
    },
    create: {
      name: "Hotel",
      slug: "hotel",
      description: "Negocio de alojamiento y hospedaje",
      isActive: true,
    },
  });

  // ─────────────────────────────────────────────
  // BUSINESS
  // ─────────────────────────────────────────────

  const business = await prisma.business.upsert({
    where: {
      slug: "hotel-demo",
    },
    update: {
      businessTypeId: hotelType.id,
      name: "Hotel Demo",
      description: "Hotel de demostración para Merca Booking",
      city: "San Salvador",
      country: "El Salvador",
      currency: "USD",
      timezone: "America/El_Salvador",
      checkInTime: "15:00",
      checkOutTime: "12:00",
      isActive: true,
    },
    create: {
      businessTypeId: hotelType.id,
      name: "Hotel Demo",
      slug: "hotel-demo",
      description: "Hotel de demostración para Merca Booking",
      city: "San Salvador",
      country: "El Salvador",
      currency: "USD",
      timezone: "America/El_Salvador",
      checkInTime: "15:00",
      checkOutTime: "12:00",
      isActive: true,
    },
  });

  console.log(`🏢 Business: ${business.name}`);

  // ─────────────────────────────────────────────
  // SERVICES
  // Lo que el cliente reserva
  // ─────────────────────────────────────────────

  const standardService = await prisma.service.upsert({
    where: {
      businessId_slug: {
        businessId: business.id,
        slug: "standard",
      },
    },
    update: {
      name: "Habitación Standard",
      maxPeople: 3,
      maxAdults: 2,
      maxChildren: 1,
      isActive: true,
    },
    create: {
      businessId: business.id,
      name: "Habitación Standard",
      slug: "standard",
      maxPeople: 3,
      maxAdults: 2,
      maxChildren: 1,
      isActive: true,
    },
  });

  const deluxeService = await prisma.service.upsert({
    where: {
      businessId_slug: {
        businessId: business.id,
        slug: "deluxe",
      },
    },
    update: {
      name: "Habitación Deluxe",
      maxPeople: 4,
      maxAdults: 2,
      maxChildren: 2,
      isActive: true,
    },
    create: {
      businessId: business.id,
      name: "Habitación Deluxe",
      slug: "deluxe",
      maxPeople: 4,
      maxAdults: 2,
      maxChildren: 2,
      isActive: true,
    },
  });

  const suiteService = await prisma.service.upsert({
    where: {
      businessId_slug: {
        businessId: business.id,
        slug: "suite",
      },
    },
    update: {
      name: "Suite",
      maxPeople: 6,
      maxAdults: 4,
      maxChildren: 2,
      isActive: true,
    },
    create: {
      businessId: business.id,
      name: "Suite",
      slug: "suite",
      maxPeople: 6,
      maxAdults: 4,
      maxChildren: 2,
      isActive: true,
    },
  });

  // ─────────────────────────────────────────────
  // RESOURCE TYPES
  // Categoría física de recursos
  // ─────────────────────────────────────────────

  const standardType = await prisma.resourceType.upsert({
    where: {
      businessId_slug: {
        businessId: business.id,
        slug: "standard",
      },
    },
    update: {
      name: "Standard",
    },
    create: {
      businessId: business.id,
      name: "Standard",
      slug: "standard",
    },
  });

  const deluxeType = await prisma.resourceType.upsert({
    where: {
      businessId_slug: {
        businessId: business.id,
        slug: "deluxe",
      },
    },
    update: {
      name: "Deluxe",
    },
    create: {
      businessId: business.id,
      name: "Deluxe",
      slug: "deluxe",
    },
  });

  const suiteType = await prisma.resourceType.upsert({
    where: {
      businessId_slug: {
        businessId: business.id,
        slug: "suite",
      },
    },
    update: {
      name: "Suite",
    },
    create: {
      businessId: business.id,
      name: "Suite",
      slug: "suite",
    },
  });

  // ─────────────────────────────────────────────
  // SERVICE ↔ RESOURCE TYPE
  // ─────────────────────────────────────────────

  const serviceResourcePairs = [
    {
      serviceId: standardService.id,
      resourceTypeId: standardType.id,
    },
    {
      serviceId: deluxeService.id,
      resourceTypeId: deluxeType.id,
    },
    {
      serviceId: suiteService.id,
      resourceTypeId: suiteType.id,
    },
  ];

  for (const pair of serviceResourcePairs) {
    await prisma.serviceResourceType.upsert({
      where: {
        serviceId_resourceTypeId: {
          serviceId: pair.serviceId,
          resourceTypeId: pair.resourceTypeId,
        },
      },
      update: {
        requiredQuantity: 1,
      },
      create: {
        serviceId: pair.serviceId,
        resourceTypeId: pair.resourceTypeId,
        requiredQuantity: 1,
      },
    });
  }

  // ─────────────────────────────────────────────
  // PHYSICAL RESOURCES
  // ─────────────────────────────────────────────

  const resources = [
    {
      resourceTypeId: standardType.id,
      name: "101",
      code: "101",
      floor: 1,
      capacity: 3,
    },
    {
      resourceTypeId: standardType.id,
      name: "102",
      code: "102",
      floor: 1,
      capacity: 3,
    },
    {
      resourceTypeId: deluxeType.id,
      name: "201",
      code: "201",
      floor: 2,
      capacity: 4,
    },
    {
      resourceTypeId: deluxeType.id,
      name: "202",
      code: "202",
      floor: 2,
      capacity: 4,
    },
    {
      resourceTypeId: suiteType.id,
      name: "301",
      code: "301",
      floor: 3,
      capacity: 6,
    },
  ];

  for (const resource of resources) {
    await prisma.resource.upsert({
      where: {
        businessId_code: {
          businessId: business.id,
          code: resource.code,
        },
      },
      update: {
        resourceTypeId: resource.resourceTypeId,
        name: resource.name,
        floor: resource.floor,
        capacity: resource.capacity,
        isActive: true,
      },
      create: {
        businessId: business.id,
        resourceTypeId: resource.resourceTypeId,
        name: resource.name,
        code: resource.code,
        floor: resource.floor,
        capacity: resource.capacity,
        isActive: true,
      },
    });
  }

  // ─────────────────────────────────────────────
  // SERVICE RATES
  // ─────────────────────────────────────────────

  const startDate = new Date("2026-01-01T00:00:00.000Z");
  const endDate = new Date("2026-12-31T23:59:59.999Z");

  const rates = [
    {
      serviceId: standardService.id,
      name: "Tarifa 2026 - Standard",
      weekdayPrice: 50,
      weekendPrice: 60,
    },
    {
      serviceId: deluxeService.id,
      name: "Tarifa 2026 - Deluxe",
      weekdayPrice: 70,
      weekendPrice: 85,
    },
    {
      serviceId: suiteService.id,
      name: "Tarifa 2026 - Suite",
      weekdayPrice: 100,
      weekendPrice: 120,
    },
  ];

  for (const rate of rates) {
    const existingRate = await prisma.serviceRate.findFirst({
      where: {
        serviceId: rate.serviceId,
        name: rate.name,
      },
    });

    if (existingRate) {
      await prisma.serviceRate.update({
        where: {
          id: existingRate.id,
        },
        data: {
          startDate,
          endDate,
          weekdayPrice: rate.weekdayPrice,
          weekendPrice: rate.weekendPrice,
          isActive: true,
        },
      });
    } else {
      await prisma.serviceRate.create({
        data: {
          serviceId: rate.serviceId,
          name: rate.name,
          startDate,
          endDate,
          weekdayPrice: rate.weekdayPrice,
          weekendPrice: rate.weekendPrice,
          isActive: true,
        },
      });
    }
  }

  console.log("✅ Seed completed.");
}

main()
  .catch((error) => {
    console.error("❌ Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
