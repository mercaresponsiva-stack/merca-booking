import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const businessId =
      request.nextUrl.searchParams.get("businessId")?.trim() ?? "";

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

    return NextResponse.json({
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
    console.error("GET /api/resource-types error:", error);

    return NextResponse.json(
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
    const body = await request.json();

    const businessId =
      typeof body.businessId === "string" ? body.businessId.trim() : "";

    const name = typeof body.name === "string" ? body.name.trim() : "";

    const slug = typeof body.slug === "string" ? body.slug.trim() : "";

    const description =
      typeof body.description === "string" ? body.description.trim() : "";

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

    return NextResponse.json(
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
    console.error("POST /api/resource-types error:", error);

    if (error instanceof Error) {
      switch (error.message) {
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
        error: "No fue posible crear el tipo de inventario",
      },
      {
        status: 500,
      },
    );
  }
}
