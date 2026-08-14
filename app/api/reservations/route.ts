import {
  getOverlapWhere,
  getBlockedResourceIds,
  isBusinessBlocked,
  isResourceTypeBlocked,
  isServiceBlocked,
} from "@/lib/booking/resource-availability";
import { ACTIVE_RESERVATION_STATUSES } from "@/lib/booking/reservation-state";
import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const PAYMENT_OPTIONS = ["FULL", "DEPOSIT_50"] as const;

type PaymentOption = (typeof PAYMENT_OPTIONS)[number];

function generateConfirmationCode() {
  const random = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();

  return `MB-${random}`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    /*
     * NUEVOS NOMBRES
     *
     * businessId
     * serviceId
     *
     * Compatibilidad temporal:
     *
     * hotelId    -> businessId
     * roomTypeId -> serviceId
     *
     * La migración conservó los IDs originales,
     * así que ambos funcionan durante la transición.
     */
    const businessId = body.businessId ?? body.hotelId;

    const serviceId = body.serviceId ?? body.roomTypeId;

    const firstName = body.firstName;
    const lastName = body.lastName;

    const email = body.email;
    const phone = body.phone;

    const checkIn = body.checkIn;
    const checkOut = body.checkOut;

    const adults = Number(body.adults ?? 1);
    const children = Number(body.children ?? 0);

    const specialRequests = body.specialRequests ?? null;

    const paymentOption = body.paymentOption as PaymentOption | undefined;

    // ─────────────────────────────────────────────
    // 1. REQUIRED FIELDS
    // ─────────────────────────────────────────────

    if (
      !businessId ||
      !serviceId ||
      !firstName ||
      !lastName ||
      !checkIn ||
      !checkOut
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Faltan campos obligatorios",
        },
        {
          status: 400,
        },
      );
    }

    if (!paymentOption || !PAYMENT_OPTIONS.includes(paymentOption)) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Debes seleccionar una modalidad de pago válida: FULL o DEPOSIT_50",
        },
        {
          status: 400,
        },
      );
    }

    // ─────────────────────────────────────────────
    // 2. DATE FORMAT
    // ─────────────────────────────────────────────

    if (!isValidDateOnly(checkIn) || !isValidDateOnly(checkOut)) {
      return NextResponse.json(
        {
          success: false,
          error: "Formato de fecha inválido. Usa YYYY-MM-DD.",
        },
        {
          status: 400,
        },
      );
    }

    // ─────────────────────────────────────────────
    // 3. GUESTS
    // ─────────────────────────────────────────────

    if (
      !Number.isInteger(adults) ||
      !Number.isInteger(children) ||
      adults < 1 ||
      children < 0
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Cantidad de huéspedes inválida",
        },
        {
          status: 400,
        },
      );
    }

    const guests = adults + children;

    // ─────────────────────────────────────────────
    // 4. BUSINESS
    // ─────────────────────────────────────────────

    const business = await prisma.business.findFirst({
      where: {
        id: businessId,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        timezone: true,
        checkInTime: true,
        checkOutTime: true,
      },
    });

    if (!business) {
      return NextResponse.json(
        {
          success: false,
          error: "Negocio no encontrado o inactivo",
        },
        {
          status: 404,
        },
      );
    }

    // ─────────────────────────────────────────────
    // 5. HOTEL DATES -> CORE DATETIMES
    //
    // La API hotelera recibe:
    //
    // 2026-08-15
    // 2026-08-17
    //
    // El Core almacena:
    //
    // startAt
    // endAt
    //
    // usando la timezone del Business.
    // ─────────────────────────────────────────────

    const startAt = zonedDateTimeToUtc(
      checkIn,
      business.checkInTime ?? "00:00",
      business.timezone,
    );

    const endAt = zonedDateTimeToUtc(
      checkOut,
      business.checkOutTime ?? "00:00",
      business.timezone,
    );

    if (endAt <= startAt) {
      return NextResponse.json(
        {
          success: false,
          error: "La fecha de salida debe ser posterior a la fecha de entrada",
        },
        {
          status: 400,
        },
      );
    }

    // ─────────────────────────────────────────────
    // 6. SERIALIZABLE TRANSACTION
    //
    // Toda la comprobación de disponibilidad
    // y creación ocurre dentro de la misma
    // transacción.
    // ─────────────────────────────────────────────

    const result = await prisma.$transaction(
      async (tx) => {
        // ─────────────────────────────────────────
        // SERVICE
        //
        // Hotel:
        // Service = Habitación Standard
        // ─────────────────────────────────────────

        const service = await tx.service.findFirst({
          where: {
            id: serviceId,
            businessId: business.id,
            isActive: true,
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
        });

        if (!service) {
          throw new Error("SERVICE_NOT_FOUND");
        }

        // ─────────────────────────────────────────
        // 7. CAPACITY
        // ─────────────────────────────────────────

        if (guests > service.maxPeople) {
          throw new Error("SERVICE_CAPACITY_EXCEEDED");
        }

        if (service.maxAdults !== null && adults > service.maxAdults) {
          throw new Error("SERVICE_CAPACITY_EXCEEDED");
        }

        if (service.maxChildren !== null && children > service.maxChildren) {
          throw new Error("SERVICE_CAPACITY_EXCEEDED");
        }

        // ─────────────────────────────────────────
        // 8. PRICING
        //
        // La lógica continúa siendo hotelera:
        // weekday / weekend por noche.
        // ─────────────────────────────────────────

        const pricing = calculateHotelPrice(checkIn, checkOut, service.rates);

        const subtotal = pricing.total;
        const total = subtotal;

        // ─────────────────────────────────────────
        // 9. RESOURCE REQUIREMENTS
        // ─────────────────────────────────────────

        if (service.resourceTypes.length === 0) {
          throw new Error("SERVICE_RESOURCE_NOT_CONFIGURED");
        }

        // ─────────────────────────────────────────
        // 10. OVERLAPPING RESERVATIONS
        //
        // ReservationService representa demanda,
        // tenga o no Resource físico asignado.
        // ─────────────────────────────────────────

        const overlappingReservationServices =
          await tx.reservationService.findMany({
            where: {
              serviceId: service.id,

              reservation: {
                businessId: business.id,

                status: {
                  in: [...ACTIVE_RESERVATION_STATUSES],
                },

                ...getOverlapWhere(startAt, endAt),
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

        // ─────────────────────────────────────────
        // 11. BLOCKS
        //
        // Pueden bloquear:
        //
        // Business
        // Service
        // ResourceType
        // Resource
        // ─────────────────────────────────────────

        const blocks = await tx.block.findMany({
          where: {
            businessId: business.id,

            ...getOverlapWhere(startAt, endAt),

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
               * conserve otro serviceId.
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

        // ─────────────────────────────────────────
        // BUSINESS-WIDE BLOCK
        // ─────────────────────────────────────────

        const businessBlocked = isBusinessBlocked(blocks);

        if (businessBlocked) {
          throw new Error("SERVICE_NOT_AVAILABLE");
        }

        // ─────────────────────────────────────────
        // SERVICE-WIDE BLOCK
        // ─────────────────────────────────────────

        const serviceBlocked = isServiceBlocked(blocks, service.id);

        if (serviceBlocked) {
          throw new Error("SERVICE_NOT_AVAILABLE");
        }

        // ─────────────────────────────────────────
        // 12. CHECK EACH RESOURCE TYPE
        // ─────────────────────────────────────────

        const autoAssignResourceIds: string[] = [];

        for (const requirement of service.resourceTypes) {
          const resourceType = requirement.resourceType;

          const resources = resourceType.resources;

          const requiredQuantity = Math.max(requirement.requiredQuantity, 1);

          if (resources.length === 0) {
            throw new Error("SERVICE_NOT_AVAILABLE");
          }

          const currentResourceIds = new Set(
            resources.map((resource) => resource.id),
          );

          // ───────────────────────────────────────
          // ASSIGNED RESOURCES
          // ───────────────────────────────────────

          const assignedResourceIds = new Set<string>();

          for (const reservationService of overlappingReservationServices) {
            for (const reservationResource of reservationService.resources) {
              if (
                reservationResource.resource.resourceTypeId ===
                  resourceType.id &&
                currentResourceIds.has(reservationResource.resourceId)
              ) {
                assignedResourceIds.add(reservationResource.resourceId);
              }
            }
          }

          // ───────────────────────────────────────
          // UNASSIGNED DEMAND
          //
          // Maria:
          // ReservationService Standard
          // ReservationResource = ninguno
          //
          // Aun así consume 1 habitación.
          // ───────────────────────────────────────

          let unassignedDemand = 0;

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

            unassignedDemand += missingResources;
          }

          // ───────────────────────────────────────
          // RESOURCE TYPE BLOCK
          // ───────────────────────────────────────

          const resourceTypeBlocked = isResourceTypeBlocked(
            blocks,
            service.id,
            resourceType.id,
          );

          if (resourceTypeBlocked) {
            throw new Error("SERVICE_NOT_AVAILABLE");
          }

          // ───────────────────────────────────────
          // SPECIFIC RESOURCE BLOCKS
          // ───────────────────────────────────────

          const blockedResourceIds = getBlockedResourceIds(
            blocks,
            currentResourceIds,
          );

          // ───────────────────────────────────────
          // PHYSICALLY FREE RESOURCES
          // ───────────────────────────────────────

          const physicallyFreeResources = resources.filter(
            (resource) =>
              !assignedResourceIds.has(resource.id) &&
              !blockedResourceIds.has(resource.id),
          );

          // ───────────────────────────────────────
          // EXISTING UNASSIGNED RESERVATIONS
          // ALSO CONSUME INVENTORY
          // ───────────────────────────────────────

          const resourcesAfterPendingDemand = Math.max(
            physicallyFreeResources.length - unassignedDemand,
            0,
          );

          const availableUnits = Math.floor(
            resourcesAfterPendingDemand / requiredQuantity,
          );

          if (availableUnits < 1) {
            throw new Error("SERVICE_NOT_AVAILABLE");
          }

          // ───────────────────────────────────────
          // AUTOMATIC RESOURCE ASSIGNMENT
          //
          // IMPORTANTE:
          //
          // NO:
          // "solo queda uno libre"
          //
          // SÍ:
          // "el tipo tiene solamente un recurso
          // físico configurado".
          //
          // Suite -> solo 301
          // => autoasignar 301
          //
          // Standard -> 101 + 102
          // => no autoasignar aunque solo quede
          // uno disponible.
          // ───────────────────────────────────────

          if (
            requiredQuantity === 1 &&
            resources.length === 1 &&
            physicallyFreeResources.length === 1 &&
            unassignedDemand === 0
          ) {
            autoAssignResourceIds.push(resources[0].id);
          }
        }

        // ─────────────────────────────────────────
        // 13. CUSTOMER
        // ─────────────────────────────────────────

        const customer = await tx.customer.create({
          data: {
            businessId: business.id,

            firstName,
            lastName,

            email: email || null,
            phone: phone || null,
          },
        });

        // ─────────────────────────────────────────
        // 14. RESERVATION
        // ─────────────────────────────────────────

        const reservation = await tx.reservation.create({
          data: {
            businessId: business.id,
            customerId: customer.id,

            confirmationCode: generateConfirmationCode(),

            startAt,
            endAt,

            guests,
            adults,
            children,

            status: "PENDING",

            subtotal,
            total,

            paymentOption,

            specialRequests: specialRequests || null,

            source: "WEBSITE",
          },
        });

        // ─────────────────────────────────────────
        // 15. RESERVATION SERVICE
        //
        // El Service es lo que el cliente compró.
        // ─────────────────────────────────────────

        const reservationService = await tx.reservationService.create({
          data: {
            reservationId: reservation.id,
            serviceId: service.id,

            quantity: 1,

            /*
             * El modelo actual guarda un unitPrice.
             *
             * Para alojamiento seguimos usando
             * el promedio por noche, igual que
             * hacía nightlyRate anteriormente.
             *
             * La suma exacta weekday/weekend
             * permanece en subtotal.
             */
            unitPrice: subtotal / pricing.numberOfNights,

            subtotal,
          },
        });

        // ─────────────────────────────────────────
        // 16. OPTIONAL RESOURCE ASSIGNMENT
        // ─────────────────────────────────────────

        for (const resourceId of autoAssignResourceIds) {
          await tx.reservationResource.create({
            data: {
              reservationId: reservation.id,

              reservationServiceId: reservationService.id,

              resourceId,
            },
          });
        }

        // ─────────────────────────────────────────
        // 17. RETURN COMPLETE RESERVATION
        // ─────────────────────────────────────────

        const completeReservation = await tx.reservation.findUniqueOrThrow({
          where: {
            id: reservation.id,
          },

          include: {
            customer: true,

            services: {
              include: {
                service: true,

                resources: {
                  include: {
                    resource: true,
                  },
                },
              },
            },

            payments: true,
          },
        });

        return {
          reservation: completeReservation,

          pricing: {
            numberOfNights: pricing.numberOfNights,

            nightlyPrices: pricing.nightlyPrices,
          },
        };
      },

      {
        isolationLevel: "Serializable",
      },
    );

    // ─────────────────────────────────────────────
    // 18. RESPONSE
    // ─────────────────────────────────────────────

    const reservation = result.reservation;

    return NextResponse.json(
      {
        success: true,

        reservation: {
          id: reservation.id,

          confirmationCode: reservation.confirmationCode,

          status: reservation.status,

          businessId: reservation.businessId,

          startAt: reservation.startAt,

          endAt: reservation.endAt,

          /*
           * Hotel-facing values.
           *
           * Conservamos las fechas solicitadas
           * también en formato date-only.
           */
          checkIn,
          checkOut,

          guests: reservation.guests,

          adults: reservation.adults,

          children: reservation.children,

          subtotal: reservation.subtotal,

          total: reservation.total,

          paymentOption: reservation.paymentOption,

          customer: reservation.customer,

          services: reservation.services.map((item) => ({
            id: item.id,

            serviceId: item.serviceId,

            service: item.service.name,

            quantity: item.quantity,

            unitPrice: item.unitPrice,

            subtotal: item.subtotal,

            resources: item.resources.map((assignment) => ({
              id: assignment.id,

              resourceId: assignment.resourceId,

              name: assignment.resource.name,

              code: assignment.resource.code,

              floor: assignment.resource.floor,
            })),
          })),

          payments: reservation.payments,

          pricing: result.pricing,
        },
      },
      {
        status: 201,
      },
    );
  } catch (error) {
    console.error("POST /api/reservations error:", error);

    if (error instanceof Error && error.message === "SERVICE_NOT_FOUND") {
      return NextResponse.json(
        {
          success: false,
          error: "Servicio no encontrado",
        },
        {
          status: 404,
        },
      );
    }

    if (
      error instanceof Error &&
      error.message === "SERVICE_CAPACITY_EXCEEDED"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "El servicio no tiene capacidad suficiente para esa cantidad de huéspedes",
        },
        {
          status: 400,
        },
      );
    }

    if (error instanceof Error && error.message === "RATE_NOT_AVAILABLE") {
      return NextResponse.json(
        {
          success: false,
          error:
            "No existe una tarifa válida para todas las fechas seleccionadas",
        },
        {
          status: 400,
        },
      );
    }

    if (
      error instanceof Error &&
      error.message === "SERVICE_RESOURCE_NOT_CONFIGURED"
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "El servicio no tiene recursos configurados",
        },
        {
          status: 500,
        },
      );
    }

    if (error instanceof Error && error.message === "SERVICE_NOT_AVAILABLE") {
      return NextResponse.json(
        {
          success: false,
          error: "El servicio ya no está disponible para esas fechas",
        },
        {
          status: 409,
        },
      );
    }

    /*
     * En una transacción SERIALIZABLE PostgreSQL
     * puede abortar una operación concurrente.
     *
     * Prisma suele representarlo como P2034.
     *
     * Por ahora devolvemos 409 y más adelante
     * podremos agregar retry automático.
     */
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2034"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "La disponibilidad cambió mientras se procesaba la reserva. Intenta nuevamente.",
        },
        {
          status: 409,
        },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: "No fue posible crear la reserva",
      },
      {
        status: 500,
      },
    );
  }
}

