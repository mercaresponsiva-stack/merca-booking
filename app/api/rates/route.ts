import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const rates = await prisma.serviceRate.findMany({
      include: {
        service: {
          select: {
            id: true,
            businessId: true,
            name: true,
            slug: true,
            maxPeople: true,
            maxAdults: true,
            maxChildren: true,
          },
        },
      },
      orderBy: {
        startDate: "asc",
      },
    });

    return NextResponse.json({
      success: true,
      rates,
    });
  } catch (error) {
    console.error("GET /api/rates error:", error);

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
