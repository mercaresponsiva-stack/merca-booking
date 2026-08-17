import { calculateHotelPrice } from "@/lib/booking/verticals/hotel/pricing";
import { isValidDateOnly, zonedDateTimeToUtc } from "@/lib/booking/datetime";
import {
  getOverlapWhere,
  getBlockedResourceIds,
  isBusinessBlocked,
  isResourceTypeBlocked,
  isServiceBlocked,
} from "@/lib/booking/resource-availability";
import {
  ACTIVE_RESERVATION_STATUSES,
  isReservationStatus,
  type ReservationStatus,
} from "@/lib/booking/reservation-state";
import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { calculatePaymentSummary } from "@/lib/booking/payment-summary";
import { calculateReservationFinancialState } from "@/lib/booking/reservation-financial-state";

const PAYMENT_OPTIONS = ["FULL", "DEPOSIT_50"] as const;

type PaymentOption = (typeof PAYMENT_OPTIONS)[number];

const RESERVATION_SOURCES = [
  "WEBSITE",
  "WHATSAPP",
  "PHONE",
  "WALK_IN",
  "AIRBNB",
  "OTHER",
] as const;

type ReservationSource = (typeof RESERVATION_SOURCES)[number];

function addDaysToDateOnly(dateOnly: string, days: number) {
  const date = new Date(`${dateOnly}T00:00:00.000Z`);

  date.setUTCDate(date.getUTCDate() + days);

  return date.toISOString().slice(0, 10);
}

