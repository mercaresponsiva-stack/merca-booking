import { NextRequest, NextResponse } from "next/server";

import { ACTIVE_RESERVATION_STATUSES } from "@/lib/booking/reservation-state";

import {
  AuthorizationError,
  requireAuthenticatedUser,
  requireBusinessAccess,
} from "@/lib/auth/business-access";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const RESOURCE_READ_ALLOWED_ROLES = [
  "OWNER",
  "ADMIN",
  "RECEPTIONIST",
] as const;

const RESOURCE_WRITE_ALLOWED_ROLES = [
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

    const resourceTypeId = searchParams.get("resourceTypeId")?.trim() ?? "";

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
      RESOURCE_READ_ALLOWED_ROLES,
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

    if (resourceTypeId) {
      const resourceType = await prisma.resourceType.findFirst({
        where: {
          id: resourceTypeId,
          businessId,
        },

        select: {
          id: true,
        },
      });

      if (!resourceType) {
        return privateJson(
          {
            success: false,
            error: "Tipo de recurso no encontrado para este negocio",
          },
          {
            status: 404,
          },
        );
      }
    }

    const resources = await prisma.resource.findMany({
      where: {
        businessId,

        ...(!includeInactive
          ? {
              isActive: true,
            }
          : {}),

        ...(resourceTypeId
          ? {
              resourceTypeId,
            }
          : {}),
      },

      orderBy: [
        {
          resourceType: {
            name: "asc",
          },
        },
        {
          code: "asc",
        },
        {
          name: "asc",
        },
      ],

      select: {
        id: true,

        name: true,
        code: true,

        resourceTypeId: true,

        floor: true,
        capacity: true,

        isActive: true,

        createdAt: true,
        updatedAt: true,

        resourceType: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },

        /*
         * Solo necesitamos las asignaciones
         * que siguen consumiendo inventario.
         *
         * Las reservas históricas continúan
         * relacionadas en la base, pero no
         * impiden desactivar el Resource.
         */
        reservations: {
          where: {
            reservation: {
              businessId,

              status: {
                in: [...ACTIVE_RESERVATION_STATUSES],
              },
            },
          },

          select: {
            id: true,

            reservation: {
              select: {
                id: true,

                confirmationCode: true,

                status: true,

                startAt: true,
                endAt: true,

                customer: {
                  select: {
                    id: true,

                    firstName: true,

                    lastName: true,
                  },
                },
              },
            },
          },

          orderBy: {
            reservation: {
              startAt: "asc",
            },
          },
        },
      },
    });

    return privateJson({
      success: true,

      business,

      resourceTypeId: resourceTypeId || null,

      includeInactive,

      items: resources.map((resource) => ({
        id: resource.id,

        name: resource.name,
        code: resource.code,

        resourceTypeId: resource.resourceTypeId,

        floor: resource.floor,
        capacity: resource.capacity,

        isActive: resource.isActive,

        createdAt: resource.createdAt,

        updatedAt: resource.updatedAt,

        resourceType: resource.resourceType,

        activeReservationCount: resource.reservations.length,

        activeReservations: resource.reservations.map((assignment) => ({
          assignmentId: assignment.id,

          id: assignment.reservation.id,

          confirmationCode: assignment.reservation.confirmationCode,

          status: assignment.reservation.status,

          startAt: assignment.reservation.startAt,

          endAt: assignment.reservation.endAt,

          customer: assignment.reservation.customer,
        })),
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

    console.error("GET /api/resources error:", error);

    return privateJson(
      {
        success: false,
        error: "No fue posible obtener los recursos",
      },
      {
        status: 500,
      },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
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
          code: "INVALID_RESOURCE_BODY",
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

    const code = typeof body.code === "string" ? body.code.trim() : "";

    const resourceTypeId =
      typeof body.resourceTypeId === "string" ? body.resourceTypeId.trim() : "";

    const floor =
      body.floor === null || body.floor === "" || body.floor === undefined
        ? null
        : Number(body.floor);

    const capacity = Number(body.capacity);

    const isActive = body.isActive === undefined ? true : body.isActive;

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
      RESOURCE_WRITE_ALLOWED_ROLES,
    );

    if (!name) {
      return privateJson(
        {
          success: false,
          error: "El nombre del recurso es obligatorio",
        },
        {
          status: 400,
        },
      );
    }

    if (!resourceTypeId) {
      return privateJson(
        {
          success: false,
          error: "resourceTypeId es obligatorio",
        },
        {
          status: 400,
        },
      );
    }

    if (floor !== null && (!Number.isInteger(floor) || floor < 0)) {
      return privateJson(
        {
          success: false,
          error: "El piso debe ser un entero mayor o igual a 0",
        },
        {
          status: 400,
        },
      );
    }

    if (!Number.isInteger(capacity) || capacity < 1) {
      return privateJson(
        {
          success: false,
          error: "La capacidad debe ser un entero mayor o igual a 1",
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

    const createdResource = await prisma.$transaction(
      async (tx) => {
        const business = await tx.business.findFirst({
          where: {
            id: businessId,
            isActive: true,
          },

          select: {
            id: true,
          },
        });

        if (!business) {
          throw new Error("BUSINESS_NOT_FOUND");
        }

        const resourceType = await tx.resourceType.findFirst({
          where: {
            id: resourceTypeId,
            businessId,
          },

          select: {
            id: true,
          },
        });

        if (!resourceType) {
          throw new Error("RESOURCE_TYPE_NOT_FOUND");
        }

        /*
         * El código puede ser null,
         * pero si existe debe ser único
         * dentro del Business.
         */
        if (code) {
          const duplicateCode = await tx.resource.findFirst({
            where: {
              businessId,
              code,
            },

            select: {
              id: true,
            },
          });

          if (duplicateCode) {
            throw new Error("RESOURCE_CODE_ALREADY_EXISTS");
          }
        }

        return tx.resource.create({
          data: {
            businessId,

            name,

            code: code || null,

            resourceTypeId,

            floor,

            capacity,

            isActive,
          },

          select: {
            id: true,
            businessId: true,

            name: true,
            code: true,

            resourceTypeId: true,

            floor: true,
            capacity: true,

            isActive: true,

            createdAt: true,
            updatedAt: true,

            resourceType: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
          },
        });
      },
      {
        isolationLevel: "Serializable",
      },
    );

    return privateJson(
      {
        success: true,

        resource: {
          ...createdResource,

          activeReservationCount: 0,

          activeReservations: [],
        },
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

    console.error("POST /api/resources error:", error);

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

        case "RESOURCE_TYPE_NOT_FOUND":
          return privateJson(
            {
              success: false,
              error: "Tipo de recurso no encontrado para este negocio",
            },
            {
              status: 404,
            },
          );

        case "RESOURCE_CODE_ALREADY_EXISTS":
          return privateJson(
            {
              success: false,
              error: "Ya existe otro recurso con ese código",
            },
            {
              status: 409,
            },
          );
      }
    }

    /*
     * Protección adicional si la base
     * también tiene una restricción
     * UNIQUE para el código.
     */
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
          error: "Ya existe otro recurso con ese código",
        },
        {
          status: 409,
        },
      );
    }

    return privateJson(
      {
        success: false,
        error: "No fue posible crear el recurso",
      },
      {
        status: 500,
      },
    );
  }
}
