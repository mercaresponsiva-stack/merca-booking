import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

import { isReservationActive } from "@/lib/booking/reservation-state";

import { checkResourceForInterval } from "@/lib/booking/resource-interval-check";

import {
  isReservationOptionResourceRequirementSatisfied,
  resolveReservationOptionForResource,
} from "@/lib/booking/reservation-option-resource-assignment-policy";

import {
  getReservationOptionOperationalGroupKey,
  getReservationOptionResourceRequirementGroupKey,
} from "@/lib/booking/reservation-option-operational-group";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id: reservationId } = await context.params;

    // ─────────────────────────────────────────────
    // RESERVATION + RESOURCE REQUIREMENTS
    // ─────────────────────────────────────────────

    const reservation = await prisma.reservation.findUnique({
      where: {
        id: reservationId,
      },

      include: {
        services: {
          include: {
            service: {
              include: {
                resourceTypes: {
                  include: {
                    resourceType: true,
                  },
                },
              },
            },

            resources: {
              include: {
                resource: true,
              },
            },
          },
        },

        options: {
          include: {
            serviceOption: {
              include: {
                service: {
                  select: {
                    id: true,
                    name: true,
                    slug: true,
                  },
                },

                resourceTypes: {
                  include: {
                    resourceType: true,
                  },
                },
              },
            },

            resources: {
              include: {
                resource: true,
              },
            },
          },
        },
      },
    });

    if (!reservation) {
      return NextResponse.json(
        {
          success: false,
          error: "Reserva no encontrada",
        },
        {
          status: 404,
        },
      );
    }

    if (!isReservationActive(reservation.status)) {
      return NextResponse.json(
        {
          success: false,
          error: "La reserva ya no permite asignar recursos",
        },
        {
          status: 409,
        },
      );
    }

    // ─────────────────────────────────────────────
    // REQUIREMENTS
    //
    // Cada ServiceResourceType es un requisito
    // físico distinto del servicio.
    //
    // Ejemplos:
    //
    // Hotel:
    // Habitación Deluxe → ResourceType Deluxe
    //
    // Restaurante:
    // Cena → ResourceType Mesa
    //
    // Clínica:
    // Consulta → ResourceType Consultorio
    // ─────────────────────────────────────────────

    const assignedResourceIdsWithinReservation =
      new Set<string>([
        ...reservation.services.flatMap(
          (reservationService) =>
            reservationService.resources.map(
              (assignment) =>
                assignment.resourceId,
            ),
        ),

        ...reservation.options.flatMap(
          (reservationOption) =>
            reservationOption.resources.map(
              (assignment) =>
                assignment.resourceId,
            ),
        ),
      ]);

    const requirements = [];

    for (const reservationService of reservation.services) {
      for (const requirement of reservationService.service.resourceTypes) {
        const requiredQuantity =
          requirement.requiredQuantity * reservationService.quantity;

        const assignedResources = reservationService.resources.filter(
          (assignment) =>
            assignment.resource.resourceTypeId === requirement.resourceTypeId,
        );

        const assignedQuantity = assignedResources.length;

        const remainingQuantity = Math.max(
          requiredQuantity - assignedQuantity,
          0,
        );

        // ─────────────────────────────────────────
        // PHYSICAL RESOURCES OF THIS TYPE
        // ─────────────────────────────────────────

        const resources = await prisma.resource.findMany({
          where: {
            businessId: reservation.businessId,

            resourceTypeId: requirement.resourceTypeId,

            isActive: true,
          },

          orderBy: [
            {
              floor: "asc",
            },
            {
              code: "asc",
            },
            {
              name: "asc",
            },
          ],
        });

        const evaluatedResources = [];

        for (const resource of resources) {
          const ownAssignment = assignedResources.find(
            (assignment) => assignment.resourceId === resource.id,
          );

          const assignedToAnotherRequirement =
            !ownAssignment &&
            assignedResourceIdsWithinReservation.has(resource.id);

          /*
           * El mismo helper usado por la asignación
           * definitiva valida:
           *
           * - solapamientos con reservas activas
           * - bloqueos
           * - exclusión de la propia reserva
           *
           * Esto mantiene la misma fuente de verdad.
           */
          const intervalCheck = await checkResourceForInterval({
            businessId: reservation.businessId,

            reservationId: reservation.id,

            serviceId: reservationService.serviceId,

            resourceTypeId: requirement.resourceTypeId,

            resourceId: resource.id,

            startAt: reservation.startAt,

            endAt: reservation.endAt,

            db: prisma,
          });

          let availability:
            | "AVAILABLE"
            | "ASSIGNED"
            | "OCCUPIED"
            | "BLOCKED"
            | "UNAVAILABLE";

          if (ownAssignment) {
            availability = "ASSIGNED";
          } else if (assignedToAnotherRequirement) {
            availability = "UNAVAILABLE";
          } else if (intervalCheck.available) {
            availability = "AVAILABLE";
          } else if (intervalCheck.reason === "RESOURCE_ALREADY_OCCUPIED") {
            availability = "OCCUPIED";
          } else if (intervalCheck.reason === "RESOURCE_BLOCKED") {
            availability = "BLOCKED";
          } else {
            availability = "UNAVAILABLE";
          }

          evaluatedResources.push({
            id: resource.id,

            name: resource.name,

            code: resource.code,

            floor: resource.floor,

            capacity: resource.capacity,

            resourceTypeId: resource.resourceTypeId,

            assignmentId: ownAssignment?.id ?? null,

            assignedToReservation:
              assignedResourceIdsWithinReservation.has(resource.id),

            available:
              !ownAssignment &&
              !assignedToAnotherRequirement &&
              intervalCheck.available,

            availability,

            unavailableReason: ownAssignment
              ? null
              : assignedToAnotherRequirement
                ? "RESOURCE_ASSIGNED_TO_ANOTHER_REQUIREMENT"
                : intervalCheck.available
                  ? null
                  : intervalCheck.reason,
          });
        }

        requirements.push({
          source: "SERVICE",

          reservationServiceId: reservationService.id,

          serviceId: reservationService.serviceId,

          service: {
            id: reservationService.service.id,

            name: reservationService.service.name,

            slug: reservationService.service.slug,
          },

          resourceType: {
            id: requirement.resourceType.id,

            name: requirement.resourceType.name,

            slug: requirement.resourceType.slug,
          },

          requiredQuantity,
          assignedQuantity,
          remainingQuantity,

          satisfied: remainingQuantity === 0,

          resources: evaluatedResources,
        });
      }
    }

    const optionRequirements = [];

    optionLoop:
    for (
      const reservationOption of
      reservation.options
    ) {
      const serviceOption =
        reservationOption
          .serviceOption;

      if (!serviceOption) {
        continue;
      }

      for (
        const requirement of
        serviceOption.resourceTypes
      ) {
        const optionResolution =
          resolveReservationOptionForResource({
            options: [
              reservationOption,
            ],

            resourceTypeId:
              requirement.resourceTypeId,

            requestedReservationOptionId:
              reservationOption.id,
          });

        if (
          !optionResolution.ok
        ) {
          if (
            optionResolution.violation ===
            "RESERVATION_OPTION_NOT_ACTIVE"
          ) {
            continue optionLoop;
          }

          throw new Error(
            optionResolution.violation,
          );
        }

        const effectiveStartAt =
          reservationOption.startAt ??
          reservation.startAt;

        const effectiveEndAt =
          reservationOption.endAt ??
          reservation.endAt;

        if (
          effectiveEndAt <=
          effectiveStartAt
        ) {
          throw new Error(
            "INVALID_RESERVATION_OPTION_INTERVAL",
          );
        }

        const assignedResources =
          reservationOption
            .resources
            .filter(
              (assignment) =>
                assignment
                  .resource
                  .resourceTypeId ===
                requirement.resourceTypeId,
            );

        const assignedQuantity =
          assignedResources.length;

        const requiredQuantity =
          optionResolution
            .requiredResourceCount;

        const remainingQuantity =
          Math.max(
            requiredQuantity -
              assignedQuantity,

            0,
          );

        const resources =
          await prisma.resource.findMany({
            where: {
              businessId:
                reservation.businessId,

              resourceTypeId:
                requirement.resourceTypeId,

              isActive:
                true,
            },

            orderBy: [
              {
                floor:
                  "asc",
              },
              {
                code:
                  "asc",
              },
              {
                name:
                  "asc",
              },
            ],
          });

        const evaluatedResources = [];

        for (
          const resource of
          resources
        ) {
          const ownAssignment =
            assignedResources.find(
              (assignment) =>
                assignment.resourceId ===
                resource.id,
            );

          const assignedToAnotherRequirement =
            !ownAssignment &&
            assignedResourceIdsWithinReservation
              .has(
                resource.id,
              );

          const intervalCheck =
            await checkResourceForInterval({
              businessId:
                reservation.businessId,

              reservationId:
                reservation.id,

              serviceId:
                optionResolution.serviceId,

              resourceTypeId:
                requirement.resourceTypeId,

              resourceId:
                resource.id,

              startAt:
                effectiveStartAt,

              endAt:
                effectiveEndAt,

              db:
                prisma,
            });

          let availability:
            | "AVAILABLE"
            | "ASSIGNED"
            | "OCCUPIED"
            | "BLOCKED"
            | "UNAVAILABLE";

          if (ownAssignment) {
            availability =
              "ASSIGNED";
          } else if (
            assignedToAnotherRequirement
          ) {
            availability =
              "UNAVAILABLE";
          } else if (
            intervalCheck.available
          ) {
            availability =
              "AVAILABLE";
          } else if (
            intervalCheck.reason ===
            "RESOURCE_ALREADY_OCCUPIED"
          ) {
            availability =
              "OCCUPIED";
          } else if (
            intervalCheck.reason ===
            "RESOURCE_BLOCKED"
          ) {
            availability =
              "BLOCKED";
          } else {
            availability =
              "UNAVAILABLE";
          }

          evaluatedResources.push({
            id:
              resource.id,

            name:
              resource.name,

            code:
              resource.code,

            floor:
              resource.floor,

            capacity:
              resource.capacity,

            resourceTypeId:
              resource.resourceTypeId,

            assignmentId:
              ownAssignment?.id ??
              null,

            assignedToReservation:
              assignedResourceIdsWithinReservation
                .has(
                  resource.id,
                ),

            available:
              !ownAssignment &&
              !assignedToAnotherRequirement &&
              intervalCheck.available,

            availability,

            unavailableReason:
              ownAssignment
                ? null
                : assignedToAnotherRequirement
                  ? "RESOURCE_ASSIGNED_TO_ANOTHER_REQUIREMENT"
                  : intervalCheck.available
                    ? null
                    : intervalCheck.reason,
          });
        }

        const operationalGroupKey =
          getReservationOptionOperationalGroupKey({
            reservationId:
              reservation.id,

            reservationOptionId:
              reservationOption.id,

            reservationServiceId:
              reservationOption
                .reservationServiceId,

            serviceOptionId:
              reservationOption
                .serviceOptionId,

            optionId:
              reservationOption
                .optionId,

            startAt:
              reservationOption.startAt,

            endAt:
              reservationOption.endAt,
          });

        const requirementGroupKey =
          getReservationOptionResourceRequirementGroupKey({
            operationalGroupKey,

            resourceTypeId:
              requirement.resourceTypeId,
          });

        optionRequirements.push({
          source:
            "OPTION",

          operationalGroupKey,

          requirementGroupKey,

          createdAt:
            reservationOption.createdAt,

          reservationOptionId:
            reservationOption.id,

          reservationServiceId:
            reservationOption
              .reservationServiceId,

          serviceId:
            optionResolution.serviceId,

          service: {
            id:
              serviceOption.service.id,

            name:
              serviceOption.service.name,

            slug:
              serviceOption.service.slug,
          },

          option: {
            id:
              reservationOption.id,

            name:
              reservationOption.name,

            description:
              reservationOption.description,
          },

          resourceType: {
            id:
              requirement
                .resourceType.id,

            name:
              requirement
                .resourceType.name,

            slug:
              requirement
                .resourceType.slug,
          },

          activeQuantity:
            optionResolution
              .activeQuantity,

          requiredQuantityPerUnit:
            optionResolution
              .requiredQuantity,

          requiredQuantity,

          assignedQuantity,

          remainingQuantity,

          satisfied:
            remainingQuantity ===
            0,

          effectiveStartAt,

          effectiveEndAt,

          usesReservationInterval:
            reservationOption.startAt ===
              null &&
            reservationOption.endAt ===
              null,

          resources:
            evaluatedResources,
        });
      }
    }

    return NextResponse.json({
      success: true,

      reservation: {
        id: reservation.id,

        confirmationCode: reservation.confirmationCode,

        status: reservation.status,

        startAt: reservation.startAt,

        endAt: reservation.endAt,
      },

      requirements,

      optionRequirements,
    });
  } catch (error) {
    console.error("GET reservation resources error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "No fue posible consultar los recursos disponibles",
      },
      {
        status: 500,
      },
    );
  }
}

