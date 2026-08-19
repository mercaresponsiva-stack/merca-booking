import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;

    const body = await request.json();

    const hasName = Object.prototype.hasOwnProperty.call(body, "name");

    const hasSlug = Object.prototype.hasOwnProperty.call(body, "slug");

    const hasDescription = Object.prototype.hasOwnProperty.call(
      body,
      "description",
    );

    if (!hasName && !hasSlug && !hasDescription) {
      return NextResponse.json(
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
        return NextResponse.json(
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
        return NextResponse.json(
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
        return NextResponse.json(
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
        return NextResponse.json(
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
        return NextResponse.json(
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
        const existing = await tx.resourceType.findUnique({
          where: {
            id,
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

    return NextResponse.json({
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
    console.error("PATCH /api/resource-types/[id] error:", error);

    if (error instanceof Error) {
      switch (error.message) {
        case "RESOURCE_TYPE_NOT_FOUND":
          return NextResponse.json(
            {
              success: false,
              error: "Tipo de inventario no encontrado",
            },
            {
              status: 404,
            },
          );

        case "BUSINESS_NOT_FOUND":
          return NextResponse.json(
            {
              success: false,
              error: "Negocio no encontrado o inactivo",
            },
            {
              status: 404,
            },
          );

        case "RESOURCE_TYPE_SLUG_ALREADY_EXISTS":
          return NextResponse.json(
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
      return NextResponse.json(
        {
          success: false,
          error: "Ya existe un tipo de inventario con ese slug",
        },
        {
          status: 409,
        },
      );
    }

    return NextResponse.json(
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
