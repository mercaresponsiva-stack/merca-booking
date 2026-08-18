import { NextRequest, NextResponse } from "next/server";

import { dateOnlyToUtc, isValidDateOnly } from "@/lib/booking/datetime";

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

    const businessId =
      typeof body.businessId === "string" ? body.businessId.trim() : "";

    const name = typeof body.name === "string" ? body.name.trim() : "";

    const startDateInput =
      typeof body.startDate === "string" ? body.startDate.trim() : "";

    const endDateInput =
      typeof body.endDate === "string" ? body.endDate.trim() : "";

    const weekdayPrice = Number(body.weekdayPrice);

    const weekendPrice = Number(body.weekendPrice);

    const isActive = body.isActive;

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
          error: "El nombre de la tarifa es obligatorio",
        },
        {
          status: 400,
        },
      );
    }

    if (!isValidDateOnly(startDateInput) || !isValidDateOnly(endDateInput)) {
      return NextResponse.json(
        {
          success: false,
          error: "startDate y endDate deben usar el formato YYYY-MM-DD",
        },
        {
          status: 400,
        },
      );
    }

    const startDate = dateOnlyToUtc(startDateInput);

    const endDate = dateOnlyToUtc(endDateInput);

    if (endDate < startDate) {
      return NextResponse.json(
        {
          success: false,
          error: "endDate no puede ser anterior a startDate",
        },
        {
          status: 400,
        },
      );
    }

    if (!Number.isFinite(weekdayPrice) || weekdayPrice < 0) {
      return NextResponse.json(
        {
          success: false,
          error: "weekdayPrice debe ser un número mayor o igual a 0",
        },
        {
          status: 400,
        },
      );
    }

    if (!Number.isFinite(weekendPrice) || weekendPrice < 0) {
      return NextResponse.json(
        {
          success: false,
          error: "weekendPrice debe ser un número mayor o igual a 0",
        },
        {
          status: 400,
        },
      );
    }

    if (typeof isActive !== "boolean") {
      return NextResponse.json(
        {
          success: false,
          error: "isActive debe ser booleano",
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
          },
        });

        if (!business) {
          throw new Error("BUSINESS_NOT_FOUND");
        }

        const rate = await tx.serviceRate.findFirst({
          where: {
            id,

            service: {
              businessId,
            },
          },

          select: {
            id: true,
            serviceId: true,

            service: {
              select: {
                id: true,
                name: true,
                slug: true,
                isActive: true,
              },
            },
          },
        });

        if (!rate) {
          throw new Error("RATE_NOT_FOUND");
        }

        if (isActive) {
          const overlappingRate = await tx.serviceRate.findFirst({
            where: {
              serviceId: rate.serviceId,

              isActive: true,

              id: {
                not: id,
              },

              startDate: {
                lte: endDate,
              },

              endDate: {
                gte: startDate,
              },
            },

            select: {
              id: true,
              name: true,
              startDate: true,
              endDate: true,
            },
          });

          if (overlappingRate) {
            return {
              ok: false as const,

              reason: "RATE_OVERLAP" as const,

              conflictingRate: overlappingRate,
            };
          }
        }

        const updatedRate = await tx.serviceRate.update({
          where: {
            id,
          },

          data: {
            name,

            startDate,
            endDate,

            weekdayPrice,
            weekendPrice,

            isActive,
          },

          select: {
            id: true,
            serviceId: true,

            name: true,

            startDate: true,
            endDate: true,

            weekdayPrice: true,
            weekendPrice: true,

            isActive: true,

            createdAt: true,
            updatedAt: true,

            service: {
              select: {
                id: true,
                name: true,
                slug: true,
                isActive: true,
              },
            },
          },
        });

        return {
          ok: true as const,
          rate: updatedRate,
        };
      },
      {
        isolationLevel: "Serializable",
      },
    );

    if (!result.ok) {
      return NextResponse.json(
        {
          success: false,

          error:
            "La tarifa se solapa con otra tarifa activa del mismo servicio.",

          code: "SERVICE_RATE_OVERLAP",

          conflictingRate: result.conflictingRate,
        },
        {
          status: 409,
        },
      );
    }

    return NextResponse.json({
      success: true,
      rate: result.rate,
    });
  } catch (error) {
    console.error("PATCH /api/rates/[id] error:", error);

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

        case "RATE_NOT_FOUND":
          return NextResponse.json(
            {
              success: false,
              error: "Tarifa no encontrada para este negocio",
            },
            {
              status: 404,
            },
          );
      }
    }

    return NextResponse.json(
      {
        success: false,
        error: "No fue posible actualizar la tarifa",
      },
      {
        status: 500,
      },
    );
  }
}
