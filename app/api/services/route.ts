import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;

    const businessId = searchParams.get("businessId")?.trim() ?? "";

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

    return NextResponse.json({
      success: true,

      business,

      services,
    });
  } catch (error) {
    console.error("GET /api/services error:", error);

    return NextResponse.json(
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