// ─────────────────────────────────────────────
// DATE-ONLY VALIDATION
// ─────────────────────────────────────────────

function isValidDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);

  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

// ─────────────────────────────────────────────
// HOTEL PRICING
//
// Usa las fechas de calendario solicitadas,
// no las horas reales de check-in/check-out.
//
// Esto evita que:
//
// check-in 15:00
// check-out 12:00
//
// altere accidentalmente el número de noches.
// ─────────────────────────────────────────────

function calculateHotelPrice(
  checkIn: string,
  checkOut: string,
  rates: Array<{
    startDate: Date;
    endDate: Date;
    weekdayPrice: unknown;
    weekendPrice: unknown;
  }>,
) {
  const startDate = dateOnlyToUtc(checkIn);

  const endDate = dateOnlyToUtc(checkOut);

  const millisecondsPerDay = 1000 * 60 * 60 * 24;

  const numberOfNights = Math.round(
    (endDate.getTime() - startDate.getTime()) / millisecondsPerDay,
  );

  if (numberOfNights < 1) {
    throw new Error("INVALID_NUMBER_OF_NIGHTS");
  }

  const nightlyPrices: number[] = [];

  let total = 0;

  for (let night = 0; night < numberOfNights; night++) {
    const date = new Date(startDate.getTime() + night * millisecondsPerDay);

    const rate = rates.find(
      (currentRate) =>
        date >= currentRate.startDate && date <= currentRate.endDate,
    );

    if (!rate) {
      throw new Error("RATE_NOT_AVAILABLE");
    }

    const day = date.getUTCDay();

    const isWeekend = day === 0 || day === 6;

    const nightlyPrice = Number(
      isWeekend ? rate.weekendPrice : rate.weekdayPrice,
    );

    nightlyPrices.push(nightlyPrice);

    total += nightlyPrice;
  }

  return {
    numberOfNights,
    nightlyPrices,
    total,
  };
}

