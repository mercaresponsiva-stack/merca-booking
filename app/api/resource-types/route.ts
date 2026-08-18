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
