import { NextRequest, NextResponse } from "next/server";

import { dateOnlyToUtc, isValidDateOnly } from "@/lib/booking/datetime";

import {
  AuthorizationError,
  requireAuthenticatedUser,
  requireBusinessAccess,
} from "@/lib/auth/business-access";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const RATE_WRITE_ALLOWED_ROLES = [
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
function dateOnlyToUtcEndOfDay(value: string) {
  const date = dateOnlyToUtc(value);

  return new Date(date.getTime() + 24 * 60 * 60 * 1000 - 1);
}

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
          code: "INVALID_RATE_BODY",
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

    const startDateInput =
      typeof body.startDate === "string" ? body.startDate.trim() : "";

    const endDateInput =
      typeof body.endDate === "string" ? body.endDate.trim() : "";

    const weekdayPrice = Number(body.weekdayPrice);

    const weekendPrice = Number(body.weekendPrice);

    const isActive = body.isActive;

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
      RATE_WRITE_ALLOWED_ROLES,
    );

    if (!name) {
      return privateJson(
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
      return privateJson(
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

    const endDate = dateOnlyToUtcEndOfDay(endDateInput);

    if (endDate < startDate) {
      return privateJson(
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
      return privateJson(
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
      return privateJson(
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
      return privateJson(
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
      return privateJson(
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

    return privateJson({
      success: true,
      rate: result.rate,
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

    console.error("PATCH /api/rates/[id] error:", error);

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

        case "RATE_NOT_FOUND":
          return privateJson(
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

    return privateJson(
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