function dateOnlyToUtc(value: string) {
  const [year, month, day] = value.split("-").map(Number);

  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

// ─────────────────────────────────────────────
// BUSINESS LOCAL DATETIME -> UTC
// ─────────────────────────────────────────────

function zonedDateTimeToUtc(date: string, time: string, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number);

  const [hour, minute] = time.split(":").map(Number);

  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    throw new Error(`Horario inválido para el negocio: ${time}`);
  }

  const desiredUtcValue = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  let utcValue = desiredUtcValue;

  /*
   * Dos pasadas son suficientes para resolver
   * el offset de la zona horaria en los casos
   * normales y cubrir zonas con cambios
   * estacionales de offset.
   */
  for (let attempt = 0; attempt < 2; attempt++) {
    const parts = getDateTimeParts(new Date(utcValue), timeZone);

    const representedAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      0,
      0,
    );

    const difference = desiredUtcValue - representedAsUtc;

    utcValue += difference;

    if (difference === 0) {
      break;
    }
  }

  return new Date(utcValue);
}

// ─────────────────────────────────────────────
// DATETIME PARTS IN BUSINESS TIMEZONE
// ─────────────────────────────────────────────

function getDateTimeParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,

    year: "numeric",
    month: "2-digit",
    day: "2-digit",

    hour: "2-digit",
    minute: "2-digit",

    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date);

  const values: Record<string, number> = {};

  for (const part of parts) {
    if (
      part.type === "year" ||
      part.type === "month" ||
      part.type === "day" ||
      part.type === "hour" ||
      part.type === "minute"
    ) {
      values[part.type] = Number(part.value);
    }
  }

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
  };
}
