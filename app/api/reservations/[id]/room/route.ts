import { checkResourceForInterval } from "@/lib/booking/resource-interval-check";

import { isReservationActive } from "@/lib/booking/reservation-state";
import {
  isResourceRequirementSatisfied,
  resolveReservationServiceForResource,
} from "@/lib/booking/resource-assignment-policy";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

import {
  AuthorizationError,
  requireAuthenticatedUser,
  requireBusinessAccess,
} from "@/lib/auth/business-access";

export const dynamic = "force-dynamic";

function privateJson(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);

  headers.set(
    "Cache-Control",
    "private, no-store, max-age=0, must-revalidate",
  );
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

export async function PATCH(
  request: NextRequest,
  context: {
    params: Promise<{ id: string }>;
  },
) {
  try {
    /*
     * La autenticación ocurre antes de consultar
     * cualquier reserva o procesar la mutación.
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
      typeof rawBody !== "object" ||
      rawBody === null ||
      Array.isArray(rawBody)
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
      rawBody as Record<string, unknown>;

    /*
     * Nombre nuevo:
     * resourceId
     *
     * Compatibilidad temporal con la API del hotel:
     * roomId -> resourceId
     */
    const resourceIdCandidate =
      body.resourceId ??
      body.roomId;

    const resourceId =
      typeof resourceIdCandidate === "string"
        ? resourceIdCandidate.trim()
        : "";

    /*
     * Para reservas con varios servicios podremos
     * indicar exactamente a qué ReservationService
     * pertenece la asignación.
     *
     * Para el hotel actual, normalmente existe solo
     * uno y puede omitirse.
     */
    let requestedReservationServiceId:
      string | null = null;

    if (
      body.reservationServiceId !== undefined &&
      body.reservationServiceId !== null
    ) {
      if (
        typeof body.reservationServiceId !==
        "string"
      ) {
        return privateJson(
          {
            success: false,
            error:
              "reservationServiceId debe ser una cadena válida",
          },
          {
            status: 400,
          },
        );
      }

      requestedReservationServiceId =
        body.reservationServiceId.trim() ||
        null;
    }

    // ─────────────────────────────────────────────
    // 1. VALIDAR RESOURCE
    // ─────────────────────────────────────────────

    if (!resourceId) {
      return privateJson(
        {
          success: false,
          error: "resourceId o roomId es requerido",
        },
        {
          status: 400,
        },
      );
    }

    // ─────────────────────────────────────────────
    // 2. ASIGNACIÓN SEGURA
    // ─────────────────────────────────────────────

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

    const access =
      await requireBusinessAccess(
        reservationScope.businessId,
        RESOURCE_ASSIGNMENT_ALLOWED_ROLES,
      );

    const result = await prisma.$transaction(
      async (tx) => {
        // ─────────────────────────────────────────
        // RESERVATION
        // ─────────────────────────────────────────

        const reservation = await tx.reservation.findFirst({
          where: {
            id:
              reservationId,

            businessId:
              access.business.id,
          },

          include: {
            services: {
              include: {
                service: {
                  include: {
                    resourceTypes: true,
                  },
                },

                resources: {
                  include: {
                    resource: {
                      select: {
                        id: true,
                        businessId: true,
                        resourceTypeId: true,
                      },
                    },
                  },
                },
              },
            },
          },
        });

        if (!reservation) {
          throw new Error("RESERVATION_NOT_FOUND");
        }

        /*
         * La membresía se revalida dentro de la
         * misma transacción Serializable que crea
         * la asignación.
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

        // No tiene sentido asignar recursos a una
        // reserva finalizada o cancelada.

        if (!isReservationActive(reservation.status)) {
          throw new Error("RESERVATION_NOT_ASSIGNABLE");
        }

        if (reservation.services.length === 0) {
          throw new Error("RESERVATION_HAS_NO_SERVICES");
        }

        /*
         * Validamos el grafo operativo completo antes
         * de utilizarlo para decidir la asignación.
         *
         * No confiamos únicamente en las relaciones
         * anidadas porque una referencia histórica o
         * corrupta podría apuntar a otro negocio.
         */
        const operationalServiceIds =
          new Set<string>();

        const operationalResourceTypeIds =
          new Set<string>();

        const operationalResourceIds =
          new Set<string>();

        let operationalScopeInvalid =
          false;

        for (
          const reservationService of
          reservation.services
        ) {
          operationalServiceIds.add(
            reservationService.serviceId,
          );

          if (
            reservationService.reservationId !==
              reservation.id ||
            reservationService.serviceId !==
              reservationService.service.id ||
            reservationService.service.businessId !==
              access.business.id ||
            !Number.isInteger(
              reservationService.quantity,
            ) ||
            reservationService.quantity < 1
          ) {
            operationalScopeInvalid =
              true;
          }

          const serviceResourceTypeIds =
            new Set<string>();

          for (
            const requirement of
            reservationService.service
              .resourceTypes
          ) {
            operationalResourceTypeIds.add(
              requirement.resourceTypeId,
            );

            serviceResourceTypeIds.add(
              requirement.resourceTypeId,
            );

            if (
              requirement.serviceId !==
                reservationService.service.id ||
              !Number.isInteger(
                requirement.requiredQuantity,
              ) ||
              requirement.requiredQuantity < 1 ||
              !Number.isSafeInteger(
                reservationService.quantity *
                  requirement.requiredQuantity,
              )
            ) {
              operationalScopeInvalid =
                true;
            }
          }

          for (
            const assignment of
            reservationService.resources
          ) {
            operationalResourceIds.add(
              assignment.resourceId,
            );

            const assignedResourceTypeId =
              assignment.resource
                .resourceTypeId;

            if (assignedResourceTypeId) {
              operationalResourceTypeIds.add(
                assignedResourceTypeId,
              );
            }

            if (
              assignment.reservationId !==
                reservation.id ||
              assignment.reservationServiceId !==
                reservationService.id ||
              assignment.reservationOptionId !==
                null ||
              assignment.resourceId !==
                assignment.resource.id ||
              assignment.resource.businessId !==
                access.business.id ||
              !assignedResourceTypeId ||
              !serviceResourceTypeIds.has(
                assignedResourceTypeId,
              )
            ) {
              operationalScopeInvalid =
                true;
            }
          }
        }

        const authorizedServices =
          operationalServiceIds.size === 0
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

        const authorizedResourceTypes =
          operationalResourceTypeIds.size === 0
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

        const authorizedResources =
          operationalResourceIds.size === 0
            ? []
            : await tx.resource.findMany({
                where: {
                  id: {
                    in: [
                      ...operationalResourceIds,
                    ],
                  },

                  businessId:
                    access.business.id,
                },

                select: {
                  id:
                    true,

                  resourceTypeId:
                    true,
                },
              });

        if (
          authorizedServices.length !==
            operationalServiceIds.size ||
          authorizedResourceTypes.length !==
            operationalResourceTypeIds.size ||
          authorizedResources.length !==
            operationalResourceIds.size
        ) {
          operationalScopeInvalid =
            true;
        }

        const authorizedResourceById =
          new Map(
            authorizedResources.map(
              (resourceItem) => [
                resourceItem.id,
                resourceItem,
              ],
            ),
          );

        for (
          const reservationService of
          reservation.services
        ) {
          for (
            const assignment of
            reservationService.resources
          ) {
            const authorizedResource =
              authorizedResourceById.get(
                assignment.resourceId,
              );

            if (
              !authorizedResource ||
              authorizedResource.resourceTypeId !==
                assignment.resource
                  .resourceTypeId
            ) {
              operationalScopeInvalid =
                true;
            }
          }
        }

        if (operationalScopeInvalid) {
          throw new Error(
            "RESERVATION_ROOM_OPERATIONAL_SCOPE_INVALID",
          );
        }

        // ─────────────────────────────────────────
        // 3. RESOURCE FÍSICO
        //
        // Hotel:
        // Resource = habitación 101
        // ─────────────────────────────────────────

        const resource = await tx.resource.findFirst({
          where: {
            id: resourceId,
            businessId: reservation.businessId,
            isActive: true,
          },

          include: {
            resourceType: true,
          },
        });

        if (!resource) {
          throw new Error("RESOURCE_NOT_FOUND");
        }

        if (!resource.resourceTypeId || !resource.resourceType) {
          throw new Error("RESOURCE_TYPE_NOT_CONFIGURED");
        }

        if (
          resource.businessId !==
            access.business.id ||
          resource.resourceType.businessId !==
            access.business.id
        ) {
          throw new Error(
            "RESERVATION_ROOM_OPERATIONAL_SCOPE_INVALID",
          );
        }

        // ───────────────────────────────────────
        // 4. RESOLVER SERVICE + RESOURCE TYPE
        // ───────────────────────────────────────

        const serviceResolution = resolveReservationServiceForResource({
          services: reservation.services,

          resourceTypeId: resource.resourceTypeId,

          requestedReservationServiceId,
        });

        if (!serviceResolution.ok) {
          throw new Error(serviceResolution.violation);
        }

        const { reservationService, requiredResourceCount } = serviceResolution;

        // ─────────────────────────────────────────
        // 6. EVITAR DUPLICAR EL MISMO RESOURCE
        //    EN LA RESERVA
        // ─────────────────────────────────────────

        const existingAssignment = await tx.reservationResource.findFirst({
          where: {
            reservationId: reservation.id,

            resourceId: resource.id,
          },
        });

        if (existingAssignment) {
          throw new Error("RESOURCE_ALREADY_ASSIGNED");
        }

        // ─────────────────────────────────────────
        // 7. ¿EL SERVICIO YA TIENE TODOS LOS
        //    RECURSOS DE ESTE TIPO?
        // ─────────────────────────────────────────

        if (
          isResourceRequirementSatisfied(
            reservationService,

            resource.resourceTypeId,

            requiredResourceCount,
          )
        ) {
          throw new Error("RESOURCE_REQUIREMENT_ALREADY_SATISFIED");
        }

        // ─────────────────────────────────────────────
        // 8. RESOURCE AVAILABLE FOR INTERVAL
        //
        // La misma regla universal es utilizada por:
        //
        // - asignación normal
        // - futuras reprogramaciones
        //
        // Comprueba:
        //
        // - otra reserva activa usando el Resource
        // - Block del Business
        // - Block del Service
        // - Block del ResourceType
        // - Block del Resource específico
        // ─────────────────────────────────────────────

        const intervalCheck = await checkResourceForInterval({
          businessId: reservation.businessId,

          reservationId: reservation.id,

          serviceId: reservationService.serviceId,

          resourceTypeId: resource.resourceTypeId,

          resourceId: resource.id,

          startAt: reservation.startAt,

          endAt: reservation.endAt,

          db: tx,
        });

        if (!intervalCheck.available) {
          throw new Error(intervalCheck.reason);
        }

        // ─────────────────────────────────────────
        // 10. CREAR RESERVATION RESOURCE
        //
        // Antes:
        //
        // ReservationRoom.roomId = 101
        //
        // Ahora:
        //
        // ReservationResource
        // ├── Reservation
        // ├── ReservationService
        // └── Resource 101
        // ─────────────────────────────────────────

        const assignment = await tx.reservationResource.create({
          data: {
            reservationId: reservation.id,

            reservationServiceId: reservationService.id,

            reservationOptionId: null,

            resourceId: resource.id,
          },

          include: {
            resource: {
              include: {
                resourceType: true,
              },
            },

            reservationService: {
              include: {
                service: true,
              },
            },
          },
        });

        return {
          reservation,
          assignment,
        };
      },

      {
        isolationLevel: "Serializable",
      },
    );

    // ─────────────────────────────────────────────
    // 11. RESPONSE
    // ─────────────────────────────────────────────

    const resource = result.assignment.resource;

    return privateJson({
      success: true,

      reservation: {
        id: result.reservation.id,

        confirmationCode: result.reservation.confirmationCode,

        status: result.reservation.status,

        businessId: result.reservation.businessId,

        startAt: result.reservation.startAt,

        endAt: result.reservation.endAt,

        /*
         * Alias hoteleros temporales para no
         * romper consumidores del endpoint viejo.
         */
        checkIn: result.reservation.startAt,

        checkOut: result.reservation.endAt,

        service: {
          id: result.assignment.reservationService?.service.id,

          name: result.assignment.reservationService?.service.name,
        },

        resource: {
          id: resource.id,

          name: resource.name,

          code: resource.code,

          floor: resource.floor,

          resourceType: resource.resourceType?.name,
        },

        /*
         * Respuesta compatible con el hotel.
         *
         * En la futura API universal utilizaremos
         * solamente `resource`.
         */
        room: {
          id: resource.id,

          number: resource.code ?? resource.name,

          floor: resource.floor,

          roomType: resource.resourceType?.name,
        },
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
      "RESERVATION_ROOM_OPERATIONAL_SCOPE_INVALID"
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

    console.error("PATCH reservation resource assignment error:", error);

    if (error instanceof Error && error.message === "RESERVATION_NOT_FOUND") {
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

    if (
      error instanceof Error &&
      error.message === "RESERVATION_NOT_ASSIGNABLE"
    ) {
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

    if (
      error instanceof Error &&
      error.message === "RESERVATION_HAS_NO_SERVICES"
    ) {
      return privateJson(
        {
          success: false,
          error: "La reserva no tiene servicios asociados",
        },
        {
          status: 400,
        },
      );
    }

    if (error instanceof Error && error.message === "RESOURCE_NOT_FOUND") {
      return privateJson(
        {
          success: false,
          error: "Habitación o recurso no encontrado o inactivo",
        },
        {
          status: 404,
        },
      );
    }

    if (
      error instanceof Error &&
      (error.message === "RESOURCE_NOT_ALLOWED_FOR_SERVICE" ||
        error.message === "RESERVATION_SERVICE_NOT_VALID")
    ) {
      return privateJson(
        {
          success: false,
          error:
            "El recurso no pertenece al tipo requerido por el servicio reservado",
        },
        {
          status: 400,
        },
      );
    }

    if (
      error instanceof Error &&
      error.message === "RESERVATION_SERVICE_REQUIRED"
    ) {
      return privateJson(
        {
          success: false,
          error:
            "Debes indicar reservationServiceId para determinar a qué servicio asignar el recurso",
        },
        {
          status: 400,
        },
      );
    }

    if (
      error instanceof Error &&
      (error.message === "RESOURCE_ALREADY_ASSIGNED" ||
        error.message === "RESOURCE_REQUIREMENT_ALREADY_SATISFIED")
    ) {
      return privateJson(
        {
          success: false,
          error: "La reserva ya tiene el recurso requerido asignado",
        },
        {
          status: 409,
        },
      );
    }

    if (
      error instanceof Error &&
      error.message === "RESOURCE_ALREADY_OCCUPIED"
    ) {
      return privateJson(
        {
          success: false,
          error: "La habitación ya está ocupada para esas fechas",
        },
        {
          status: 409,
        },
      );
    }

    if (error instanceof Error && error.message === "RESOURCE_BLOCKED") {
      return privateJson(
        {
          success: false,
          error: "La habitación está bloqueada para esas fechas",
        },
        {
          status: 409,
        },
      );
    }

    if (
      error instanceof Error &&
      error.message === "RESOURCE_TYPE_NOT_CONFIGURED"
    ) {
      return privateJson(
        {
          success: false,
          error: "El recurso no tiene un tipo configurado",
        },
        {
          status: 500,
        },
      );
    }

    /*
     * Conflicto de transacción Serializable.
     */
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (
        error.code === "P2002" ||
        error.code === "P2034"
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
        error: "No fue posible asignar la habitación",
      },
      {
        status: 500,
      },
    );
  }
}
