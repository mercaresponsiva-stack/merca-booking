import { NextRequest, NextResponse } from "next/server";

import {
  AuthorizationError,
  requireAuthenticatedUser,
  requireBusinessAccess,
} from "@/lib/auth/business-access";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const BLOCK_ALLOWED_ROLES = [
  "OWNER",
  "ADMIN",
  "RECEPTIONIST",
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

const BLOCK_SCOPES = [
  "BUSINESS",
  "SERVICE",
  "RESOURCE_TYPE",
  "RESOURCE",
] as const;

type BlockScope = (typeof BLOCK_SCOPES)[number];

function getBlockScope(input: {
  serviceId: string | null;
  resourceTypeId: string | null;
  resourceId: string | null;
}): BlockScope {
  if (input.resourceId) {
    return "RESOURCE";
  }

  if (input.resourceTypeId) {
    return "RESOURCE_TYPE";
  }

  if (input.serviceId) {
    return "SERVICE";
  }

  return "BUSINESS";
}

function parsePositiveInteger(value: string | null, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }

  return parsed;
}

export async function GET(request: NextRequest) {
  try {
    await requireAuthenticatedUser();

    const { searchParams } = request.nextUrl;

    const businessId = searchParams.get("businessId")?.trim() ?? "";

    const page = parsePositiveInteger(searchParams.get("page"), 1);

    const pageSize = parsePositiveInteger(searchParams.get("pageSize"), 50);

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
      BLOCK_ALLOWED_ROLES,
    );

    if (page === null || pageSize === null || pageSize > 100) {
      return privateJson(
        {
          success: false,
          error: "Paginación inválida",
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
      return privateJson(
        {
          success: false,
          error: "Negocio no encontrado o inactivo",
        },
        {
          status: 404,
        },
      );
    }

    const where = {
      businessId,
    };

    const [totalItems, blocks] = await Promise.all([
      prisma.block.count({
        where,
      }),

      prisma.block.findMany({
        where,

        orderBy: [
          {
            createdAt: "desc",
          },
          {
            startAt: "desc",
          },
        ],

        skip: (page - 1) * pageSize,

        take: pageSize,

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
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

    return privateJson({
      success: true,

      business,

      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages,

        hasPreviousPage: page > 1,

        hasNextPage: page < totalPages,
      },

      items: blocks.map((block) => ({
        ...block,

        scope: getBlockScope(block),
      })),
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

    console.error("GET /api/blocks error:", error);

    return privateJson(
      {
        success: false,
        error: "No fue posible obtener los bloqueos",
      },
      {
        status: 500,
      },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAuthenticatedUser();

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
          code: "INVALID_BLOCK_BODY",
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

    const scope = typeof body.scope === "string" ? body.scope.trim() : "";

    const targetId =
      typeof body.targetId === "string" ? body.targetId.trim() : "";

    const startAtRaw =
      typeof body.startAt === "string" ? body.startAt.trim() : "";

    const endAtRaw = typeof body.endAt === "string" ? body.endAt.trim() : "";

    const reason = typeof body.reason === "string" ? body.reason.trim() : "";

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
      BLOCK_ALLOWED_ROLES,
    );

    if (!BLOCK_SCOPES.includes(scope as BlockScope)) {
      return privateJson(
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
      return privateJson(
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
      return privateJson(
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
      return privateJson(
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
      return privateJson(
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
      return privateJson(
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
        name: true,
      },
    });

    if (!business) {
      return privateJson(
        {
          success: false,
          error: "Negocio no encontrado o inactivo",
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
        return privateJson(
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
        return privateJson(
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
        return privateJson(
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

    const block = await prisma.block.create({
      data: {
        businessId,

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

    return privateJson(
      {
        success: true,

        block: {
          ...block,

          scope: getBlockScope(block),
        },
      },
      {
        status: 201,
      },
    );
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

    console.error("POST /api/blocks error:", error);

    return privateJson(
      {
        success: false,
        error: "No fue posible crear el bloqueo",
      },
      {
        status: 500,
      },
    );
  }
}
