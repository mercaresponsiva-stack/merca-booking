import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const business = await prisma.business.findUnique({
      where: {
        slug: "hotel-demo",
      },
      include: {
        businessType: true,
        services: {
          where: {
            isActive: true,
          },
          include: {
            rates: {
              where: {
                isActive: true,
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
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!business) {
      return NextResponse.json(
        {
          success: false,
          error: "Business not found",
        },
        {
          status: 404,
        },
      );
    }

    return NextResponse.json({
      success: true,
      business,
    });
  } catch (error) {
    console.error("GET /api/hotel error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Internal server error",
      },
      {
        status: 500,
      },
    );
  }
}
