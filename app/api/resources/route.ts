import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;

    const businessId = searchParams.get("businessId")?.trim() ?? "";

    const resourceTypeId = searchParams.get("resourceTypeId")?.trim() ?? "";

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
        return NextResponse.json(
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
        isActive: true,

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

        resourceType: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });

    return NextResponse.json({
      success: true,

      business,

      resourceTypeId: resourceTypeId || null,

      items: resources,
    });
  } catch (error) {
    console.error("GET /api/resources error:", error);

    return NextResponse.json(
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
