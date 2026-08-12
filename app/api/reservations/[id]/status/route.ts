import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const RESERVATION_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "CANCELLED",
  "NO_SHOW",
  "CHECKED_IN",
  "CHECKED_OUT",
  "COMPLETED",
] as const;

type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export async function PATCH(
  request: NextRequest,
  context: {
    params: Promise<{ id: string }>;
  },
) {
  try {
    const { id } = await context.params;

    const body = await request.json();

    const status = body.status as ReservationStatus | undefined;

    if (!status || !RESERVATION_STATUSES.includes(status)) {
      return NextResponse.json(
        {
          success: false,
          error: "Estado de reserva inválido",
        },
        {
          status: 400,
        },
      );
    }

    const result = await prisma.$transaction(
      async (tx) => {
        const reservation = await tx.reservation.findUnique({
          where: {
            id,
          },

          include: {
            customer: true,

            services: {
              include: {
                service: true,

                resources: {
                  include: {
                    resource: true,
                  },
                },
              },
            },

            payments: true,
          },
        });

        if (!reservation) {
          throw new Error("RESERVATION_NOT_FOUND");
        }

        if (reservation.status === status) {
          throw new Error("RESERVATION_STATUS_ALREADY_SET");
        }

        if (!isTransitionAllowed(reservation.status, status)) {
          throw new Error("INVALID_RESERVATION_TRANSITION");
        }

        const updatedReservation = await tx.reservation.update({
          where: {
            id: reservation.id,
          },

          data: {
            status,
          },

          include: {
            customer: true,

            services: {
              include: {
                service: true,

                resources: {
                  include: {
                    resource: true,
                  },
                },
              },
            },

            payments: true,
          },
        });

        const paid = updatedReservation.payments
          .filter((payment) => payment.status === "PAID")
          .reduce((sum, payment) => sum + Number(payment.amount), 0);

        const refunded = updatedReservation.payments
          .filter((payment) => payment.status === "REFUNDED")
          .reduce((sum, payment) => sum + Number(payment.amount), 0);

        const total = Number(updatedReservation.total);

        const balance = Math.max(total - paid, 0);

        return {
          reservation: updatedReservation,

          paymentSummary: {
            total,
            paid,
            refunded,
            balance,

            isPaid: balance <= 0,
          },
        };
      },

      {
        isolationLevel: "Serializable",
      },
    );

    return NextResponse.json({
      success: true,

      reservation: {
        id: result.reservation.id,

        confirmationCode: result.reservation.confirmationCode,

        status: result.reservation.status,

        startAt: result.reservation.startAt,

        endAt: result.reservation.endAt,

        guests: result.reservation.guests,

        adults: result.reservation.adults,

        children: result.reservation.children,

        subtotal: result.reservation.subtotal,

        total: result.reservation.total,

        customer: result.reservation.customer,

        services: result.reservation.services.map((item) => ({
          id: item.id,

          serviceId: item.serviceId,

          service: item.service.name,

          quantity: item.quantity,

          resources: item.resources.map((assignment) => ({
            id: assignment.id,

            resourceId: assignment.resourceId,

            name: assignment.resource.name,

            code: assignment.resource.code,
          })),
        })),
      },

      paymentSummary: result.paymentSummary,
    });
  } catch (error) {
    console.error("PATCH reservation status error:", error);

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
      error.message === "RESERVATION_STATUS_ALREADY_SET"
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "La reserva ya tiene ese estado",
        },
        {
          status: 409,
        },
      );
    }

    if (
      error instanceof Error &&
      error.message === "INVALID_RESERVATION_TRANSITION"
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "La transición de estado de la reserva no está permitida",
        },
        {
          status: 409,
        },
      );
    }

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
            "El estado de la reserva cambió mientras se procesaba la solicitud. Intenta nuevamente.",
        },
        {
          status: 409,
        },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: "No fue posible actualizar el estado de la reserva",
      },
      {
        status: 500,
      },
    );
  }
}

function isTransitionAllowed(
  currentStatus: string,
  targetStatus: ReservationStatus,
) {
  const transitions: Record<string, ReservationStatus[]> = {
    PENDING: ["CONFIRMED", "CANCELLED"],

    CONFIRMED: ["CHECKED_IN", "CANCELLED", "NO_SHOW"],

    CHECKED_IN: ["CHECKED_OUT"],

    CHECKED_OUT: ["COMPLETED"],

    CANCELLED: [],
    NO_SHOW: [],
    COMPLETED: [],
  };

  return transitions[currentStatus]?.includes(targetStatus) ?? false;
}
