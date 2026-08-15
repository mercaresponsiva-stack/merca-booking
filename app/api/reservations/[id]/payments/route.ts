import { calculateReservationFinancialState } from "@/lib/booking/reservation-financial-state";
import { isReservationPayable } from "@/lib/booking/reservation-state";
import { calculatePaymentSummary } from "@/lib/booking/payment-summary";
import { fromCents, toCents } from "@/lib/booking/money";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const INITIAL_PAYMENT_METHODS = ["CARD", "BANK_TRANSFER"] as const;

type InitialPaymentMethod = (typeof INITIAL_PAYMENT_METHODS)[number];

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
          include: {
            refunds: {
              select: {
                amount: true,
                status: true,
              },
            },
          },

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

    const paymentSummary = calculatePaymentSummary({
      total: Number(reservation.total),
      paymentOption: reservation.paymentOption,
      payments: reservation.payments,
    });

    const financialState = calculateReservationFinancialState({
      status: reservation.status,

      paymentSummary,
    });

    return NextResponse.json({
      success: true,

      reservation: {
        id: reservation.id,

        confirmationCode: reservation.confirmationCode,

        status: reservation.status,

        total: reservation.total,

        paymentOption: reservation.paymentOption,
      },

      paymentSummary,

      financialState,

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

    const method = body.method as string | undefined;

    const proofUrl =
      body.proofUrl !== undefined && body.proofUrl !== null
        ? String(body.proofUrl)
        : null;

    const verifiedById =
      body.verifiedById !== undefined && body.verifiedById !== null
        ? String(body.verifiedById)
        : null;

    if (!method) {
      return NextResponse.json(
        {
          success: false,
          error: "Debes indicar un método de pago",
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

          select: {
            id: true,
            businessId: true,

            confirmationCode: true,

            status: true,

            total: true,

            paymentOption: true,
          },
        });

        if (!reservation) {
          throw new Error("RESERVATION_NOT_FOUND");
        }

        if (!isReservationPayable(reservation.status)) {
          throw new Error("RESERVATION_NOT_PAYABLE");
        }

        // Las reservas nuevas deben tener
        // modalidad de pago definida.

        if (
          reservation.paymentOption !== "FULL" &&
          reservation.paymentOption !== "DEPOSIT_50"
        ) {
          throw new Error("PAYMENT_OPTION_NOT_CONFIGURED");
        }

        const payments = await tx.payment.findMany({
          where: {
            reservationId: reservation.id,
          },

          include: {
            refunds: {
              select: {
                amount: true,
                status: true,
              },
            },
          },

          orderBy: {
            createdAt: "desc",
          },
        });

        const paymentSummary = calculatePaymentSummary({
          total: Number(reservation.total),
          paymentOption: reservation.paymentOption,
          payments,
        });

        const balanceCents = toCents(paymentSummary.balance);

        if (paymentSummary.isPaid) {
          throw new Error("RESERVATION_ALREADY_PAID");
        }

        // ─────────────────────────────────────
        // CASH
        //
        // Solo se permite para cubrir el saldo
        // restante de DEPOSIT_50 y únicamente
        // durante CHECK_IN.
        // ─────────────────────────────────────

        if (method === "CASH") {
          if (reservation.paymentOption !== "DEPOSIT_50") {
            throw new Error("CASH_ONLY_FOR_DEPOSIT_BALANCE");
          }

          if (reservation.status !== "CHECKED_IN") {
            throw new Error("CASH_ONLY_AT_CHECK_IN");
          }

          if (!paymentSummary.initialPaymentSatisfied) {
            throw new Error("INITIAL_DEPOSIT_NOT_PAID");
          }

          if (!verifiedById) {
            throw new Error("CASH_RECEIVER_REQUIRED");
          }

          const receiver = await tx.user.findFirst({
            where: {
              id: verifiedById,

              businessId: reservation.businessId,

              isActive: true,
            },

            select: {
              id: true,
              name: true,
              email: true,
              role: true,
            },
          });

          if (!receiver) {
            throw new Error("CASH_RECEIVER_NOT_FOUND");
          }

          const paymentDate = new Date();

          const payment = await tx.payment.create({
            data: {
              businessId: reservation.businessId,

              reservationId: reservation.id,

              amount: fromCents(balanceCents),

              method: "CASH",

              status: "PAID",

              paidAt: paymentDate,

              verifiedAt: paymentDate,

              verifiedById: receiver.id,
            },

            include: {
              verifiedBy: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  role: true,
                },
              },
            },
          });

          return {
            reservation,
            payment,
          };
        }

        // ─────────────────────────────────────
        // CARD / BANK_TRANSFER
        // ─────────────────────────────────────

        if (!INITIAL_PAYMENT_METHODS.includes(method as InitialPaymentMethod)) {
          throw new Error("PAYMENT_METHOD_NOT_ALLOWED");
        }

        /*
         * Evitamos generar dos intentos
         * simultáneos mientras exista un
         * pago pendiente de tarjeta o
         * transferencia.
         */

        const existingPendingInitialPayment = payments.find(
          (payment) =>
            payment.status === "PENDING" &&
            (payment.method === "CARD" || payment.method === "BANK_TRANSFER"),
        );

        if (existingPendingInitialPayment) {
          throw new Error("PENDING_PAYMENT_EXISTS");
        }

        let amountCents: number;

        // ─────────────────────────────────────
        // FULL
        // ─────────────────────────────────────

        if (reservation.paymentOption === "FULL") {
          amountCents = balanceCents;
        }

        // ─────────────────────────────────────
        // DEPOSIT_50
        // ─────────────────────────────────────
        else {
          if (paymentSummary.initialPaymentSatisfied) {
            throw new Error("INITIAL_DEPOSIT_ALREADY_PAID");
          }

          if (
            paymentSummary.requiredInitialPayment === null ||
            paymentSummary.initialPaymentRemaining === null
          ) {
            throw new Error("PAYMENT_OPTION_NOT_CONFIGURED");
          }

          /*
           * DEPOSIT_50 puede requerir más de un pago.
           *
           * Ejemplo:
           *
           * Reserva original:
           * total = 140
           * anticipo requerido = 70
           * netPaid = 70
           *
           * Después de reprogramar:
           * total = 225
           * anticipo requerido = 112.50
           *
           * Nuevo Payment:
           * 112.50 - 70 = 42.50
           */
          amountCents = toCents(paymentSummary.initialPaymentRemaining);

          if (amountCents <= 0) {
            throw new Error("INITIAL_DEPOSIT_ALREADY_PAID");
          }
        }

        // ─────────────────────────────────────
        // CREATE INITIAL PAYMENT
        // ─────────────────────────────────────

        const payment = await tx.payment.create({
          data: {
            businessId: reservation.businessId,

            reservationId: reservation.id,

            amount: fromCents(amountCents),

            method: method as InitialPaymentMethod,

            /*
             * Tarjeta:
             * el proveedor deberá confirmar.
             *
             * Transferencia:
             * recepción deberá verificar.
             */
            status: "PENDING",

            proofUrl: method === "BANK_TRANSFER" ? proofUrl : null,

            verifiedAt: null,

            verifiedById: null,

            paidAt: null,
          },
        });

        return {
          reservation,
          payment,
        };
      },

      {
        isolationLevel: "Serializable",
      },
    );

    // ─────────────────────────────────────────
    // RECALCULAR RESUMEN FINANCIERO
    // ─────────────────────────────────────────

    const updatedPayments = await prisma.payment.findMany({
      where: {
        reservationId: result.reservation.id,
      },

      include: {
        refunds: {
          select: {
            amount: true,
            status: true,
          },
        },
      },

      orderBy: {
        createdAt: "desc",
      },
    });

    const paymentSummary = calculatePaymentSummary({
      total: Number(result.reservation.total),
      paymentOption: result.reservation.paymentOption,
      payments: updatedPayments,
    });

    return NextResponse.json(
      {
        success: true,

        reservation: {
          id: result.reservation.id,

          confirmationCode: result.reservation.confirmationCode,

          status: result.reservation.status,

          total: result.reservation.total,

          paymentOption: result.reservation.paymentOption,
        },

        payment: result.payment,

        paymentSummary,
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
      error.message === "PAYMENT_OPTION_NOT_CONFIGURED"
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "La reserva no tiene una modalidad de pago configurada",
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

    if (
      error instanceof Error &&
      error.message === "PAYMENT_METHOD_NOT_ALLOWED"
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Método de pago no permitido para este flujo",
        },
        {
          status: 400,
        },
      );
    }

    if (error instanceof Error && error.message === "PENDING_PAYMENT_EXISTS") {
      return NextResponse.json(
        {
          success: false,
          error: "Ya existe un pago inicial pendiente para esta reserva",
        },
        {
          status: 409,
        },
      );
    }

    if (
      error instanceof Error &&
      error.message === "INITIAL_DEPOSIT_ALREADY_PAID"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "El anticipo del 50% ya fue pagado. El saldo restante se paga en efectivo durante el check-in.",
        },
        {
          status: 409,
        },
      );
    }

    if (
      error instanceof Error &&
      error.message === "CASH_ONLY_FOR_DEPOSIT_BALANCE"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "El efectivo solo puede utilizarse para cubrir el saldo restante de una reserva con anticipo del 50%",
        },
        {
          status: 400,
        },
      );
    }

    if (error instanceof Error && error.message === "CASH_ONLY_AT_CHECK_IN") {
      return NextResponse.json(
        {
          success: false,
          error:
            "El saldo en efectivo solo puede registrarse durante el check-in",
        },
        {
          status: 409,
        },
      );
    }

    if (
      error instanceof Error &&
      error.message === "INITIAL_DEPOSIT_NOT_PAID"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "El anticipo del 50% debe estar pagado antes de registrar el saldo en efectivo",
        },
        {
          status: 409,
        },
      );
    }

    if (error instanceof Error && error.message === "CASH_RECEIVER_REQUIRED") {
      return NextResponse.json(
        {
          success: false,
          error:
            "Debes indicar verifiedById para registrar un pago en efectivo",
        },
        {
          status: 400,
        },
      );
    }

    if (error instanceof Error && error.message === "CASH_RECEIVER_NOT_FOUND") {
      return NextResponse.json(
        {
          success: false,
          error:
            "El usuario que recibe el efectivo no existe, está inactivo o no pertenece al negocio",
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
