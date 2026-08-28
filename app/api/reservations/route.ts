import { calculateHotelPrice } from "@/lib/booking/verticals/hotel/pricing";
import {
  quoteHotelServiceOptions,
  type HotelOptionSelection,
} from "@/lib/booking/verticals/hotel/option-quote";
import {
  assertProspectiveInventoryAvailable,
  evaluateProspectiveInventory,
  type ProspectiveInventoryDemand,
} from "@/lib/booking/prospective-inventory";
import {
  getResourceTypeInventoryState,
} from "@/lib/booking/resource-type-inventory";
import { isValidDateOnly, zonedDateTimeToUtc } from "@/lib/booking/datetime";
import { calculatePendingReservationExpiresAt } from "@/lib/booking/reservation-expiration-deadline";
import {
  isReservationStatus,
  type ReservationStatus,
} from "@/lib/booking/reservation-state";
import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { calculatePaymentSummary } from "@/lib/booking/payment-summary";
import { calculateReservationFinancialState } from "@/lib/booking/reservation-financial-state";

import {
  AuthorizationError,
  requireBusinessAccess,
} from "@/lib/auth/business-access";

export const dynamic = "force-dynamic";

function privateJson(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);

  headers.set(
    "Cache-Control",
    "private, no-store, max-age=0, must-revalidate",
  );
  headers.set("Pragma", "no-cache");
  headers.set("Expires", "0");
  headers.set("X-Robots-Tag", "noindex, nofollow");

  return NextResponse.json(body, {
    ...init,
    headers,
  });
}

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
      return privateJson(
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
        return privateJson(
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
      return privateJson(
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
      return privateJson(
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
      return privateJson(
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
      return privateJson(
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
      return privateJson(
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

    const access = await requireBusinessAccess(businessId, [
      "OWNER",
      "ADMIN",
      "RECEPTIONIST",
    ]);

    const business = await prisma.business.findFirst({
      where: {
        id: access.business.id,
        isActive: true,
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
      throw new AuthorizationError(
        403,
        "BUSINESS_ACCESS_DENIED",
        "No tienes acceso activo a este negocio.",
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
      businessId: business.id,

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

      AND: [
        {
          customer: {
            is: {
              businessId: business.id,
            },
          },
        },
        ...dateConditions,
      ],
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
            where: {
              service: {
                is: {
                  businessId: business.id,
                },
              },
            },

            include: {
              service: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                },
              },

              resources: {
                where: {
                  resource: {
                    is: {
                      businessId: business.id,
                    },
                  },
                },

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
            where: {
              businessId: business.id,
            },

            include: {
              refunds: {
                where: {
                  businessId: business.id,
                },
              },
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

        expiresAt:
          reservation.expiresAt,

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

    return privateJson({
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
    if (error instanceof AuthorizationError) {
      return privateJson(
        {
          success: false,
          code: error.code,
          error: error.message,
        },
        {
          status: error.status,
        },
      );
    }

    console.error("GET /api/reservations error:", error);

    return privateJson(
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

    /*
     * Opciones seleccionadas por el cliente.
     *
     * El cliente solamente controla:
     *
     * - serviceOptionId
     * - optionalQuantity
     * - startAt/endAt opcionales
     *
     * NO aceptamos del frontend:
     *
     * - unitPrice
     * - subtotal
     * - billingUnits
     * - includedQuantity
     * - pricingBase
     * - pricingFrequency
     */
    const rawOptions = body.options ?? [];

    if (!Array.isArray(rawOptions)) {
      return NextResponse.json(
        {
          success: false,
          error: "options debe ser un arreglo",
        },
        {
          status: 400,
        },
      );
    }

    const optionSelections: HotelOptionSelection[] = [];

    for (const rawOption of rawOptions) {
      if (
        typeof rawOption !== "object" ||
        rawOption === null ||
        Array.isArray(rawOption)
      ) {
        return NextResponse.json(
          {
            success: false,
            error: "Cada opción debe ser un objeto válido",
          },
          {
            status: 400,
          },
        );
      }

      const option = rawOption as Record<string, unknown>;

      const serviceOptionId =
        typeof option.serviceOptionId === "string"
          ? option.serviceOptionId.trim()
          : "";

      const optionalQuantity = Number(
        option.optionalQuantity,
      );

      if (
        !serviceOptionId ||
        !Number.isInteger(optionalQuantity) ||
        optionalQuantity < 1
      ) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Cada opción debe incluir serviceOptionId y optionalQuantity válido",
          },
          {
            status: 400,
          },
        );
      }

      const rawOptionStartAt =
        option.startAt;

      const rawOptionEndAt =
        option.endAt;

      const hasOptionStartAt =
        rawOptionStartAt !== undefined &&
        rawOptionStartAt !== null &&
        rawOptionStartAt !== "";

      const hasOptionEndAt =
        rawOptionEndAt !== undefined &&
        rawOptionEndAt !== null &&
        rawOptionEndAt !== "";

      if (
        hasOptionStartAt !==
        hasOptionEndAt
      ) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Una opción con intervalo propio requiere startAt y endAt",
          },
          {
            status: 400,
          },
        );
      }

      let optionStartAt: Date | null =
        null;

      let optionEndAt: Date | null =
        null;

      if (
        hasOptionStartAt &&
        hasOptionEndAt
      ) {
        if (
          typeof rawOptionStartAt !==
            "string" ||
          typeof rawOptionEndAt !==
            "string"
        ) {
          return NextResponse.json(
            {
              success: false,
              error:
                "startAt y endAt de una opción deben ser fechas ISO válidas",
            },
            {
              status: 400,
            },
          );
        }

        optionStartAt =
          new Date(
            rawOptionStartAt,
          );

        optionEndAt =
          new Date(
            rawOptionEndAt,
          );

        if (
          Number.isNaN(
            optionStartAt.getTime(),
          ) ||
          Number.isNaN(
            optionEndAt.getTime(),
          ) ||
          optionEndAt <=
            optionStartAt
        ) {
          return NextResponse.json(
            {
              success: false,
              error:
                "El intervalo de la opción no es válido",
            },
            {
              status: 400,
            },
          );
        }
      }

      optionSelections.push({
        serviceOptionId,
        optionalQuantity,

        startAt:
          optionStartAt,

        endAt:
          optionEndAt,
      });
    }

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

        pendingReservationHoldMinutes:
          true,
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

        /*
         * ─────────────────────────────────────────
         * 8. SERVICE PRICING
         * ─────────────────────────────────────────
         */

        const pricing = calculateHotelPrice(
          checkIn,
          checkOut,
          service.rates,
        );

        const serviceSubtotal =
          pricing.total;

        /*
         * ─────────────────────────────────────────
         * 9. OPTION QUOTE
         *
         * Toda la configuración monetaria
         * proviene de la base de datos.
         * ─────────────────────────────────────────
         */

        const optionQuote =
          await quoteHotelServiceOptions({
            businessId:
              business.id,

            serviceId:
              service.id,

            checkIn,
            checkOut,

            guests,

            selections:
              optionSelections,

            db:
              tx,
          });

        const optionSubtotal =
          optionQuote.subtotal;

        const subtotal =
          Math.round(
            (
              serviceSubtotal +
              optionSubtotal +
              Number.EPSILON
            ) *
              100,
          ) / 100;

        const total =
          subtotal;

        /*
         * Hotel V1 necesita al menos
         * un ResourceType obligatorio
         * para representar la habitación.
         */
        if (
          service.resourceTypes.length ===
          0
        ) {
          throw new Error(
            "SERVICE_RESOURCE_NOT_CONFIGURED",
          );
        }

        /*
         * ─────────────────────────────────────────
         * 10. PROSPECTIVE INVENTORY DEMAND
         *
         * Sumamos la demanda NUEVA antes
         * de persistir la reserva.
         *
         * Esto evita validar Service y Options
         * de forma independiente cuando comparten
         * el mismo ResourceType.
         * ─────────────────────────────────────────
         */

        const prospectiveDemands:
          ProspectiveInventoryDemand[] =
          [];

        /*
         * Demanda obligatoria del Service.
         *
         * ReservationService.quantity será 1.
         */
        for (
          const requirement of
          service.resourceTypes
        ) {
          prospectiveDemands.push({
            resourceTypeId:
              requirement
                .resourceTypeId,

            startAt,
            endAt,

            requiredResources:
              Math.max(
                requirement
                  .requiredQuantity,
                1,
              ),

            source:
              `SERVICE:${service.id}`,
          });
        }

        /*
         * Demanda física de Options.
         *
         * Si ReservationOption tiene
         * intervalo propio, usamos ese.
         *
         * Si no, hereda la reserva.
         */
        for (
          const optionItem of
          optionQuote.items
        ) {
          for (
            const requirement of
            optionItem.resourceTypes
          ) {
            prospectiveDemands.push({
              resourceTypeId:
                requirement
                  .resourceTypeId,

              startAt:
                optionItem.startAt ??
                startAt,

              endAt:
                optionItem.endAt ??
                endAt,

              requiredResources:
                requirement
                  .requiredResources,

              source:
                `OPTION:${optionItem.serviceOptionId}`,
            });
          }
        }

        const prospectiveInventory =
          await evaluateProspectiveInventory({
            businessId:
              business.id,

            serviceId:
              service.id,

            demands:
              prospectiveDemands,

            db:
              tx,
          });

        assertProspectiveInventoryAvailable(
          prospectiveInventory,
        );

        /*
         * ─────────────────────────────────────────
         * 11. AUTOMATIC SERVICE RESOURCE
         *
         * Conservamos la regla existente:
         *
         * Solo autoasignamos cuando el
         * ResourceType tiene exactamente
         * un Resource físico activo y el
         * Service necesita exactamente uno.
         *
         * Las Options NO se autoasignan aquí.
         * ─────────────────────────────────────────
         */

        const autoAssignResourceIds:
          string[] =
          [];

        for (
          const requirement of
          service.resourceTypes
        ) {
          const resourceType =
            requirement.resourceType;

          const requiredQuantity =
            Math.max(
              requirement
                .requiredQuantity,
              1,
            );

          if (
            requiredQuantity !== 1 ||
            resourceType
              .resources
              .length !== 1
          ) {
            continue;
          }

          const onlyResource =
            resourceType
              .resources[0];

          const inventory =
            await getResourceTypeInventoryState({
              businessId:
                business.id,

              resourceTypeId:
                resourceType.id,

              startAt,
              endAt,

              serviceId:
                service.id,

              db:
                tx,
            });

          if (
            inventory
              .availableResourceIds
              .includes(
                onlyResource.id,
              )
          ) {
            autoAssignResourceIds.push(
              onlyResource.id,
            );
          }
        }

        /*
         * ─────────────────────────────────────────
         * 12. CUSTOMER
         * ─────────────────────────────────────────
         */
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

        const reservationCreatedAt =
          new Date();

        const reservationExpiresAt =
          calculatePendingReservationExpiresAt(
            {
              createdAt:
                reservationCreatedAt,

              holdMinutes:
                business
                  .pendingReservationHoldMinutes,
            },
          );

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

            createdAt:
              reservationCreatedAt,

            expiresAt:
              reservationExpiresAt,

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
            unitPrice: serviceSubtotal / pricing.numberOfNights,

            subtotal: serviceSubtotal,
          },
        });

        // ─────────────────────────────────────────
        // 16. OPTIONAL RESOURCE ASSIGNMENT
        // ─────────────────────────────────────────

        /*
         * ─────────────────────────────────────────
         * RESERVATION OPTIONS
         *
         * Persistimos snapshots.
         *
         * Si la configuración cambia después,
         * la reserva conserva lo que realmente
         * fue comprado en este momento.
         * ─────────────────────────────────────────
         */

        for (
          const optionItem of
          optionQuote.items
        ) {
          await tx.reservationOption.create({
            data: {
              reservationId:
                reservation.id,

              reservationServiceId:
                reservationService.id,

              optionId:
                optionItem.optionId,

              serviceOptionId:
                optionItem.serviceOptionId,

              name:
                optionItem.name,

              description:
                optionItem.description,

              quantity:
                optionItem.quantity,

              includedQuantity:
                optionItem
                  .includedQuantity,

              optionalQuantity:
                optionItem
                  .optionalQuantity,

              unitPrice:
                optionItem.unitPrice,

              pricingBase:
                optionItem.pricingBase,

              pricingFrequency:
                optionItem
                  .pricingFrequency,

              billingUnits:
                optionItem.billingUnits,

              subtotal:
                optionItem.subtotal,

              startAt:
                optionItem.startAt,

              endAt:
                optionItem.endAt,
            },
          });
        }
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

            options: true,

            payments: true,
          },
        });

        return {
          reservation: completeReservation,

          pricing: {
            numberOfNights: pricing.numberOfNights,

            nightlyPrices: pricing.nightlyPrices,

            serviceSubtotal,

            optionSubtotal,

            total,
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

          expiresAt:
            reservation.expiresAt,

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

          options: reservation.options.map((item) => ({
            id:
              item.id,

            optionId:
              item.optionId,

            serviceOptionId:
              item.serviceOptionId,

            name:
              item.name,

            description:
              item.description,

            quantity:
              item.quantity,

            includedQuantity:
              item.includedQuantity,

            optionalQuantity:
              item.optionalQuantity,

            unitPrice:
              Number(
                item.unitPrice,
              ),

            pricingBase:
              item.pricingBase,

            pricingFrequency:
              item.pricingFrequency,

            billingUnits:
              Number(
                item.billingUnits,
              ),

            subtotal:
              Number(
                item.subtotal,
              ),

            startAt:
              item.startAt,

            endAt:
              item.endAt,
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
    /*
     * Inventario insuficiente detectado
     * durante la validación prospectiva.
     *
     * Es un conflicto normal de
     * disponibilidad, no un error 500.
     */
    if (
      error instanceof Error &&
      error.message ===
        "PROSPECTIVE_INVENTORY_NOT_AVAILABLE"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "El servicio o uno de sus complementos ya no tiene inventario suficiente para esas fechas",
        },
        {
          status: 409,
        },
      );
    }
    /*
     * Errores producidos por una selección
     * de opciones inválida enviada por el
     * cliente.
     */
    if (
      error instanceof Error &&
      [
        "DUPLICATE_OPTION_SELECTION",
        "SERVICE_OPTION_NOT_OPTIONAL",
        "INVALID_OPTIONAL_QUANTITY",
        "OPTIONAL_QUANTITY_BELOW_MINIMUM",
        "OPTIONAL_QUANTITY_ABOVE_MAXIMUM",
        "OPTION_PERSON_QUANTITY_EXCEEDS_GUESTS",
        "OPTION_INTERVAL_INCOMPLETE",
        "INVALID_OPTION_INTERVAL",
        "HOTEL_OPTION_HOURLY_INTERVAL_REQUIRED",
        "INVALID_OPTION_BILLING_UNITS",
      ].includes(error.message)
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Una o más opciones seleccionadas no son válidas para esta reserva",
          code: error.message,
        },
        {
          status: 400,
        },
      );
    }

    /*
     * La configuración pudo cambiar entre
     * la pantalla de reserva y el POST:
     *
     * - opción eliminada
     * - opción desactivada
     * - opción ya no disponible durante booking
     *
     * Lo tratamos como conflicto 409.
     */
    if (
      error instanceof Error &&
      [
        "SERVICE_OPTION_NOT_FOUND",
        "SERVICE_OPTION_NOT_ACTIVE",
        "SERVICE_OPTION_NOT_AVAILABLE_DURING_BOOKING",
      ].includes(error.message)
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Una de las opciones seleccionadas ya no está disponible",
          code: error.message,
        },
        {
          status: 409,
        },
      );
    }
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
