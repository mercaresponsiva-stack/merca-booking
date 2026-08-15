import { getReservationTransitionPolicyViolation } from "@/lib/booking/reservation-policy";
import {
  isReservationStatus,
  isReservationTransitionAllowed,
  type ReservationStatus,
} from "@/lib/booking/reservation-state";
import { calculatePaymentSummary } from "@/lib/booking/payment-summary";
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

    const status = body.status;

    // ─────────────────────────────────────────────
    // 1. VALIDAR STATUS
    // ─────────────────────────────────────────────

    if (!isReservationStatus(status)) {
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

    // ─────────────────────────────────────────────
    // 2. TRANSACTION
    // ─────────────────────────────────────────────

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
                service: {
                  include: {
                    resourceTypes: true,
                  },
                },

                resources: {
                  include: {
                    resource: true,
                  },
                },
              },
            },

            payments: {
              include: {
                refunds: {
                  select: {
                    amount: true,
                    status: true,
                  },
                },
              },
            },
          },
        });

        if (!reservation) {
          throw new Error("RESERVATION_NOT_FOUND");
        }

        // ───────────────────────────────────────
        // 3. MISMO STATUS
        // ───────────────────────────────────────

        if (reservation.status === status) {
          throw new Error("RESERVATION_STATUS_ALREADY_SET");
        }

        // ───────────────────────────────────────
        // 4. STATE MACHINE
        // ───────────────────────────────────────

        if (!isReservationTransitionAllowed(reservation.status, status)) {
          throw new Error("INVALID_RESERVATION_TRANSITION");
        }

        // ───────────────────────────────────────
        // 5. PAYMENT SUMMARY
        // ───────────────────────────────────────

        const paymentSummary = calculatePaymentSummary({
          total: Number(reservation.total),
          paymentOption: reservation.paymentOption,
          payments: reservation.payments,
        });

        // ───────────────────────────────────────
        // 7. PENDING → CONFIRMED
        //
        // No confirmamos una reserva nueva
        // sin haber recibido el pago inicial
        // requerido.
        // ───────────────────────────────────────

        const policyViolation = getReservationTransitionPolicyViolation({
          targetStatus: status,
          paymentSummary,
          services: reservation.services,
        });

        if (policyViolation) {
          throw new Error(policyViolation);
        }

        // ───────────────────────────────────────
        // 10. UPDATE STATUS
        // ───────────────────────────────────────

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
                service: {
                  include: {
                    resourceTypes: true,
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

        return {
          reservation: updatedReservation,
          paymentSummary,
        };
      },

      {
        isolationLevel: "Serializable",
      },
    );

    // ─────────────────────────────────────────────
    // 11. RESPONSE
    // ─────────────────────────────────────────────

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

        paymentOption: result.reservation.paymentOption,

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

            resourceTypeId: assignment.resource.resourceTypeId,
          })),
        })),
      },

      paymentSummary: result.paymentSummary,
    });
  } catch (error) {
    console.error("PATCH reservation status error:", error);

    // ─────────────────────────────────────────────
    // NOT FOUND
    // ─────────────────────────────────────────────

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

    // ─────────────────────────────────────────────
    // SAME STATUS
    // ─────────────────────────────────────────────

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

    // ─────────────────────────────────────────────
    // INVALID TRANSITION
    // ─────────────────────────────────────────────

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

    // ─────────────────────────────────────────────
    // PAYMENT REQUIRED FOR CONFIRMATION
    // ─────────────────────────────────────────────

    if (
      error instanceof Error &&
      error.message === "INITIAL_PAYMENT_REQUIRED_FOR_CONFIRMATION"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "La reserva no puede confirmarse hasta que se haya pagado el monto inicial requerido",
        },
        {
          status: 409,
        },
      );
    }

    // ─────────────────────────────────────────────
    // PAYMENT REQUIRED FOR CHECK-IN
    // ─────────────────────────────────────────────

    if (
      error instanceof Error &&
      error.message === "INITIAL_PAYMENT_REQUIRED_FOR_CHECK_IN"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "No se puede realizar el check-in porque el pago inicial requerido no está cubierto",
        },
        {
          status: 409,
        },
      );
    }

    // ─────────────────────────────────────────────
    // RESOURCE REQUIRED FOR CHECK-IN
    // ─────────────────────────────────────────────

    if (
      error instanceof Error &&
      error.message === "RESOURCES_REQUIRED_FOR_CHECK_IN"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "No se puede realizar el check-in hasta asignar todos los recursos físicos requeridos por la reserva",
        },
        {
          status: 409,
        },
      );
    }

    // ─────────────────────────────────────────────
    // SERIALIZABLE CONFLICT
    // ─────────────────────────────────────────────

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
