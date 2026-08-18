import { NextRequest, NextResponse } from "next/server";

import { ACTIVE_RESERVATION_STATUSES } from "@/lib/booking/reservation-state";

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

    const code = typeof body.code === "string" ? body.code.trim() : "";

    const resourceTypeId =
      typeof body.resourceTypeId === "string" ? body.resourceTypeId.trim() : "";

    const floor =
      body.floor === null || body.floor === "" || body.floor === undefined
        ? null
        : Number(body.floor);

    const capacity = Number(body.capacity);

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
          error: "El nombre del recurso es obligatorio",
        },
        {
          status: 400,
        },
      );
    }

    if (!resourceTypeId) {
      return NextResponse.json(
        {
          success: false,
          error: "resourceTypeId es obligatorio",
        },
        {
          status: 400,
        },
      );
    }

    if (floor !== null && (!Number.isInteger(floor) || floor < 0)) {
      return NextResponse.json(
        {
          success: false,
          error: "El piso debe ser un entero mayor o igual a 0",
        },
        {
          status: 400,
        },
      );
    }

    if (!Number.isInteger(capacity) || capacity < 1) {
      return NextResponse.json(
        {
          success: false,
          error: "La capacidad debe ser un entero mayor o igual a 1",
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

        const resource = await tx.resource.findFirst({
          where: {
            id,
            businessId,
          },

          select: {
            id: true,
            isActive: true,
            resourceTypeId: true,
          },
        });

        if (!resource) {
          throw new Error("RESOURCE_NOT_FOUND");
        }

        const resourceType = await tx.resourceType.findFirst({
          where: {
            id: resourceTypeId,
            businessId,
          },

          select: {
            id: true,
          },
        });

        if (!resourceType) {
          throw new Error("RESOURCE_TYPE_NOT_FOUND");
        }

        /*
         * Code es único por Business.
         *
         * Validamos antes del update para
         * devolver un mensaje comprensible.
         */
        if (code) {
          const duplicateCode = await tx.resource.findFirst({
            where: {
              businessId,
              code,

              id: {
                not: id,
              },
            },

            select: {
              id: true,
            },
          });

          if (duplicateCode) {
            throw new Error("RESOURCE_CODE_ALREADY_EXISTS");
          }
        }

        const deactivating = resource.isActive && !isActive;

        const changingResourceType = resource.resourceTypeId !== resourceTypeId;

        /*
         * Las asignaciones activas deben
         * proteger dos operaciones:
         *
         * 1. Desactivar el Resource.
         * 2. Cambiarlo a otro ResourceType.
         *
         * No eliminamos asignaciones ni
         * modificamos Reservations de forma
         * silenciosa.
         */
        if (deactivating || changingResourceType) {
          const activeAssignments = await tx.reservationResource.findMany({
            where: {
              resourceId: id,

              reservation: {
                businessId,

                status: {
                  in: [...ACTIVE_RESERVATION_STATUSES],
                },
              },
            },

            select: {
              reservation: {
                select: {
                  id: true,

                  confirmationCode: true,

                  status: true,

                  startAt: true,
                  endAt: true,
                },
              },
            },

            orderBy: {
              reservation: {
                startAt: "asc",
              },
            },
          });

          if (activeAssignments.length > 0) {
            return {
              ok: false as const,

              reason: deactivating
                ? ("ACTIVE_ASSIGNMENTS" as const)
                : ("ACTIVE_ASSIGNMENTS_RESOURCE_TYPE" as const),

              reservations: activeAssignments.map(
                (assignment) => assignment.reservation,
              ),
            };
          }
        }

        const updatedResource = await tx.resource.update({
          where: {
            id,
          },

          data: {
            name,

            code: code || null,

            resourceTypeId,

            floor,

            capacity,

            isActive,
          },

          select: {
            id: true,
            businessId: true,

            name: true,
            code: true,

            resourceTypeId: true,

            floor: true,
            capacity: true,

            isActive: true,

            createdAt: true,
            updatedAt: true,

            resourceType: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
          },
        });

        return {
          ok: true as const,

          resource: updatedResource,
        };
      },
      {
        isolationLevel: "Serializable",
      },
    );

    if (!result.ok) {
      const changingResourceType =
        result.reason === "ACTIVE_ASSIGNMENTS_RESOURCE_TYPE";

      return NextResponse.json(
        {
          success: false,

          error: changingResourceType
            ? "No se puede cambiar el tipo de recurso porque tiene reservas activas asignadas."
            : "No se puede desactivar el recurso porque tiene reservas activas asignadas.",

          code: changingResourceType
            ? "RESOURCE_TYPE_CHANGE_HAS_ACTIVE_ASSIGNMENTS"
            : "RESOURCE_HAS_ACTIVE_ASSIGNMENTS",

          reservations: result.reservations,
        },
        {
          status: 409,
        },
      );
    }

    return NextResponse.json({
      success: true,

      resource: result.resource,
    });
  } catch (error) {
    console.error("PATCH /api/resources/[id] error:", error);

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

        case "RESOURCE_NOT_FOUND":
          return NextResponse.json(
            {
              success: false,
              error: "Recurso no encontrado para este negocio",
            },
            {
              status: 404,
            },
          );

        case "RESOURCE_TYPE_NOT_FOUND":
          return NextResponse.json(
            {
              success: false,
              error: "Tipo de recurso no encontrado para este negocio",
            },
            {
              status: 404,
            },
          );

        case "RESOURCE_CODE_ALREADY_EXISTS":
          return NextResponse.json(
            {
              success: false,
              error: "Ya existe otro recurso con ese código",
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
        error: "No fue posible actualizar el recurso",
      },
      {
        status: 500,
      },
    );
  }
}
