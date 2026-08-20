import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

function parseDateTime(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

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

    const policies = await prisma.refundPolicy.findMany({
      where: {
        businessId,
      },

      orderBy: [
        {
          effectiveFrom: "desc",
        },

        {
          createdAt: "desc",
        },
      ],

      select: {
        id: true,
        businessId: true,

        name: true,

        fullRefundDays: true,

        annualAdministrativeRate: true,

        effectiveFrom: true,
        effectiveTo: true,

        isActive: true,

        createdAt: true,
        updatedAt: true,

        _count: {
          select: {
            refunds: true,
          },
        },
      },
    });

    const now = new Date();

    return NextResponse.json({
      success: true,

      business,

      items: policies.map((policy) => ({
        id: policy.id,

        businessId: policy.businessId,

        name: policy.name,

        fullRefundDays: policy.fullRefundDays,

        annualAdministrativeRate: Number(policy.annualAdministrativeRate),

        effectiveFrom: policy.effectiveFrom,

        effectiveTo: policy.effectiveTo,

        isActive: policy.isActive,

        isCurrent:
          policy.isActive &&
          policy.effectiveFrom <= now &&
          (policy.effectiveTo === null || policy.effectiveTo >= now),

        refundCount: policy._count.refunds,

        createdAt: policy.createdAt,

        updatedAt: policy.updatedAt,
      })),
    });
  } catch (error) {
    console.error("GET /api/refund-policies error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "No fue posible obtener las políticas de reembolso",
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

    const fullRefundDays = Number(body.fullRefundDays);

    const annualAdministrativeRate = Number(body.annualAdministrativeRate);

    const effectiveFrom =
      body.effectiveFrom === undefined ||
      body.effectiveFrom === null ||
      body.effectiveFrom === ""
        ? new Date()
        : parseDateTime(body.effectiveFrom);

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
          error: "El nombre de la política es obligatorio",
        },
        {
          status: 400,
        },
      );
    }

    if (!Number.isInteger(fullRefundDays) || fullRefundDays < 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Los días de devolución completa deben ser un entero mayor o igual a 0",
        },
        {
          status: 400,
        },
      );
    }

    if (
      !Number.isFinite(annualAdministrativeRate) ||
      annualAdministrativeRate < 0 ||
      annualAdministrativeRate > 1
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "La tasa administrativa anual debe estar entre 0 y 1",
        },
        {
          status: 400,
        },
      );
    }

    if (!effectiveFrom) {
      return NextResponse.json(
        {
          success: false,
          error: "La fecha de vigencia no es válida",
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

        /*
         * No permitimos insertar
         * retrospectivamente una
         * versión en medio del
         * historial desde este
         * endpoint administrativo.
         *
         * La nueva versión debe ser
         * posterior a la última.
         */
        const latestPolicy = await tx.refundPolicy.findFirst({
          where: {
            businessId,
          },

          orderBy: {
            effectiveFrom: "desc",
          },

          select: {
            id: true,

            effectiveFrom: true,

            effectiveTo: true,

            isActive: true,
          },
        });

        if (latestPolicy && effectiveFrom <= latestPolicy.effectiveFrom) {
          throw new Error("REFUND_POLICY_EFFECTIVE_FROM_NOT_AFTER_LATEST");
        }

        /*
         * Como la consulta de
         * cancelación trata
         * effectiveTo como inclusivo,
         * cerramos la versión previa
         * exactamente 1 ms antes de
         * la nueva.
         *
         * Conservamos isActive=true:
         * significa que la versión
         * sigue siendo válida dentro
         * de su período histórico.
         */
        if (latestPolicy && latestPolicy.isActive) {
          const previousEffectiveTo = new Date(effectiveFrom.getTime() - 1);

          await tx.refundPolicy.update({
            where: {
              id: latestPolicy.id,
            },

            data: {
              effectiveTo: previousEffectiveTo,
            },
          });
        }

        const policy = await tx.refundPolicy.create({
          data: {
            businessId,

            name,

            fullRefundDays,

            annualAdministrativeRate,

            effectiveFrom,

            effectiveTo: null,

            isActive: true,
          },

          select: {
            id: true,
            businessId: true,

            name: true,

            fullRefundDays: true,

            annualAdministrativeRate: true,

            effectiveFrom: true,

            effectiveTo: true,

            isActive: true,

            createdAt: true,

            updatedAt: true,
          },
        });

        return {
          business,
          policy,
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
          ...result.policy,

          annualAdministrativeRate: Number(
            result.policy.annualAdministrativeRate,
          ),

          isCurrent:
            result.policy.isActive &&
            result.policy.effectiveFrom <= new Date() &&
            (result.policy.effectiveTo === null ||
              result.policy.effectiveTo >= new Date()),

          refundCount: 0,
        },
      },
      {
        status: 201,
      },
    );
  } catch (error) {
    console.error("POST /api/refund-policies error:", error);

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

        case "REFUND_POLICY_EFFECTIVE_FROM_NOT_AFTER_LATEST":
          return NextResponse.json(
            {
              success: false,
              error:
                "La nueva política debe iniciar después de la última versión existente",
            },
            {
              status: 409,
            },
          );
      }
    }

    return NextResponse.json(
      {
        success: false,
        error: "No fue posible crear la política de reembolso",
      },
      {
        status: 500,
      },
    );
  }
}
