import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

import {
  AuthorizationError,
  requireAuthenticatedUser,
  requireBusinessAccess,
} from "@/lib/auth/business-access";

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

export const dynamic = "force-dynamic";

function privateJson(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);

  headers.set("Cache-Control", "private, no-store, max-age=0, must-revalidate");
  headers.set("Pragma", "no-cache");
  headers.set("Expires", "0");
  headers.set("X-Robots-Tag", "noindex, nofollow");

  return NextResponse.json(body, {
    ...init,
    headers,
  });
}

const RESOURCE_ASSIGNMENT_ALLOWED_ROLES = [
  "OWNER",
  "ADMIN",
  "RECEPTIONIST",
] as const;

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    /*
     * Autenticamos antes de consultar el alcance
     * de cualquier reserva.
     */
    await requireAuthenticatedUser();

    const { id: reservationId } = await context.params;

    // ─────────────────────────────────────────────
    // RESERVATION + RESOURCE REQUIREMENTS
    // ─────────────────────────────────────────────

    const reservationScope = await prisma.reservation.findUnique({
      where: {
        id: reservationId,
      },

      select: {
        businessId: true,
      },
    });

    if (!reservationScope) {
      return privateJson(
        {
          success: false,
          error: "Reserva no encontrada",
        },
        {
          status: 404,
        },
      );
    }

    const access = await requireBusinessAccess(
      reservationScope.businessId,
      RESOURCE_ASSIGNMENT_ALLOWED_ROLES,
    );

    const reservation = await prisma.reservation.findFirst({
      where: {
        id: reservationId,
        businessId: access.business.id,
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
                    businessId: true,
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
      return privateJson(
        {
          success: false,
          error: "Reserva no encontrada",
        },
        {
          status: 404,
        },
      );
    }

    /*
     * Validamos el alcance de todo el grafo
     * operativo antes de utilizarlo para
     * disponibilidad o devolverlo al cliente.
     */
    const reservationServicesById =
      new Map<
        string,
        (typeof reservation.services)[number]
      >();

    const operationalResourceTypeIds =
      new Set<string>();

    const operationalBusinessOptionIds =
      new Set<string>();

    let operationalScopeInvalid =
      reservation.businessId !==
      access.business.id;

    for (
      const reservationService of
      reservation.services
    ) {
      reservationServicesById.set(
        reservationService.id,
        reservationService,
      );

      if (
        reservationService.reservationId !==
          reservation.id ||
        reservationService.serviceId !==
          reservationService.service.id ||
        reservationService.service.businessId !==
          access.business.id
      ) {
        operationalScopeInvalid =
          true;
      }

      for (
        const requirement of
        reservationService.service.resourceTypes
      ) {
        operationalResourceTypeIds.add(
          requirement.resourceTypeId,
        );

        if (
          requirement.serviceId !==
            reservationService.service.id ||
          requirement.resourceTypeId !==
            requirement.resourceType.id ||
          requirement.resourceType.businessId !==
            access.business.id
        ) {
          operationalScopeInvalid =
            true;
        }
      }

      for (
        const assignment of
        reservationService.resources
      ) {
        if (
          assignment.reservationId !==
            reservation.id ||
          assignment.reservationServiceId !==
            reservationService.id ||
          assignment.resourceId !==
            assignment.resource.id ||
          assignment.resource.businessId !==
            access.business.id ||
          assignment.resource.resourceTypeId ===
            null
        ) {
          operationalScopeInvalid =
            true;
        } else {
          operationalResourceTypeIds.add(
            assignment.resource.resourceTypeId,
          );
        }
      }
    }

    for (
      const reservationOption of
      reservation.options
    ) {
      if (
        reservationOption.reservationId !==
        reservation.id
      ) {
        operationalScopeInvalid =
          true;
      }

      const linkedReservationService =
        reservationOption.reservationServiceId
          ? reservationServicesById.get(
              reservationOption.reservationServiceId,
            ) ??
            null
          : null;

      if (
        reservationOption.reservationServiceId !==
          null &&
        !linkedReservationService
      ) {
        operationalScopeInvalid =
          true;
      }

      if (
        reservationOption.optionId !==
        null
      ) {
        operationalBusinessOptionIds.add(
          reservationOption.optionId,
        );
      }

      const serviceOption =
        reservationOption.serviceOption;

      if (serviceOption) {
        operationalBusinessOptionIds.add(
          serviceOption.optionId,
        );

        if (
          reservationOption.serviceOptionId !==
            serviceOption.id ||
          serviceOption.serviceId !==
            serviceOption.service.id ||
          serviceOption.service.businessId !==
            access.business.id ||
          (
            linkedReservationService !==
              null &&
            linkedReservationService.serviceId !==
              serviceOption.serviceId
          ) ||
          (
            reservationOption.optionId !==
              null &&
            reservationOption.optionId !==
              serviceOption.optionId
          )
        ) {
          operationalScopeInvalid =
            true;
        }

        for (
          const requirement of
          serviceOption.resourceTypes
        ) {
          operationalResourceTypeIds.add(
            requirement.resourceTypeId,
          );

          if (
            requirement.serviceOptionId !==
              serviceOption.id ||
            requirement.resourceTypeId !==
              requirement.resourceType.id ||
            requirement.resourceType.businessId !==
              access.business.id
          ) {
            operationalScopeInvalid =
              true;
          }
        }
      } else if (
        reservationOption.serviceOptionId !==
        null
      ) {
        operationalScopeInvalid =
          true;
      }

      for (
        const assignment of
        reservationOption.resources
      ) {
        if (
          assignment.reservationId !==
            reservation.id ||
          assignment.reservationOptionId !==
            reservationOption.id ||
          assignment.resourceId !==
            assignment.resource.id ||
          assignment.resource.businessId !==
            access.business.id ||
          assignment.resource.resourceTypeId ===
            null
        ) {
          operationalScopeInvalid =
            true;
        } else {
          operationalResourceTypeIds.add(
            assignment.resource.resourceTypeId,
          );
        }
      }
    }

    const scopedResourceTypes =
      operationalResourceTypeIds.size ===
      0
        ? []
        : await prisma.resourceType.findMany({
            where: {
              id: {
                in: [
                  ...operationalResourceTypeIds,
                ],
              },

              businessId:
                access.business.id,
            },

            select: {
              id:
                true,
            },
          });

    const scopedResourceTypeIds =
      new Set(
        scopedResourceTypes.map(
          (resourceType) =>
            resourceType.id,
        ),
      );

    if (
      scopedResourceTypeIds.size !==
        operationalResourceTypeIds.size ||
      [
        ...operationalResourceTypeIds,
      ].some(
        (resourceTypeId) =>
          !scopedResourceTypeIds.has(
            resourceTypeId,
          ),
      )
    ) {
      operationalScopeInvalid =
        true;
    }

    const scopedBusinessOptions =
      operationalBusinessOptionIds.size ===
      0
        ? []
        : await prisma.businessOption.findMany({
            where: {
              id: {
                in: [
                  ...operationalBusinessOptionIds,
                ],
              },

              businessId:
                access.business.id,
            },

            select: {
              id:
                true,
            },
          });

    const scopedBusinessOptionIds =
      new Set(
        scopedBusinessOptions.map(
          (businessOption) =>
            businessOption.id,
        ),
      );

    if (
      scopedBusinessOptionIds.size !==
        operationalBusinessOptionIds.size ||
      [
        ...operationalBusinessOptionIds,
      ].some(
        (businessOptionId) =>
          !scopedBusinessOptionIds.has(
            businessOptionId,
          ),
      )
    ) {
      operationalScopeInvalid =
        true;
    }

    if (operationalScopeInvalid) {
      throw new Error(
        "RESERVATION_RESOURCE_OPERATIONAL_SCOPE_INVALID",
      );
    }

    if (!isReservationActive(reservation.status)) {
      return privateJson(
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

    return privateJson({
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

    console.error("GET reservation resources error:", error);

    if (
      error instanceof Error &&
      error.message ===
        "RESERVATION_RESOURCE_OPERATIONAL_SCOPE_INVALID"
    ) {
      return privateJson(
        {
          success: false,
          error:
            "No fue posible validar la integridad operativa de los recursos de la reserva.",
        },
        {
          status: 500,
        },
      );
    }

    return privateJson(
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
    /*
     * Autenticamos antes de consultar el alcance
     * de cualquier reserva o procesar la mutación.
     */
    await requireAuthenticatedUser();

    const { id: reservationId } =
      await context.params;

    let rawBody: unknown;

    try {
      rawBody =
        await request.json();
    } catch {
      return privateJson(
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
      return privateJson(
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
      return privateJson(
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
      return privateJson(
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

    const reservationScope =
      await prisma.reservation.findUnique({
        where: {
          id:
            reservationId,
        },

        select: {
          businessId:
            true,
        },
      });

    if (!reservationScope) {
      throw new Error(
        "RESERVATION_NOT_FOUND",
      );
    }

    const access =
      await requireBusinessAccess(
        reservationScope.businessId,
        RESOURCE_ASSIGNMENT_ALLOWED_ROLES,
      );

    const result =
      await prisma.$transaction(
        async (tx) => {
          const reservation =
            await tx.reservation.findFirst({
              where: {
                id:
                  reservationId,

                businessId:
                  access.business.id,
              },

              include: {
                services: {
                  select: {
                    id:
                      true,

                    reservationId:
                      true,

                    serviceId:
                      true,
                  },
                },

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

                            businessId:
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

          /*
           * La membresía se comprueba nuevamente
           * dentro de la transacción Serializable.
           */
          const actorMembership =
            await tx.businessMembership.findFirst({
              where: {
                businessId:
                  access.business.id,

                userId:
                  access.user.id,

                isActive:
                  true,

                role: {
                  in: [
                    ...RESOURCE_ASSIGNMENT_ALLOWED_ROLES,
                  ],
                },

                user: {
                  is: {
                    isActive:
                      true,
                  },
                },

                business: {
                  is: {
                    isActive:
                      true,
                  },
                },
              },

              select: {
                user: {
                  select: {
                    id:
                      true,
                  },
                },
              },
            });

          if (!actorMembership) {
            throw new Error(
              "RESOURCE_ASSIGNMENT_ACTOR_NOT_VALID",
            );
          }

          /*
           * Validamos el grafo utilizado por la mutación
           * antes de comprobar disponibilidad o escribir.
           */
          const reservationServicesById =
            new Map<
              string,
              (typeof reservation.services)[number]
            >();

          const operationalServiceIds =
            new Set<string>();

          const operationalResourceTypeIds =
            new Set<string>();

          const operationalBusinessOptionIds =
            new Set<string>();

          let operationalScopeInvalid =
            reservation.businessId !==
            access.business.id;

          for (
            const reservationService of
            reservation.services
          ) {
            reservationServicesById.set(
              reservationService.id,
              reservationService,
            );

            operationalServiceIds.add(
              reservationService.serviceId,
            );

            if (
              reservationService.reservationId !==
              reservation.id
            ) {
              operationalScopeInvalid =
                true;
            }
          }

          for (
            const reservationOption of
            reservation.options
          ) {
            if (
              reservationOption.reservationId !==
              reservation.id
            ) {
              operationalScopeInvalid =
                true;
            }

            const linkedReservationService =
              reservationOption.reservationServiceId
                ? reservationServicesById.get(
                    reservationOption.reservationServiceId,
                  ) ??
                  null
                : null;

            if (
              reservationOption.reservationServiceId !==
                null &&
              !linkedReservationService
            ) {
              operationalScopeInvalid =
                true;
            }

            if (
              reservationOption.optionId !==
              null
            ) {
              operationalBusinessOptionIds.add(
                reservationOption.optionId,
              );
            }

            const serviceOption =
              reservationOption.serviceOption;

            if (serviceOption) {
              operationalServiceIds.add(
                serviceOption.serviceId,
              );

              operationalBusinessOptionIds.add(
                serviceOption.optionId,
              );

              if (
                reservationOption.serviceOptionId !==
                  serviceOption.id ||
                (
                  linkedReservationService !==
                    null &&
                  linkedReservationService.serviceId !==
                    serviceOption.serviceId
                ) ||
                (
                  reservationOption.optionId !==
                    null &&
                  reservationOption.optionId !==
                    serviceOption.optionId
                )
              ) {
                operationalScopeInvalid =
                  true;
              }

              for (
                const requirement of
                serviceOption.resourceTypes
              ) {
                operationalResourceTypeIds.add(
                  requirement.resourceTypeId,
                );

                if (
                  requirement.serviceOptionId !==
                  serviceOption.id
                ) {
                  operationalScopeInvalid =
                    true;
                }
              }
            } else if (
              reservationOption.serviceOptionId !==
              null
            ) {
              operationalScopeInvalid =
                true;
            }

            for (
              const assignment of
              reservationOption.resources
            ) {
              if (
                assignment.reservationId !==
                  reservation.id ||
                assignment.reservationOptionId !==
                  reservationOption.id ||
                assignment.resourceId !==
                  assignment.resource.id ||
                assignment.resource.businessId !==
                  access.business.id ||
                assignment.resource.resourceTypeId ===
                  null ||
                (
                  assignment.reservationServiceId !==
                    null &&
                  assignment.reservationServiceId !==
                    reservationOption.reservationServiceId
                )
              ) {
                operationalScopeInvalid =
                  true;
              } else {
                operationalResourceTypeIds.add(
                  assignment.resource.resourceTypeId,
                );
              }
            }
          }

          const scopedServices =
            operationalServiceIds.size ===
            0
              ? []
              : await tx.service.findMany({
                  where: {
                    id: {
                      in: [
                        ...operationalServiceIds,
                      ],
                    },

                    businessId:
                      access.business.id,
                  },

                  select: {
                    id:
                      true,
                  },
                });

          const scopedServiceIds =
            new Set(
              scopedServices.map(
                (service) =>
                  service.id,
              ),
            );

          if (
            scopedServiceIds.size !==
              operationalServiceIds.size ||
            [
              ...operationalServiceIds,
            ].some(
              (serviceId) =>
                !scopedServiceIds.has(
                  serviceId,
                ),
            )
          ) {
            operationalScopeInvalid =
              true;
          }

          const scopedResourceTypes =
            operationalResourceTypeIds.size ===
            0
              ? []
              : await tx.resourceType.findMany({
                  where: {
                    id: {
                      in: [
                        ...operationalResourceTypeIds,
                      ],
                    },

                    businessId:
                      access.business.id,
                  },

                  select: {
                    id:
                      true,
                  },
                });

          const scopedResourceTypeIds =
            new Set(
              scopedResourceTypes.map(
                (resourceType) =>
                  resourceType.id,
              ),
            );

          if (
            scopedResourceTypeIds.size !==
              operationalResourceTypeIds.size ||
            [
              ...operationalResourceTypeIds,
            ].some(
              (resourceTypeId) =>
                !scopedResourceTypeIds.has(
                  resourceTypeId,
                ),
            )
          ) {
            operationalScopeInvalid =
              true;
          }

          const scopedBusinessOptions =
            operationalBusinessOptionIds.size ===
            0
              ? []
              : await tx.businessOption.findMany({
                  where: {
                    id: {
                      in: [
                        ...operationalBusinessOptionIds,
                      ],
                    },

                    businessId:
                      access.business.id,
                  },

                  select: {
                    id:
                      true,
                  },
                });

          const scopedBusinessOptionIds =
            new Set(
              scopedBusinessOptions.map(
                (businessOption) =>
                  businessOption.id,
              ),
            );

          if (
            scopedBusinessOptionIds.size !==
              operationalBusinessOptionIds.size ||
            [
              ...operationalBusinessOptionIds,
            ].some(
              (businessOptionId) =>
                !scopedBusinessOptionIds.has(
                  businessOptionId,
                ),
            )
          ) {
            operationalScopeInvalid =
              true;
          }

          if (operationalScopeInvalid) {
            throw new Error(
              "RESERVATION_RESOURCE_OPERATIONAL_SCOPE_INVALID",
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

          if (
            resource.resourceType.id !==
              resource.resourceTypeId ||
            resource.resourceType.businessId !==
              access.business.id
          ) {
            throw new Error(
              "RESERVATION_RESOURCE_OPERATIONAL_SCOPE_INVALID",
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

    return privateJson({
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
      "RESOURCE_ASSIGNMENT_ACTOR_NOT_VALID"
    ) {
      return privateJson(
        {
          success: false,
          error:
            "El usuario ya no tiene autorización para asignar recursos en este negocio",
        },
        {
          status: 403,
        },
      );
    }

    if (
      errorCode ===
      "RESERVATION_RESOURCE_OPERATIONAL_SCOPE_INVALID"
    ) {
      return privateJson(
        {
          success: false,
          error:
            "No fue posible validar la integridad operativa de los recursos de la reserva.",
        },
        {
          status: 500,
        },
      );
    }

    if (
      errorCode ===
      "RESERVATION_NOT_FOUND"
    ) {
      return privateJson(
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
      return privateJson(
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
      return privateJson(
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
      return privateJson(
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
      return privateJson(
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
      return privateJson(
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
      return privateJson(
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
      return privateJson(
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
      return privateJson(
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
      return privateJson(
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
      return privateJson(
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
      return privateJson(
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
      return privateJson(
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
      return privateJson(
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

    return privateJson(
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