function generateConfirmationCode() {
  const random = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();

  return `MB-${random}`;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;

    // ─────────────────────────────────────────────
    // QUERY PARAMS
    // ─────────────────────────────────────────────

    const businessId = searchParams.get("businessId")?.trim() ?? "";

    const rawStatus = searchParams.get("status")?.trim() ?? "";

    let status: ReservationStatus | undefined;

    const from = searchParams.get("from")?.trim() ?? "";

    const to = searchParams.get("to")?.trim() ?? "";

    const confirmationCode = searchParams.get("confirmationCode")?.trim() ?? "";

    const customer = searchParams.get("customer")?.trim() ?? "";

    const rawPage = Number(searchParams.get("page") ?? 1);

    const rawPageSize = Number(searchParams.get("pageSize") ?? 20);

    // ─────────────────────────────────────────────
    // VALIDATION
    // ─────────────────────────────────────────────

    if (!businessId) {
      return NextResponse.json(
        {
          success: false,
          error: "businessId es obligatorio",
        },
        {
          status: 400,
        },
      );
    }

    if (rawStatus) {
      if (!isReservationStatus(rawStatus)) {
        return NextResponse.json(
          {
            success: false,
            error: "Estado de reserva inválido",
          },
          {
            status: 400,
          },
        );
      }

      status = rawStatus;
    }

    if (from && !isValidDateOnly(from)) {
      return NextResponse.json(
        {
          success: false,
          error: "El parámetro from debe usar formato YYYY-MM-DD",
        },
        {
          status: 400,
        },
      );
    }

    if (to && !isValidDateOnly(to)) {
      return NextResponse.json(
        {
          success: false,
          error: "El parámetro to debe usar formato YYYY-MM-DD",
        },
        {
          status: 400,
        },
      );
    }

    if (from && to && from > to) {
      return NextResponse.json(
        {
          success: false,
          error: "from no puede ser posterior a to",
        },
        {
          status: 400,
        },
      );
    }

    if (!Number.isInteger(rawPage) || rawPage < 1) {
      return NextResponse.json(
        {
          success: false,
          error: "page debe ser un entero mayor o igual a 1",
        },
        {
          status: 400,
        },
      );
    }

    if (
      !Number.isInteger(rawPageSize) ||
      rawPageSize < 1 ||
      rawPageSize > 100
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "pageSize debe ser un entero entre 1 y 100",
        },
        {
          status: 400,
        },
      );
    }

    // ─────────────────────────────────────────────
    // BUSINESS
    // ─────────────────────────────────────────────

    const business = await prisma.business.findUnique({
      where: {
        id: businessId,
      },

      select: {
        id: true,
        name: true,
        slug: true,
        timezone: true,
        currency: true,
      },
    });

    if (!business) {
      return NextResponse.json(
        {
          success: false,
          error: "Negocio no encontrado",
        },
        {
          status: 404,
        },
      );
    }

    // ─────────────────────────────────────────────
    // DATE RANGE
    //
    // from = inicio inclusivo
    // to   = día final inclusivo
    //
    // Internamente convertimos "to" al inicio
    // del día siguiente para trabajar con:
    //
    // reservation.startAt < rangeEnd
    // reservation.endAt   > rangeStart
    //
    // que es la regla universal de solapamiento.
    // ─────────────────────────────────────────────

    const rangeStart = from
      ? zonedDateTimeToUtc(from, "00:00", business.timezone)
      : null;

    const rangeEnd = to
      ? zonedDateTimeToUtc(addDaysToDateOnly(to, 1), "00:00", business.timezone)
      : null;

    const dateConditions = [];

    if (rangeStart) {
      dateConditions.push({
        endAt: {
          gt: rangeStart,
        },
      });
    }

    if (rangeEnd) {
      dateConditions.push({
        startAt: {
          lt: rangeEnd,
        },
      });
    }

    // ─────────────────────────────────────────────
    // FILTERS
    // ─────────────────────────────────────────────

    const where = {
      businessId,

      ...(status
        ? {
            status,
          }
        : {}),

      ...(confirmationCode
        ? {
            confirmationCode: {
              contains: confirmationCode,
              mode: "insensitive" as const,
            },
          }
        : {}),

      ...(customer
        ? {
            customer: {
              OR: [
                {
                  firstName: {
                    contains: customer,
                    mode: "insensitive" as const,
                  },
                },
                {
                  lastName: {
                    contains: customer,
                    mode: "insensitive" as const,
                  },
                },
                {
                  email: {
                    contains: customer,
                    mode: "insensitive" as const,
                  },
                },
                {
                  phone: {
                    contains: customer,
                    mode: "insensitive" as const,
                  },
                },
              ],
            },
          }
        : {}),

      ...(dateConditions.length > 0
        ? {
            AND: dateConditions,
          }
        : {}),
    };

    // ─────────────────────────────────────────────
    // PAGINATION
    // ─────────────────────────────────────────────

    const page = rawPage;

    const pageSize = rawPageSize;

    const skip = (page - 1) * pageSize;

    // ─────────────────────────────────────────────
    // QUERY
    // ─────────────────────────────────────────────

    const [totalItems, reservations] = await prisma.$transaction([
      prisma.reservation.count({
        where,
      }),

      prisma.reservation.findMany({
        where,

        skip,

        take: pageSize,

        orderBy: [
          {
            createdAt: "desc",
          },
          {
            startAt: "desc",
          },
        ],

        include: {
          customer: true,

          services: {
            include: {
              service: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                },
              },

              resources: {
                include: {
                  resource: {
                    select: {
                      id: true,
                      name: true,
                      code: true,
                    },
                  },
                },
              },
            },
          },

          payments: {
            include: {
              refunds: true,
            },

            orderBy: {
              createdAt: "asc",
            },
          },
        },
      }),
    ]);

    // ─────────────────────────────────────────────
    // RESPONSE ROWS
    // ─────────────────────────────────────────────

    const items = reservations.map((reservation) => {
      const paymentSummary = calculatePaymentSummary({
        total: Number(reservation.total),

        paymentOption: reservation.paymentOption,

        payments: reservation.payments,
      });

      const financialState = calculateReservationFinancialState({
        status: reservation.status,

        paymentSummary,
      });

      return {
        id: reservation.id,

        confirmationCode: reservation.confirmationCode,

        status: reservation.status,

        source: reservation.source,

        startAt: reservation.startAt,

        endAt: reservation.endAt,

        guests: reservation.guests,

        adults: reservation.adults,

        children: reservation.children,

        total: Number(reservation.total),

        paymentOption: reservation.paymentOption,

        customer: {
          id: reservation.customer.id,

          firstName: reservation.customer.firstName,

          lastName: reservation.customer.lastName,

          email: reservation.customer.email,

          phone: reservation.customer.phone,
        },

        services: reservation.services.map((item) => ({
          id: item.id,

          serviceId: item.serviceId,

          name: item.service.name,

          slug: item.service.slug,

          quantity: item.quantity,

          subtotal: Number(item.subtotal),

          resources: item.resources.map((assignment) => ({
            assignmentId: assignment.id,

            resourceId: assignment.resourceId,

            name: assignment.resource.name,

            code: assignment.resource.code,
          })),
        })),

        financial: {
          grossPaid: paymentSummary.grossPaid,

          refunded: paymentSummary.refunded,

          refundPending: paymentSummary.refundPending,

          netPaid: paymentSummary.netPaid,

          contractualBalance: financialState.contractualBalance,

          amountDue: financialState.amountDue,

          canAcceptPayment: financialState.canAcceptPayment,

          hasRefundPending: financialState.hasRefundPending,
        },

        createdAt: reservation.createdAt,

        updatedAt: reservation.updatedAt,
      };
    });

    const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize);

    return NextResponse.json({
      success: true,

      business,

      filters: {
        status: status || null,

        from: from || null,

        to: to || null,

        confirmationCode: confirmationCode || null,

        customer: customer || null,
      },

      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages,

        hasPreviousPage: page > 1,

        hasNextPage: page < totalPages,
      },

      items,
    });
  } catch (error) {
    console.error("GET /api/reservations error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "No fue posible obtener las reservas",
      },
      {
        status: 500,
      },
    );
  }
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

    const customerId =
      typeof body.customerId === "string" ? body.customerId.trim() : "";

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

    const source = (body.source ?? "WEBSITE") as ReservationSource;

    // ─────────────────────────────────────────────
    // 1. REQUIRED FIELDS
    // ─────────────────────────────────────────────

    if (
      !businessId ||
      !serviceId ||
      !checkIn ||
      !checkOut ||
      (!customerId && (!firstName || !lastName))
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

    if (!RESERVATION_SOURCES.includes(source)) {
      return NextResponse.json(
        {
          success: false,
          error: "El origen de la reserva no es válido",
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

        const customer = customerId
          ? await tx.customer.findFirst({
              where: {
                id: customerId,
                businessId: business.id,
              },
            })
          : await tx.customer.create({
              data: {
                businessId: business.id,

                firstName,
                lastName,

                email: email || null,
                phone: phone || null,
              },
            });

        if (!customer) {
          throw new Error("CUSTOMER_NOT_FOUND");
        }

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

            /*
             * Regla actual del sistema:
             *
             * El flujo público WEBSITE conserva
             * elegibilidad a retracto.
             *
             * Las reservas administrativas
             * registran su canal real y no se
             * marcan automáticamente elegibles.
             *
             * Esto representa la política actual
             * del producto, no una determinación
             * legal automática sobre cada caso.
             */
            retractoEligible: source === "WEBSITE",

            specialRequests: specialRequests || null,

            source,
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

    if (error instanceof Error && error.message === "CUSTOMER_NOT_FOUND") {
      return NextResponse.json(
        {
          success: false,
          error: "Cliente no encontrado para este negocio",
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
