import { NextRequest, NextResponse } from "next/server";

import {
  AuthorizationError,
  requireAuthenticatedUser,
  requireBusinessAccess,
} from "@/lib/auth/business-access";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const RESOURCE_TYPE_READ_ALLOWED_ROLES = [
  "OWNER",
  "ADMIN",
  "RECEPTIONIST",
] as const;

const RESOURCE_TYPE_WRITE_ALLOWED_ROLES = [
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

    const businessId =
      request.nextUrl.searchParams.get("businessId")?.trim() ?? "";

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
      RESOURCE_TYPE_READ_ALLOWED_ROLES,
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

    const resourceTypes = await prisma.resourceType.findMany({
      where: {
        businessId,
      },

      orderBy: {
        name: "asc",
      },

      select: {
        id: true,
        name: true,
        slug: true,
        description: true,

        _count: {
          select: {
            resources: {
              where: {
                isActive: true,
              },
            },
          },
        },
      },
    });

    return privateJson({
      success: true,

      business,

      items: resourceTypes.map((resourceType) => ({
        id: resourceType.id,
        name: resourceType.name,
        slug: resourceType.slug,
        description: resourceType.description,

        activeResourceCount: resourceType._count.resources,
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

    console.error("GET /api/resource-types error:", error);

    return privateJson(
      {
        success: false,
        error: "No fue posible obtener los tipos de recurso",
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
          code: "INVALID_RESOURCE_TYPE_BODY",
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
      RESOURCE_TYPE_WRITE_ALLOWED_ROLES,
    );

    if (!name) {
      return privateJson(
        {
          success: false,
          error: "El nombre del tipo de inventario es obligatorio",
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
          error: "El slug del tipo de inventario es obligatorio",
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

        const duplicateSlug = await tx.resourceType.findFirst({
          where: {
            businessId,
            slug,
          },

          select: {
            id: true,
          },
        });

        if (duplicateSlug) {
          throw new Error("RESOURCE_TYPE_SLUG_ALREADY_EXISTS");
        }

        const resourceType = await tx.resourceType.create({
          data: {
            businessId,

            name,
            slug,

            description: description || null,
          },

          select: {
            id: true,
            businessId: true,

            name: true,
            slug: true,

            description: true,

            createdAt: true,
            updatedAt: true,

            _count: {
              select: {
                resources: {
                  where: {
                    isActive: true,
                  },
                },
              },
            },
          },
        });

        return {
          business,

          resourceType,
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

        item: {
          id: result.resourceType.id,

          businessId: result.resourceType.businessId,

          name: result.resourceType.name,

          slug: result.resourceType.slug,

          description: result.resourceType.description,

          activeResourceCount: result.resourceType._count.resources,

          createdAt: result.resourceType.createdAt,

          updatedAt: result.resourceType.updatedAt,
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

    console.error("POST /api/resource-types error:", error);

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

        case "RESOURCE_TYPE_SLUG_ALREADY_EXISTS":
          return privateJson(
            {
              success: false,
              error: "Ya existe un tipo de inventario con ese slug",
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
          error: "Ya existe un tipo de inventario con ese slug",
        },
        {
          status: 409,
        },
      );
    }

    return privateJson(
      {
        success: false,
        error: "No fue posible crear el tipo de inventario",
      },
      {
        status: 500,
      },
    );
  }
}
