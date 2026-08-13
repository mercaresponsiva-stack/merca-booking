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

    // ─────────────────────────────────────────────
    // 1. VALIDAR STATUS
    // ─────────────────────────────────────────────

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

            payments: true,
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

        if (!isTransitionAllowed(reservation.status, status)) {
          throw new Error("INVALID_RESERVATION_TRANSITION");
        }

        // ───────────────────────────────────────
        // 5. PAYMENT SUMMARY
        //
        // Solamente PAID cuenta como dinero
        // efectivamente recibido.
        // ───────────────────────────────────────

        const totalCents = toCents(Number(reservation.total));

        const paidCents = reservation.payments
          .filter((payment) => payment.status === "PAID")
          .reduce((sum, payment) => sum + toCents(Number(payment.amount)), 0);

        const refundedCents = reservation.payments
          .filter((payment) => payment.status === "REFUNDED")
          .reduce((sum, payment) => sum + toCents(Number(payment.amount)), 0);

        const balanceCents = Math.max(totalCents - paidCents, 0);

        // ───────────────────────────────────────
        // 6. INITIAL PAYMENT REQUIREMENT
        //
        // FULL       → 100%
        // DEPOSIT_50 → 50%
        //
        // null se permite temporalmente para
        // reservas históricas creadas antes
        // de introducir PaymentOption.
        // ───────────────────────────────────────

        const requiredInitialPaymentCents = getRequiredInitialPaymentCents(
          totalCents,
          reservation.paymentOption,
        );

        const initialPaymentSatisfied =
          requiredInitialPaymentCents === null
            ? true
            : paidCents >= requiredInitialPaymentCents;

        // ───────────────────────────────────────
        // 7. PENDING → CONFIRMED
        //
        // No confirmamos una reserva nueva
        // sin haber recibido el pago inicial
        // requerido.
        // ───────────────────────────────────────

        if (status === "CONFIRMED" && !initialPaymentSatisfied) {
          throw new Error("INITIAL_PAYMENT_REQUIRED_FOR_CONFIRMATION");
        }

        // ───────────────────────────────────────
        // 8. CONFIRMED → CHECKED_IN
        //
        // Revalidamos el pago porque podría
        // haberse realizado un refund después
        // de confirmar la reserva.
        // ───────────────────────────────────────

        if (status === "CHECKED_IN" && !initialPaymentSatisfied) {
          throw new Error("INITIAL_PAYMENT_REQUIRED_FOR_CHECK_IN");
        }

        // ───────────────────────────────────────
        // 9. RESOURCE ASSIGNMENT BEFORE CHECK-IN
        //
        // Hotel:
        //
        // ReservationService Deluxe
        //       ↓
        // ResourceType Deluxe
        //       ↓
        // debe tener 201 o 202 asignada
        //
        // La implementación es genérica:
        // funciona con cualquier Service que
        // requiera Resources físicos.
        // ───────────────────────────────────────

        if (status === "CHECKED_IN") {
          for (const reservationService of reservation.services) {
            for (const requirement of reservationService.service
              .resourceTypes) {
              const requiredQuantity = Math.max(
                1,
                requirement.requiredQuantity,
              );

              const requiredResources =
                reservationService.quantity * requiredQuantity;

              const assignedResources = reservationService.resources.filter(
                (assignment) =>
                  assignment.resource.resourceTypeId ===
                  requirement.resourceTypeId,
              ).length;

              if (assignedResources < requiredResources) {
                throw new Error("RESOURCES_REQUIRED_FOR_CHECK_IN");
              }
            }
          }
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

            payments: true,
          },
        });

        return {
          reservation: updatedReservation,

          paymentSummary: {
            total: fromCents(totalCents),

            paid: fromCents(paidCents),

            refunded: fromCents(refundedCents),

            balance: fromCents(balanceCents),

            isPaid: balanceCents === 0,

            paymentOption: reservation.paymentOption,

            requiredInitialPayment:
              requiredInitialPaymentCents === null
                ? null
                : fromCents(requiredInitialPaymentCents),

            initialPaymentSatisfied,
          },
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

// ─────────────────────────────────────────────
// RESERVATION STATE MACHINE
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
// INITIAL PAYMENT
// ─────────────────────────────────────────────

function getRequiredInitialPaymentCents(
  totalCents: number,
  paymentOption: "FULL" | "DEPOSIT_50" | null,
) {
  if (paymentOption === "FULL") {
    return totalCents;
  }

  if (paymentOption === "DEPOSIT_50") {
    return Math.round(totalCents / 2);
  }

  /*
   * Reservas históricas creadas antes
   * de PaymentOption.
   *
   * null significa que temporalmente no
   * aplicamos esta nueva regla financiera.
   */
  return null;
}

// ─────────────────────────────────────────────
// MONEY HELPERS
// ─────────────────────────────────────────────

function toCents(amount: number) {
  return Math.round(amount * 100);
}

function fromCents(cents: number) {
  return cents / 100;
}
