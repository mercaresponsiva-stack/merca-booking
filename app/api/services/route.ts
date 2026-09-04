import { NextRequest, NextResponse } from "next/server";

import { ACTIVE_RESERVATION_STATUSES } from "@/lib/booking/reservation-state";

import {
  AuthorizationError,
  requireAuthenticatedUser,
  requireBusinessAccess,
} from "@/lib/auth/business-access";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const SERVICE_READ_ALLOWED_ROLES = [
  "OWNER",
  "ADMIN",
  "RECEPTIONIST",
] as const;

const SERVICE_WRITE_ALLOWED_ROLES = [
  "OWNER",
  "ADMIN",
] as const;

function privateJson(
  body: unknown,
  init: ResponseInit = {},
) {
  const headers =
    new Headers(init.headers);

  headers.set(
    "Cache-Control",
    "private, no-store, max-age=0, must-revalidate",
  );
  headers.set(
    "Pragma",
    "no-cache",
  );
  headers.set(
    "Expires",
    "0",
  );
  headers.set(
    "X-Robots-Tag",
    "noindex, nofollow",
  );

  return NextResponse.json(
    body,
    {
      ...init,
      headers,
    },
  );
}

function isJsonObject(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

export async function GET(request: NextRequest) {
  try {
    await requireAuthenticatedUser();

    const { searchParams } = request.nextUrl;

    const businessId = searchParams.get("businessId")?.trim() ?? "";

    const includeInactive = searchParams.get("includeInactive") === "true";

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

    await requireBusinessAccess(
      businessId,
      SERVICE_READ_ALLOWED_ROLES,
    );

    const business = await prisma.business.findFirst({
      where: {
        id: businessId,
        isActive: true,
      },

      select: {
        id: true,
        name: true,
      },
    });

    if (!business) {
      return privateJson(
        {
          success: false,
          error: "Negocio no encontrado o inactivo",
        },
        {
          status: 404,
        },
      );
    }

    /*
     * CATÁLOGO OPERATIVO
     *
     * Mantiene exactamente la finalidad
     * actual del endpoint:
     *
     * - nueva reserva
     * - bloqueos
     * - selectores operativos
     *
     * Solo devuelve Services activos.
     */
    if (!includeInactive) {
      const services = await prisma.service.findMany({
        where: {
          businessId,
          isActive: true,
        },

        select: {
          id: true,
          name: true,
          slug: true,
          description: true,

          durationMinutes: true,

          maxPeople: true,
          maxAdults: true,
          maxChildren: true,
        },

        orderBy: {
          name: "asc",
        },
      });

      return privateJson({
        success: true,

        business,

        includeInactive: false,

        services,
      });
    }

    /*
     * CATÁLOGO ADMINISTRATIVO
     *
     * Incluye:
     *
     * - Services activos e inactivos
     * - ResourceTypes requeridos
     * - inventario físico asociado
     * - todas las tarifas
     * - cantidad de reservas activas
     *
     * Esta será la fuente de datos de
     * /admin/services.
     */
    const services = await prisma.service.findMany({
      where: {
        businessId,
      },

      select: {
        id: true,
        businessId: true,

        name: true,
        slug: true,
        description: true,

        durationMinutes: true,

        maxPeople: true,
        maxAdults: true,
        maxChildren: true,

        isActive: true,

        createdAt: true,
        updatedAt: true,

        resourceTypes: {
          select: {
            id: true,

            resourceTypeId: true,

            requiredQuantity: true,

            createdAt: true,

            resourceType: {
              select: {
                id: true,
                name: true,
                slug: true,
                description: true,

                resources: {
                  select: {
                    id: true,
                    isActive: true,
                  },
                },
              },
            },
          },

          orderBy: {
            resourceType: {
              name: "asc",
            },
          },
        },

        rates: {
          select: {
            id: true,

            name: true,

            startDate: true,
            endDate: true,

            weekdayPrice: true,

            weekendPrice: true,

            isActive: true,

            createdAt: true,
            updatedAt: true,
          },

          orderBy: [
            {
              startDate: "desc",
            },
            {
              createdAt: "desc",
            },
          ],
        },

        _count: {
          select: {
            reservations: {
              where: {
                reservation: {
                  businessId,

                  status: {
                    in: [...ACTIVE_RESERVATION_STATUSES],
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

    return privateJson({
      success: true,

      business,

      includeInactive: true,

      services: services.map((service) => ({
        id: service.id,
        businessId: service.businessId,

        name: service.name,
        slug: service.slug,

        description: service.description,

        durationMinutes: service.durationMinutes,

        maxPeople: service.maxPeople,

        maxAdults: service.maxAdults,

        maxChildren: service.maxChildren,

        isActive: service.isActive,

        createdAt: service.createdAt,

        updatedAt: service.updatedAt,

        activeReservationCount: service._count.reservations,

        resourceTypes: service.resourceTypes.map((requirement) => ({
          id: requirement.id,

          resourceTypeId: requirement.resourceTypeId,

          requiredQuantity: requirement.requiredQuantity,

          createdAt: requirement.createdAt,

          resourceType: {
            id: requirement.resourceType.id,

            name: requirement.resourceType.name,

            slug: requirement.resourceType.slug,

            description: requirement.resourceType.description,

            totalResourceCount: requirement.resourceType.resources.length,

            activeResourceCount: requirement.resourceType.resources.filter(
              (resource) => resource.isActive,
            ).length,
          },
        })),

        rates: service.rates,
      })),
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

    console.error("GET /api/services error:", error);

    return privateJson(
      {
        success: false,
        error: "No fue posible obtener los servicios",
      },
      {
        status: 500,
      },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    /*
     * Autenticamos antes de procesar el cuerpo
     * para no exponer validaciones administrativas
     * a solicitudes anónimas.
     */
    await requireAuthenticatedUser();

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return privateJson(
        {
          success: false,
          code: "INVALID_JSON",
          error:
            "El cuerpo de la solicitud no es JSON válido.",
        },
        {
          status: 400,
        },
      );
    }

    if (!isJsonObject(body)) {
      return privateJson(
        {
          success: false,
          code: "INVALID_SERVICE_BODY",
          error:
            "El cuerpo de la solicitud debe ser un objeto JSON válido.",
        },
        {
          status: 400,
        },
      );
    }

    const businessId =
      typeof body.businessId === "string" ? body.businessId.trim() : "";

    const name = typeof body.name === "string" ? body.name.trim() : "";

    const slug = typeof body.slug === "string" ? body.slug.trim() : "";

    const description =
      typeof body.description === "string" ? body.description.trim() : "";

    const durationMinutes =
      body.durationMinutes === null ||
      body.durationMinutes === "" ||
      body.durationMinutes === undefined
        ? null
        : Number(body.durationMinutes);

    const maxPeople = Number(body.maxPeople);

    const maxAdults =
      body.maxAdults === null ||
      body.maxAdults === "" ||
      body.maxAdults === undefined
        ? null
        : Number(body.maxAdults);

    const maxChildren =
      body.maxChildren === null ||
      body.maxChildren === "" ||
      body.maxChildren === undefined
        ? null
        : Number(body.maxChildren);

    const isActive = body.isActive === undefined ? false : body.isActive;

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

    await requireBusinessAccess(
      businessId,
      SERVICE_WRITE_ALLOWED_ROLES,
    );

    if (!name) {
      return privateJson(
        {
          success: false,
          error: "El nombre del servicio es obligatorio",
        },
        {
          status: 400,
        },
      );
    }

    if (!slug) {
      return privateJson(
        {
          success: false,
          error: "El slug del servicio es obligatorio",
        },
        {
          status: 400,
        },
      );
    }

    if (
      durationMinutes !== null &&
      (!Number.isInteger(durationMinutes) || durationMinutes < 1)
    ) {
      return privateJson(
        {
          success: false,
          error: "La duración debe ser un entero mayor o igual a 1",
        },
        {
          status: 400,
        },
      );
    }

    if (!Number.isInteger(maxPeople) || maxPeople < 1) {
      return privateJson(
        {
          success: false,
          error: "La capacidad máxima debe ser un entero mayor o igual a 1",
        },
        {
          status: 400,
        },
      );
    }

    if (maxAdults !== null && (!Number.isInteger(maxAdults) || maxAdults < 0)) {
      return privateJson(
        {
          success: false,
          error:
            "La cantidad máxima de adultos debe ser un entero mayor o igual a 0",
        },
        {
          status: 400,
        },
      );
    }

    if (
      maxChildren !== null &&
      (!Number.isInteger(maxChildren) || maxChildren < 0)
    ) {
      return privateJson(
        {
          success: false,
          error:
            "La cantidad máxima de niños debe ser un entero mayor o igual a 0",
        },
        {
          status: 400,
        },
      );
    }

    if (maxAdults !== null && maxAdults > maxPeople) {
      return privateJson(
        {
          success: false,
          error:
            "La cantidad máxima de adultos no puede superar la capacidad total",
        },
        {
          status: 400,
        },
      );
    }

    if (maxChildren !== null && maxChildren > maxPeople) {
      return privateJson(
        {
          success: false,
          error:
            "La cantidad máxima de niños no puede superar la capacidad total",
        },
        {
          status: 400,
        },
      );
    }

    if (typeof isActive !== "boolean") {
      return privateJson(
        {
          success: false,
          error: "isActive debe ser booleano",
        },
        {
          status: 400,
        },
      );
    }

    const result = await prisma.$transaction(
      async (tx) => {
        const business = await tx.business.findFirst({
          where: {
            id: businessId,
            isActive: true,
          },

          select: {
            id: true,
            name: true,
          },
        });

        if (!business) {
          throw new Error("BUSINESS_NOT_FOUND");
        }

        const duplicateSlug = await tx.service.findFirst({
          where: {
            businessId,
            slug,
          },

          select: {
            id: true,
          },
        });

        if (duplicateSlug) {
          throw new Error("SERVICE_SLUG_ALREADY_EXISTS");
        }

        const service = await tx.service.create({
          data: {
            businessId,

            name,
            slug,

            description: description || null,

            durationMinutes,

            maxPeople,
            maxAdults,
            maxChildren,

            isActive,
          },

          select: {
            id: true,
            businessId: true,

            name: true,
            slug: true,
            description: true,

            durationMinutes: true,

            maxPeople: true,
            maxAdults: true,
            maxChildren: true,

            isActive: true,

            createdAt: true,
            updatedAt: true,
          },
        });

        return {
          business,
          service,
        };
      },
      {
        isolationLevel: "Serializable",
      },
    );

    return privateJson(
      {
        success: true,

        business: result.business,

        service: result.service,
      },
      {
        status: 201,
      },
    );
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

    console.error("POST /api/services error:", error);

    if (error instanceof Error) {
      switch (error.message) {
        case "BUSINESS_NOT_FOUND":
          return privateJson(
            {
              success: false,
              error: "Negocio no encontrado o inactivo",
            },
            {
              status: 404,
            },
          );

        case "SERVICE_SLUG_ALREADY_EXISTS":
          return privateJson(
            {
              success: false,
              error: "Ya existe otro servicio con ese slug",
            },
            {
              status: 409,
            },
          );
      }
    }

    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (
        error as {
          code?: string;
        }
      ).code === "P2002"
    ) {
      return privateJson(
        {
          success: false,
          error: "Ya existe otro servicio con ese slug",
        },
        {
          status: 409,
        },
      );
    }

    return privateJson(
      {
        success: false,
        error: "No fue posible crear el servicio",
      },
      {
        status: 500,
      },
    );
  }
}
