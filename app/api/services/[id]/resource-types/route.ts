import { NextRequest, NextResponse } from "next/server";

import { ACTIVE_RESERVATION_STATUSES } from "@/lib/booking/reservation-state";

import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type RequirementInput = {
  resourceTypeId: string;
  requiredQuantity: number;
};

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const { id: serviceId } = await context.params;

    const body = await request.json();

    const businessId =
      typeof body.businessId === "string" ? body.businessId.trim() : "";

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

    if (!Array.isArray(body.requirements)) {
      return NextResponse.json(
        {
          success: false,
          error: "requirements debe ser un arreglo",
        },
        {
          status: 400,
        },
      );
    }

    const requirements: RequirementInput[] = [];

    for (const rawRequirement of body.requirements) {
      const resourceTypeId =
        typeof rawRequirement?.resourceTypeId === "string"
          ? rawRequirement.resourceTypeId.trim()
          : "";

      const requiredQuantity = Number(rawRequirement?.requiredQuantity);

      if (!resourceTypeId) {
        return NextResponse.json(
          {
            success: false,
            error: "Cada requisito debe incluir resourceTypeId",
          },
          {
            status: 400,
          },
        );
      }

      if (!Number.isInteger(requiredQuantity) || requiredQuantity < 1) {
        return NextResponse.json(
          {
            success: false,
            error: "requiredQuantity debe ser un entero mayor o igual a 1",
          },
          {
            status: 400,
          },
        );
      }

      requirements.push({
        resourceTypeId,
        requiredQuantity,
      });
    }

    const uniqueResourceTypeIds = new Set(
      requirements.map((requirement) => requirement.resourceTypeId),
    );

    if (uniqueResourceTypeIds.size !== requirements.length) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Un tipo de recurso no puede repetirse dentro del mismo servicio",
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

        const service = await tx.service.findFirst({
          where: {
            id: serviceId,
            businessId,
          },

          select: {
            id: true,
            name: true,

            resourceTypes: {
              select: {
                id: true,
                resourceTypeId: true,
                requiredQuantity: true,
              },
            },
          },
        });

        if (!service) {
          throw new Error("SERVICE_NOT_FOUND");
        }

        if (requirements.length > 0) {
          const resourceTypes = await tx.resourceType.findMany({
            where: {
              businessId,

              id: {
                in: [...uniqueResourceTypeIds],
              },
            },

            select: {
              id: true,
            },
          });

          if (resourceTypes.length !== requirements.length) {
            throw new Error("RESOURCE_TYPE_NOT_FOUND");
          }
        }

        const currentNormalized = service.resourceTypes
          .map((requirement) => ({
            resourceTypeId: requirement.resourceTypeId,

            requiredQuantity: requirement.requiredQuantity,
          }))
          .sort((a, b) => a.resourceTypeId.localeCompare(b.resourceTypeId));

        const nextNormalized = [...requirements].sort((a, b) =>
          a.resourceTypeId.localeCompare(b.resourceTypeId),
        );

        const configurationChanged =
          JSON.stringify(currentNormalized) !== JSON.stringify(nextNormalized);

        /*
         * Un cambio estructural puede:
         *
         * - volver inválidos Resources
         *   ya asignados
         * - cambiar demanda pendiente
         * - alterar disponibilidad
         *
         * Por eso no lo aplicamos mientras
         * existan Reservations activas.
         */
        if (configurationChanged) {
          const activeReservations = await tx.reservation.findMany({
            where: {
              businessId,

              status: {
                in: [...ACTIVE_RESERVATION_STATUSES],
              },

              services: {
                some: {
                  serviceId,
                },
              },
            },

            select: {
              id: true,

              confirmationCode: true,

              status: true,

              startAt: true,
              endAt: true,

              guests: true,
              adults: true,
              children: true,
            },

            orderBy: {
              startAt: "asc",
            },
          });

          if (activeReservations.length > 0) {
            return {
              ok: false as const,

              reason: "ACTIVE_RESERVATIONS" as const,

              reservations: activeReservations,
            };
          }

          await tx.serviceResourceType.deleteMany({
            where: {
              serviceId,
            },
          });

          if (requirements.length > 0) {
            await tx.serviceResourceType.createMany({
              data: requirements.map((requirement) => ({
                serviceId,

                resourceTypeId: requirement.resourceTypeId,

                requiredQuantity: requirement.requiredQuantity,
              })),
            });
          }
        }

        const updatedRequirements = await tx.serviceResourceType.findMany({
          where: {
            serviceId,
          },

          select: {
            id: true,

            serviceId: true,

            resourceTypeId: true,

            requiredQuantity: true,

            createdAt: true,

            resourceType: {
              select: {
                id: true,
                name: true,
                slug: true,
                description: true,

                _count: {
                  select: {
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

          orderBy: {
            resourceType: {
              name: "asc",
            },
          },
        });

        return {
          ok: true as const,

          service: {
            id: service.id,

            name: service.name,
          },

          requirements: updatedRequirements.map((requirement) => ({
            id: requirement.id,

            serviceId: requirement.serviceId,

            resourceTypeId: requirement.resourceTypeId,

            requiredQuantity: requirement.requiredQuantity,

            createdAt: requirement.createdAt,

            resourceType: {
              id: requirement.resourceType.id,

              name: requirement.resourceType.name,

              slug: requirement.resourceType.slug,

              description: requirement.resourceType.description,

              activeResourceCount: requirement.resourceType._count.resources,
            },
          })),
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
            "No se puede modificar la estructura de recursos del servicio porque tiene reservas activas.",

          code: "SERVICE_RESOURCE_REQUIREMENTS_HAVE_ACTIVE_RESERVATIONS",

          reservations: result.reservations,
        },
        {
          status: 409,
        },
      );
    }

    return NextResponse.json({
      success: true,

      service: result.service,

      requirements: result.requirements,
    });
  } catch (error) {
    console.error("PUT /api/services/[id]/resource-types error:", error);

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

        case "SERVICE_NOT_FOUND":
          return NextResponse.json(
            {
              success: false,
              error: "Servicio no encontrado para este negocio",
            },
            {
              status: 404,
            },
          );

        case "RESOURCE_TYPE_NOT_FOUND":
          return NextResponse.json(
            {
              success: false,
              error: "Uno o más tipos de recurso no pertenecen a este negocio",
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
        error: "No fue posible actualizar los requisitos de recursos",
      },
      {
        status: 500,
      },
    );
  }
}
