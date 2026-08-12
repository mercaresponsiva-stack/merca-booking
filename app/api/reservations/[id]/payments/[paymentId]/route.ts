import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const ALLOWED_TARGET_STATUSES = ["PAID", "FAILED", "REFUNDED"] as const;

type TargetPaymentStatus = (typeof ALLOWED_TARGET_STATUSES)[number];

export async function PATCH(
  request: NextRequest,
  context: {
    params: Promise<{
      id: string;
      paymentId: string;
    }>;
  },
) {
  try {
    const { id, paymentId } = await context.params;

    const body = await request.json();

    const status = body.status as TargetPaymentStatus | undefined;

    const externalReference =
      body.externalReference !== undefined
        ? String(body.externalReference)
        : undefined;

    // ─────────────────────────────────────────────
    // 1. VALIDAR STATUS
    // ─────────────────────────────────────────────

    if (!status || !ALLOWED_TARGET_STATUSES.includes(status)) {
      return NextResponse.json(
        {
          success: false,
          error: "Estado de pago inválido",
        },
        {
          status: 400,
        },
      );
    }

    // ─────────────────────────────────────────────
    // 2. TRANSACCIÓN SERIALIZABLE
    // ─────────────────────────────────────────────

    const result = await prisma.$transaction(
      async (tx) => {
        const reservation = await tx.reservation.findUnique({
          where: {
            id,
          },

          select: {
            id: true,
            businessId: true,

            confirmationCode: true,

            status: true,

            total: true,
          },
        });

        if (!reservation) {
          throw new Error("RESERVATION_NOT_FOUND");
        }

        // ───────────────────────────────────────
        // 3. PAYMENT
        // ───────────────────────────────────────

        const payment = await tx.payment.findFirst({
          where: {
            id: paymentId,

            reservationId: reservation.id,

            businessId: reservation.businessId,
          },
        });

        if (!payment) {
          throw new Error("PAYMENT_NOT_FOUND");
        }

        // ───────────────────────────────────────
        // 4. VALIDAR TRANSICIÓN
        // ───────────────────────────────────────

        if (payment.status === status) {
          throw new Error("PAYMENT_STATUS_ALREADY_SET");
        }

        const transitionAllowed = isTransitionAllowed(payment.status, status);

        if (!transitionAllowed) {
          throw new Error("INVALID_PAYMENT_TRANSITION");
        }

        // ───────────────────────────────────────
        // 5. SI VAMOS A CONFIRMAR COMO PAID,
        //    RECALCULAR SALDO
        //
        // Esto evita:
        //
        // Reserva $240
        // PENDING $200
        // PENDING $200
        //
        // y que ambos puedan terminar PAID.
        // ───────────────────────────────────────

        if (status === "PAID") {
          const paidAggregate = await tx.payment.aggregate({
            where: {
              reservationId: reservation.id,

              status: "PAID",

              id: {
                not: payment.id,
              },
            },

            _sum: {
              amount: true,
            },
          });

          const total = Number(reservation.total);

          const alreadyPaid = Number(paidAggregate._sum.amount ?? 0);

          const remainingBalance = Math.max(total - alreadyPaid, 0);

          const paymentAmount = Number(payment.amount);

          if (paymentAmount > remainingBalance) {
            throw new Error("PAYMENT_EXCEEDS_CURRENT_BALANCE");
          }
        }

        // ───────────────────────────────────────
        // 6. ACTUALIZAR PAYMENT
        // ───────────────────────────────────────

        const updatedPayment = await tx.payment.update({
          where: {
            id: payment.id,
          },

          data: {
            status,

            /*
             * PAID recibe timestamp.
             *
             * FAILED nunca fue pagado.
             *
             * REFUNDED conserva el paidAt
             * original para no perder cuándo
             * fue recibido originalmente.
             */
            paidAt:
              status === "PAID"
                ? new Date()
                : status === "FAILED"
                  ? null
                  : payment.paidAt,

            ...(externalReference !== undefined
              ? {
                  externalReference,
                }
              : {}),
          },
        });

        // ───────────────────────────────────────
        // 7. NUEVO RESUMEN
        // ───────────────────────────────────────

        const payments = await tx.payment.findMany({
          where: {
            reservationId: reservation.id,
          },

          orderBy: {
            createdAt: "desc",
          },
        });

        const total = Number(reservation.total);

        const paid = payments
          .filter((item) => item.status === "PAID")
          .reduce((sum, item) => sum + Number(item.amount), 0);

        const pending = payments
          .filter((item) => item.status === "PENDING")
          .reduce((sum, item) => sum + Number(item.amount), 0);

        const refunded = payments
          .filter((item) => item.status === "REFUNDED")
          .reduce((sum, item) => sum + Number(item.amount), 0);

        const balance = Math.max(total - paid, 0);

        return {
          reservation,

          payment: updatedPayment,

          paymentSummary: {
            total,
            paid,
            pending,
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

    // ─────────────────────────────────────────────
    // 8. RESPONSE
    // ─────────────────────────────────────────────

    return NextResponse.json({
      success: true,

      reservation: {
        id: result.reservation.id,

        confirmationCode: result.reservation.confirmationCode,

        status: result.reservation.status,

        total: result.reservation.total,
      },

      payment: result.payment,

      paymentSummary: result.paymentSummary,
    });
  } catch (error) {
    console.error("PATCH reservation payment error:", error);

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

    if (error instanceof Error && error.message === "PAYMENT_NOT_FOUND") {
      return NextResponse.json(
        {
          success: false,
          error: "Pago no encontrado para esta reserva",
        },
        {
          status: 404,
        },
      );
    }

    if (
      error instanceof Error &&
      error.message === "PAYMENT_STATUS_ALREADY_SET"
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "El pago ya tiene ese estado",
        },
        {
          status: 409,
        },
      );
    }

    if (
      error instanceof Error &&
      error.message === "INVALID_PAYMENT_TRANSITION"
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "La transición de estado del pago no está permitida",
        },
        {
          status: 409,
        },
      );
    }

    if (
      error instanceof Error &&
      error.message === "PAYMENT_EXCEEDS_CURRENT_BALANCE"
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "El pago supera el saldo pendiente actual de la reserva",
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
            "El estado del pago cambió mientras se procesaba la solicitud. Intenta nuevamente.",
        },
        {
          status: 409,
        },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: "No fue posible actualizar el pago",
      },
      {
        status: 500,
      },
    );
  }
}

// ─────────────────────────────────────────────
// PAYMENT STATE MACHINE
// ─────────────────────────────────────────────

function isTransitionAllowed(
  currentStatus: string,
  targetStatus: TargetPaymentStatus,
) {
  if (currentStatus === "PENDING") {
    return targetStatus === "PAID" || targetStatus === "FAILED";
  }

  if (currentStatus === "PAID") {
    return targetStatus === "REFUNDED";
  }

  return false;
}
