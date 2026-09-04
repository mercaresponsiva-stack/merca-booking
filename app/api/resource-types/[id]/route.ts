import { NextRequest, NextResponse } from "next/server";

import {
  AuthorizationError,
  requireAuthenticatedUser,
  requireBusinessAccess,
} from "@/lib/auth/business-access";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

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

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    await requireAuthenticatedUser();

    const { id } = await context.params;

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

    const hasName = Object.prototype.hasOwnProperty.call(body, "name");

    const hasSlug = Object.prototype.hasOwnProperty.call(body, "slug");

    const hasDescription = Object.prototype.hasOwnProperty.call(
      body,
      "description",
    );

    if (!hasName && !hasSlug && !hasDescription) {
      return privateJson(
        {
          success: false,
          error: "No se enviaron campos para actualizar",
        },
        {
          status: 400,
        },
      );
    }

    let name: string | undefined;

    let slug: string | undefined;

    let description: string | null | undefined;

    if (hasName) {
      if (typeof body.name !== "string") {
        return privateJson(
          {
            success: false,
            error: "El nombre debe ser texto",
          },
          {
            status: 400,
          },
        );
      }

      name = body.name.trim();

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
    }

    if (hasSlug) {
      if (typeof body.slug !== "string") {
        return privateJson(
          {
            success: false,
            error: "El slug debe ser texto",
          },
          {
            status: 400,
          },
        );
      }

      slug = body.slug.trim();

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
    }

    if (hasDescription) {
      if (body.description === null) {
        description = null;
      } else if (typeof body.description === "string") {
        const normalizedDescription = body.description.trim();

        description = normalizedDescription || null;
      } else {
        return privateJson(
          {
            success: false,
            error: "La descripción debe ser texto o null",
          },
          {
            status: 400,
          },
        );
      }
    }

    const result = await prisma.$transaction(
      async (tx) => {
        const existing = await tx.resourceType.findFirst({
          where: {
            id,
            businessId,
          },

          select: {
            id: true,
            businessId: true,

            name: true,
            slug: true,
          },
        });

        if (!existing) {
          throw new Error("RESOURCE_TYPE_NOT_FOUND");
        }

        const business = await tx.business.findFirst({
          where: {
            id: existing.businessId,

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

        if (slug !== undefined && slug !== existing.slug) {
          const duplicateSlug = await tx.resourceType.findFirst({
            where: {
              businessId: existing.businessId,

              slug,

              id: {
                not: id,
              },
            },

            select: {
              id: true,
            },
          });

          if (duplicateSlug) {
            throw new Error("RESOURCE_TYPE_SLUG_ALREADY_EXISTS");
          }
        }

        const resourceType = await tx.resourceType.update({
          where: {
            id,
          },

          data: {
            ...(name !== undefined
              ? {
                  name,
                }
              : {}),

            ...(slug !== undefined
              ? {
                  slug,
                }
              : {}),

            ...(description !== undefined
              ? {
                  description,
                }
              : {}),
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

    return privateJson({
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

    console.error("PATCH /api/resource-types/[id] error:", error);

    if (error instanceof Error) {
      switch (error.message) {
        case "RESOURCE_TYPE_NOT_FOUND":
          return privateJson(
            {
              success: false,
              error: "Tipo de inventario no encontrado",
            },
            {
              status: 404,
            },
          );

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
        error: "No fue posible actualizar el tipo de inventario",
      },
      {
        status: 500,
      },
    );
  }
}
