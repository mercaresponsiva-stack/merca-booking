import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

const BLOCK_SCOPES = [
  "BUSINESS",
  "SERVICE",
  "RESOURCE_TYPE",
  "RESOURCE",
] as const;

type BlockScope = (typeof BLOCK_SCOPES)[number];

export async function PATCH(
  request: NextRequest,
  context: {
    params: Promise<{
      id: string;
    }>;
  },
) {
  try {
    const { id } = await context.params;

    const body = await request.json();

    const businessId =
      typeof body.businessId === "string" ? body.businessId.trim() : "";

    const scope = typeof body.scope === "string" ? body.scope.trim() : "";

    const targetId =
      typeof body.targetId === "string" ? body.targetId.trim() : "";

    const startAtRaw =
      typeof body.startAt === "string" ? body.startAt.trim() : "";

    const endAtRaw = typeof body.endAt === "string" ? body.endAt.trim() : "";

    const reason = typeof body.reason === "string" ? body.reason.trim() : "";

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

    if (!BLOCK_SCOPES.includes(scope as BlockScope)) {
      return NextResponse.json(
        {
          success: false,
          error: "Alcance de bloqueo inválido",
        },
        {
          status: 400,
        },
      );
    }

    const blockScope = scope as BlockScope;

    if (blockScope !== "BUSINESS" && !targetId) {
      return NextResponse.json(
        {
          success: false,
          error: "targetId es obligatorio para este alcance",
        },
        {
          status: 400,
        },
      );
    }

    if (blockScope === "BUSINESS" && targetId) {
      return NextResponse.json(
        {
          success: false,
          error: "Un bloqueo de negocio no debe tener targetId",
        },
        {
          status: 400,
        },
      );
    }

    if (!startAtRaw || !endAtRaw) {
      return NextResponse.json(
        {
          success: false,
          error: "startAt y endAt son obligatorios",
        },
        {
          status: 400,
        },
      );
    }

    const startAt = new Date(startAtRaw);

    const endAt = new Date(endAtRaw);

    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      return NextResponse.json(
        {
          success: false,
          error: "Las fechas del bloqueo son inválidas",
        },
        {
          status: 400,
        },
      );
    }

    if (startAt >= endAt) {
      return NextResponse.json(
        {
          success: false,
          error:
            "La fecha de finalización debe ser posterior a la fecha de inicio",
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

    const existingBlock = await prisma.block.findFirst({
      where: {
        id,
        businessId,
      },

      select: {
        id: true,
      },
    });

    if (!existingBlock) {
      return NextResponse.json(
        {
          success: false,
          error: "Bloqueo no encontrado para este negocio",
        },
        {
          status: 404,
        },
      );
    }

    let serviceId: string | null = null;

    let resourceTypeId: string | null = null;

    let resourceId: string | null = null;

    if (blockScope === "SERVICE") {
      const service = await prisma.service.findFirst({
        where: {
          id: targetId,
          businessId,
        },

        select: {
          id: true,
        },
      });

      if (!service) {
        return NextResponse.json(
          {
            success: false,
            error: "Servicio no encontrado para este negocio",
          },
          {
            status: 404,
          },
        );
      }

      serviceId = service.id;
    }

    if (blockScope === "RESOURCE_TYPE") {
      const resourceType = await prisma.resourceType.findFirst({
        where: {
          id: targetId,
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

      resourceTypeId = resourceType.id;
    }

    if (blockScope === "RESOURCE") {
      const resource = await prisma.resource.findFirst({
        where: {
          id: targetId,
          businessId,
        },

        select: {
          id: true,
        },
      });

      if (!resource) {
        return NextResponse.json(
          {
            success: false,
            error: "Recurso no encontrado para este negocio",
          },
          {
            status: 404,
          },
        );
      }

      resourceId = resource.id;
    }

    const block = await prisma.block.update({
      where: {
        id,
      },

      data: {
        serviceId,
        resourceTypeId,
        resourceId,

        startAt,
        endAt,

        reason: reason || null,
      },

      select: {
        id: true,
        businessId: true,

        serviceId: true,
        resourceTypeId: true,
        resourceId: true,

        startAt: true,
        endAt: true,

        reason: true,

        createdAt: true,
        updatedAt: true,

        service: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },

        resourceType: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },

        resource: {
          select: {
            id: true,
            name: true,
            code: true,
            resourceTypeId: true,
          },
        },
      },
    });

    return NextResponse.json({
      success: true,

      block: {
        ...block,
        scope: blockScope,
      },
    });
  } catch (error) {
    console.error("PATCH /api/blocks/[id] error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "No fue posible actualizar el bloqueo",
      },
      {
        status: 500,
      },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: {
    params: Promise<{
      id: string;
    }>;
  },
) {
  try {
    const { id } = await context.params;

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

    const block = await prisma.block.findFirst({
      where: {
        id,
        businessId,
      },

      select: {
        id: true,
        businessId: true,

        serviceId: true,
        resourceTypeId: true,
        resourceId: true,

        startAt: true,
        endAt: true,

        reason: true,

        createdAt: true,
      },
    });

    if (!block) {
      return NextResponse.json(
        {
          success: false,
          error: "Bloqueo no encontrado para este negocio",
        },
        {
          status: 404,
        },
      );
    }

    const deleted = await prisma.block.deleteMany({
      where: {
        id,
        businessId,
      },
    });

    if (deleted.count !== 1) {
      return NextResponse.json(
        {
          success: false,
          error: "El bloqueo ya no existe",
        },
        {
          status: 404,
        },
      );
    }

    return NextResponse.json({
      success: true,
      deletedBlock: block,
    });
  } catch (error) {
    console.error("DELETE /api/blocks/[id] error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "No fue posible eliminar el bloqueo",
      },
      {
        status: 500,
      },
    );
  }
}