export async function PATCH(
  request: Request,
  context: RouteContext,
) {
  try {
    const { id: reservationId } =
      await context.params;

    let rawBody: unknown;

    try {
      rawBody =
        await request.json();
    } catch {
      return NextResponse.json(
        {
          success: false,
          error:
            "El cuerpo de la solicitud debe ser JSON válido",
        },
        {
          status: 400,
        },
      );
    }

    if (
      typeof rawBody !==
        "object" ||
      rawBody ===
        null ||
      Array.isArray(
        rawBody,
      )
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "El cuerpo de la solicitud es inválido",
        },
        {
          status: 400,
        },
      );
    }

    const body =
      rawBody as Record<
        string,
        unknown
      >;

    const resourceId =
      typeof body.resourceId ===
      "string"
        ? body.resourceId.trim()
        : "";

    const reservationOptionId =
      typeof body.reservationOptionId ===
      "string"
        ? body.reservationOptionId.trim()
        : "";

    if (!resourceId) {
      return NextResponse.json(
        {
          success: false,
          error:
            "resourceId es requerido",
        },
        {
          status: 400,
        },
      );
    }

    if (!reservationOptionId) {
      return NextResponse.json(
        {
          success: false,
          error:
            "reservationOptionId es requerido",
        },
        {
          status: 400,
        },
      );
    }

    const result =
      await prisma.$transaction(
        async (tx) => {
          const reservation =
            await tx.reservation.findUnique({
              where: {
                id:
                  reservationId,
              },

              include: {
                options: {
                  include: {
                    serviceOption: {
                      include: {
                        resourceTypes:
                          true,
                      },
                    },

                    resources: {
                      include: {
                        resource: {
                          select: {
                            id:
                              true,

                            resourceTypeId:
                              true,
                          },
                        },
                      },
                    },
                  },
                },
              },
            });

          if (!reservation) {
            throw new Error(
              "RESERVATION_NOT_FOUND",
            );
          }

          if (
            !isReservationActive(
              reservation.status,
            )
          ) {
            throw new Error(
              "RESERVATION_NOT_ASSIGNABLE",
            );
          }

          const resource =
            await tx.resource.findFirst({
              where: {
                id:
                  resourceId,

                businessId:
                  reservation.businessId,

                isActive:
                  true,
              },

              include: {
                resourceType:
                  true,
              },
            });

          if (!resource) {
            throw new Error(
              "RESOURCE_NOT_FOUND",
            );
          }

          if (
            !resource.resourceTypeId ||
            !resource.resourceType
          ) {
            throw new Error(
              "RESOURCE_TYPE_NOT_CONFIGURED",
            );
          }

          const optionResolution =
            resolveReservationOptionForResource({
              options:
                reservation.options,

              resourceTypeId:
                resource.resourceTypeId,

              requestedReservationOptionId:
                reservationOptionId,
            });

          if (
            !optionResolution.ok
          ) {
            throw new Error(
              optionResolution.violation,
            );
          }

          const {
            reservationOption,

            serviceId,

            activeQuantity,

            requiredQuantity,

            requiredResourceCount,
          } =
            optionResolution;

          const existingAssignment =
            await tx.reservationResource.findFirst({
              where: {
                reservationId:
                  reservation.id,

                resourceId:
                  resource.id,
              },
            });

          if (
            existingAssignment
          ) {
            throw new Error(
              "RESOURCE_ALREADY_ASSIGNED",
            );
          }

          if (
            isReservationOptionResourceRequirementSatisfied(
              reservationOption,

              resource.resourceTypeId,

              requiredResourceCount,
            )
          ) {
            throw new Error(
              "OPTION_RESOURCE_REQUIREMENT_ALREADY_SATISFIED",
            );
          }

          const effectiveStartAt =
            reservationOption.startAt ??
            reservation.startAt;

          const effectiveEndAt =
            reservationOption.endAt ??
            reservation.endAt;

          if (
            effectiveEndAt <=
            effectiveStartAt
          ) {
            throw new Error(
              "INVALID_RESERVATION_OPTION_INTERVAL",
            );
          }

          const intervalCheck =
            await checkResourceForInterval({
              businessId:
                reservation.businessId,

              reservationId:
                reservation.id,

              serviceId,

              resourceTypeId:
                resource.resourceTypeId,

              resourceId:
                resource.id,

              startAt:
                effectiveStartAt,

              endAt:
                effectiveEndAt,

              db:
                tx,
            });

          if (
            !intervalCheck.available
          ) {
            throw new Error(
              intervalCheck.reason,
            );
          }

          const assignment =
            await tx.reservationResource.create({
              data: {
                reservationId:
                  reservation.id,

                reservationServiceId:
                  null,

                reservationOptionId:
                  reservationOption.id,

                resourceId:
                  resource.id,
              },
            });

          return {
            reservation,

            reservationOption,

            resource,

            assignment,

            activeQuantity,

            requiredQuantity,

            requiredResourceCount,

            effectiveStartAt,

            effectiveEndAt,
          };
        },

        {
          isolationLevel:
            "Serializable",
        },
      );

    return NextResponse.json({
      success: true,

      reservation: {
        id:
          result.reservation.id,

        confirmationCode:
          result.reservation
            .confirmationCode,

        status:
          result.reservation.status,
      },

      assignment: {
        id:
          result.assignment.id,

        reservationOptionId:
          result.reservationOption.id,

        resourceId:
          result.resource.id,

        createdAt:
          result.assignment.createdAt,

        effectiveStartAt:
          result.effectiveStartAt,

        effectiveEndAt:
          result.effectiveEndAt,

        option: {
          id:
            result.reservationOption.id,

          name:
            result.reservationOption.name,

          activeQuantity:
            result.activeQuantity,
        },

        resource: {
          id:
            result.resource.id,

          name:
            result.resource.name,

          code:
            result.resource.code,

          floor:
            result.resource.floor,

          capacity:
            result.resource.capacity,

          resourceType: {
            id:
              result.resource
                .resourceTypeId,

            name:
              result.resource
                .resourceType
                ?.name ??
              null,

            slug:
              result.resource
                .resourceType
                ?.slug ??
              null,
          },
        },
      },

      requirement: {
        requiredQuantity:
          result.requiredQuantity,

        requiredResourceCount:
          result.requiredResourceCount,
      },
    });
  } catch (error) {
    console.error(
      "PATCH reservation option resource assignment error:",
      error,
    );

    const errorCode =
      error instanceof Error
        ? error.message
        : null;

    if (
      errorCode ===
      "RESERVATION_NOT_FOUND"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Reserva no encontrada",
        },
        {
          status: 404,
        },
      );
    }

    if (
      errorCode ===
      "RESERVATION_NOT_ASSIGNABLE"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "La reserva ya no permite asignar recursos",
        },
        {
          status: 409,
        },
      );
    }

    if (
      errorCode ===
        "RESERVATION_OPTION_REQUIRED" ||
      errorCode ===
        "RESERVATION_OPTION_NOT_VALID"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "El complemento indicado no pertenece a esta reserva",
        },
        {
          status: 400,
        },
      );
    }

    if (
      errorCode ===
      "RESERVATION_OPTION_NOT_ACTIVE"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "El complemento ya no tiene cantidad activa",
        },
        {
          status: 409,
        },
      );
    }

    if (
      errorCode ===
      "RESERVATION_OPTION_CONFIGURATION_REQUIRED"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "El complemento ya no conserva una configuración de recursos asignable",
        },
        {
          status: 409,
        },
      );
    }

    if (
      errorCode ===
      "RESOURCE_NOT_ALLOWED_FOR_OPTION"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "El recurso no pertenece a un tipo requerido por el complemento",
        },
        {
          status: 400,
        },
      );
    }

    if (
      errorCode ===
      "RESOURCE_NOT_FOUND"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Recurso no encontrado o inactivo",
        },
        {
          status: 404,
        },
      );
    }

    if (
      errorCode ===
      "RESOURCE_ALREADY_ASSIGNED"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "El recurso ya está asignado a esta reserva",
        },
        {
          status: 409,
        },
      );
    }

    if (
      errorCode ===
      "OPTION_RESOURCE_REQUIREMENT_ALREADY_SATISFIED"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "El complemento ya tiene todos los recursos requeridos",
        },
        {
          status: 409,
        },
      );
    }

    if (
      errorCode ===
      "RESOURCE_ALREADY_OCCUPIED"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "El recurso ya está ocupado durante el intervalo del complemento",
        },
        {
          status: 409,
        },
      );
    }

    if (
      errorCode ===
      "RESOURCE_BLOCKED"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "El recurso está bloqueado durante el intervalo del complemento",
        },
        {
          status: 409,
        },
      );
    }

    if (
      errorCode ===
      "RESOURCE_TYPE_NOT_CONFIGURED"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "El recurso no tiene un tipo configurado",
        },
        {
          status: 500,
        },
      );
    }

    if (
      errorCode ===
        "INVALID_OPTION_RESOURCE_REQUIRED_QUANTITY" ||
      errorCode ===
        "OPTION_RESOURCE_REQUIREMENT_OVERFLOW" ||
      errorCode ===
        "INVALID_RESERVATION_OPTION_INTERVAL"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "La configuración física del complemento es inválida",
        },
        {
          status: 500,
        },
      );
    }

    if (
      typeof error ===
        "object" &&
      error !==
        null &&
      "code" in
        error &&
      (
        error.code ===
          "P2002" ||
        error.code ===
          "P2034"
      )
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "La disponibilidad cambió mientras se procesaba la asignación. Intenta nuevamente.",
        },
        {
          status: 409,
        },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error:
          "No fue posible asignar el recurso al complemento",
      },
      {
        status: 500,
      },
    );
  }
}
