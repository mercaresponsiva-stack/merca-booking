import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

import { isReservationActive } from "@/lib/booking/reservation-state";

import { checkResourceForInterval } from "@/lib/booking/resource-interval-check";

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

            assignedToReservation: Boolean(ownAssignment),

            available: !ownAssignment && intervalCheck.available,

            availability,

            unavailableReason: intervalCheck.available
              ? null
              : intervalCheck.reason,
          });
        }

        requirements.push({
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
