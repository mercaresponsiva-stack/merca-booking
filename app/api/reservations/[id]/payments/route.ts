import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const PAYMENT_METHODS = [
  "PAYMENT_LINK",
  "CASH",
  "BANK_TRANSFER",
  "CARD",
  "OTHER",
] as const;

type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export async function GET(
  _request: NextRequest,
  context: {
    params: Promise<{ id: string }>;
  },
) {
  try {
    const { id } = await context.params;

    const reservation = await prisma.reservation.findUnique({
      where: {
        id,
      },

      include: {
        payments: {
          orderBy: {
            createdAt: "desc",
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

    const total = Number(reservation.total);

    const paid = reservation.payments
      .filter((payment) => payment.status === "PAID")
      .reduce((sum, payment) => sum + Number(payment.amount), 0);

    const pending = reservation.payments
      .filter((payment) => payment.status === "PENDING")
      .reduce((sum, payment) => sum + Number(payment.amount), 0);

    const refunded = reservation.payments
      .filter((payment) => payment.status === "REFUNDED")
      .reduce((sum, payment) => sum + Number(payment.amount), 0);

    const balance = Math.max(total - paid, 0);

    return NextResponse.json({
      success: true,

      reservation: {
        id: reservation.id,

        confirmationCode: reservation.confirmationCode,

        status: reservation.status,

        total: reservation.total,
      },

      paymentSummary: {
        total,
        paid,
        pending,
        refunded,
        balance,
        isPaid: balance <= 0,
      },

      payments: reservation.payments,
    });
  } catch (error) {
    console.error("GET reservation payments error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "No fue posible consultar los pagos",
      },
      {
        status: 500,
      },
    );
  }
}

export async function POST(
  request: NextRequest,
  context: {
    params: Promise<{ id: string }>;
  },
) {
  try {
    const { id } = await context.params;

    const body = await request.json();

    const method = body.method as PaymentMethod | undefined;

    const requestedAmount =
      body.amount !== undefined ? Number(body.amount) : null;

    // ─────────────────────────────────────
    // 1. PAYMENT METHOD
    // ─────────────────────────────────────

    if (!method || !PAYMENT_METHODS.includes(method)) {
      return NextResponse.json(
        {
          success: false,
          error: "Método de pago inválido",
        },
        {
          status: 400,
        },
      );
    }

    // ─────────────────────────────────────
    // 2. OPTIONAL AMOUNT
    // ─────────────────────────────────────

    if (
      requestedAmount !== null &&
      (!Number.isFinite(requestedAmount) || requestedAmount <= 0)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "El monto del pago debe ser mayor que cero",
        },
        {
          status: 400,
        },
      );
    }

    // ─────────────────────────────────────
    // 3. SERIALIZABLE PAYMENT CREATION
    // ─────────────────────────────────────

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

        if (
          reservation.status === "CANCELLED" ||
          reservation.status === "NO_SHOW"
        ) {
          throw new Error("RESERVATION_NOT_PAYABLE");
        }

        // ───────────────────────────────
        // 4. TOTAL PAID
        //
        // Only PAID payments reduce the
        // outstanding balance.
        // ───────────────────────────────

        const paidAggregate = await tx.payment.aggregate({
          where: {
            reservationId: reservation.id,

            status: "PAID",
          },

          _sum: {
            amount: true,
          },
        });

        const total = Number(reservation.total);

        const paid = Number(paidAggregate._sum.amount ?? 0);

        const balance = Math.max(total - paid, 0);

        if (balance <= 0) {
          throw new Error("RESERVATION_ALREADY_PAID");
        }

        // ───────────────────────────────
        // 5. PAYMENT AMOUNT
        //
        // If amount is omitted:
        // use complete outstanding balance.
        // ───────────────────────────────

        const amount = requestedAmount ?? balance;

        if (amount > balance) {
          throw new Error("PAYMENT_EXCEEDS_BALANCE");
        }

        // ───────────────────────────────
        // 6. CREATE PAYMENT
        //
        // Creation does NOT mean that
        // money has been received yet.
        //
        // Provider confirmation or manual
        // confirmation will change it to
        // PAID later.
        // ───────────────────────────────

        const payment = await tx.payment.create({
          data: {
            businessId: reservation.businessId,

            reservationId: reservation.id,

            amount,

            method,

            status: "PENDING",

            externalReference: null,

            paymentUrl: null,

            paidAt: null,
          },
        });

        return {
          reservation,
          payment,

          summary: {
            total,

            paid,

            balanceBefore: balance,

            balanceAfterPayment: balance,
          },
        };
      },

      {
        isolationLevel: "Serializable",
      },
    );

    return NextResponse.json(
      {
        success: true,

        reservation: {
          id: result.reservation.id,

          confirmationCode: result.reservation.confirmationCode,

          total: result.reservation.total,
        },

        payment: result.payment,

        paymentSummary: result.summary,
      },
      {
        status: 201,
      },
    );
  } catch (error) {
    console.error("POST reservation payment error:", error);

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

    if (error instanceof Error && error.message === "RESERVATION_NOT_PAYABLE") {
      return NextResponse.json(
        {
          success: false,
          error: "La reserva no permite nuevos pagos",
        },
        {
          status: 409,
        },
      );
    }

    if (
      error instanceof Error &&
      error.message === "RESERVATION_ALREADY_PAID"
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "La reserva ya está pagada completamente",
        },
        {
          status: 409,
        },
      );
    }

    if (error instanceof Error && error.message === "PAYMENT_EXCEEDS_BALANCE") {
      return NextResponse.json(
        {
          success: false,
          error: "El monto supera el saldo pendiente de la reserva",
        },
        {
          status: 400,
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
        error: "No fue posible crear el pago",
      },
      {
        status: 500,
      },
    );
  }
}
