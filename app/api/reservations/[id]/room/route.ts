import {
  getOverlapWhere,
  isResourceBlocked,
} from "@/lib/booking/resource-availability";

import {
  ACTIVE_RESERVATION_STATUSES,
  isReservationActive,
} from "@/lib/booking/reservation-state";
import {
  isResourceRequirementSatisfied,
  resolveReservationServiceForResource,
} from "@/lib/booking/resource-assignment-policy";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: NextRequest,
  context: {
    params: Promise<{ id: string }>;
  },
) {
  try {
    const { id } = await context.params;

    const body = await request.json();

    /*
     * Nombre nuevo:
     * resourceId
     *
     * Compatibilidad temporal con la API del hotel:
     * roomId -> resourceId
     */
    const resourceId = body.resourceId ?? body.roomId;

    /*
     * Para reservas con varios servicios podremos
     * indicar exactamente a qué ReservationService
     * pertenece la asignación.
     *
     * Para el hotel actual, normalmente existe solo
     * uno y puede omitirse.
     */
    const requestedReservationServiceId = body.reservationServiceId ?? null;

    // ─────────────────────────────────────────────
    // 1. VALIDAR RESOURCE
    // ─────────────────────────────────────────────

    if (!resourceId) {
      return NextResponse.json(
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

    const result = await prisma.$transaction(
      async (tx) => {
        // ─────────────────────────────────────────
        // RESERVATION
        // ─────────────────────────────────────────

        const reservation = await tx.reservation.findUnique({
          where: {
            id,
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

        // No tiene sentido asignar recursos a una
        // reserva finalizada o cancelada.

        if (!isReservationActive(reservation.status)) {
          throw new Error("RESERVATION_NOT_ASSIGNABLE");
        }

        if (reservation.services.length === 0) {
          throw new Error("RESERVATION_HAS_NO_SERVICES");
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

        // ─────────────────────────────────────────
        // 8. VERIFICAR QUE EL RESOURCE NO ESTÉ
        //    ASIGNADO A OTRA RESERVA SUPERPUESTA
        //
        // overlap:
        //
        // existing.startAt < requested.endAt
        // &&
        // existing.endAt > requested.startAt
        // ─────────────────────────────────────────

        const overlappingAssignment = await tx.reservationResource.findFirst({
          where: {
            resourceId: resource.id,

            reservationId: {
              not: reservation.id,
            },

            reservation: {
              status: {
                in: [...ACTIVE_RESERVATION_STATUSES],
              },

              ...getOverlapWhere(reservation.startAt, reservation.endAt),
            },
          },

          select: {
            id: true,

            reservation: {
              select: {
                id: true,
                confirmationCode: true,
              },
            },
          },
        });

        if (overlappingAssignment) {
          throw new Error("RESOURCE_ALREADY_OCCUPIED");
        }

        // ─────────────────────────────────────────
        // 9. BLOCKS
        //
        // Comprobamos:
        //
        // Business completo
        // Service completo
        // ResourceType completo
        // Resource específico
        // ─────────────────────────────────────────

        const blocks = await tx.block.findMany({
          where: {
            businessId: reservation.businessId,

            ...getOverlapWhere(reservation.startAt, reservation.endAt),

            OR: [
              {
                serviceId: null,
              },

              {
                serviceId: reservationService.serviceId,
              },

              {
                resourceId: resource.id,
              },
            ],
          },

          select: {
            serviceId: true,
            resourceTypeId: true,
            resourceId: true,
          },
        });

        const resourceBlocked = isResourceBlocked(blocks, {
          serviceId: reservationService.serviceId,

          resourceTypeId: resource.resourceTypeId,

          resourceId: resource.id,
        });

        if (resourceBlocked) {
          throw new Error("RESOURCE_BLOCKED");
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

    return NextResponse.json({
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
    console.error("PATCH reservation resource assignment error:", error);

    if (error instanceof Error && error.message === "RESERVATION_NOT_FOUND") {
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

    if (
      error instanceof Error &&
      error.message === "RESERVATION_NOT_ASSIGNABLE"
    ) {
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

    if (
      error instanceof Error &&
      error.message === "RESERVATION_HAS_NO_SERVICES"
    ) {
      return NextResponse.json(
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
      return NextResponse.json(
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
      return NextResponse.json(
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
      return NextResponse.json(
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
      return NextResponse.json(
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
      return NextResponse.json(
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
      return NextResponse.json(
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
      return NextResponse.json(
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
      error.code === "P2034"
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
        error: "No fue posible asignar la habitación",
      },
      {
        status: 500,
      },
    );
  }
}
