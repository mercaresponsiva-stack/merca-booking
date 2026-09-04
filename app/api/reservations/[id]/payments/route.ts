import { calculateReservationFinancialState } from "@/lib/booking/reservation-financial-state";
import { validatePendingReservationPaymentWindow } from "@/lib/booking/reservation-expiration-deadline";
import { isReservationPayable } from "@/lib/booking/reservation-state";
import { calculatePaymentSummary } from "@/lib/booking/payment-summary";
import {
  isDepositPaymentOption,
  isPaymentOption,
} from "@/lib/booking/payment-option";
import { fromCents, toCents } from "@/lib/booking/money";
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

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const PAYMENT_ALLOWED_ROLES = ["OWNER", "ADMIN", "RECEPTIONIST"] as const;

type FinancialScopeRefund = {
  businessId: string;
  reservationId: string;
  paymentId: string;
};

type FinancialScopePayment = {
  id: string;
  businessId: string;
  reservationId: string;
  refunds: readonly FinancialScopeRefund[];
};

function hasPaymentFinancialScopeViolation(
  payments: readonly FinancialScopePayment[],
  businessId: string,
  reservationId: string,
) {
  return payments.some(
    (payment) =>
      payment.businessId !== businessId ||
      payment.reservationId !== reservationId ||
      payment.refunds.some(
        (refund) =>
          refund.businessId !== businessId ||
          refund.reservationId !== reservationId ||
          refund.paymentId !== payment.id,
      ),
  );
}

const INITIAL_PAYMENT_METHODS = ["CARD", "BANK_TRANSFER"] as const;

type InitialPaymentMethod = (typeof INITIAL_PAYMENT_METHODS)[number];

export async function GET(
  _request: NextRequest,
  context: {
    params: Promise<{ id: string }>;
  },
) {
  try {
    await requireAuthenticatedUser();

    const { id } = await context.params;

    const reservationScope = await prisma.reservation.findUnique({
      where: {
        id,
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
      PAYMENT_ALLOWED_ROLES,
    );

    const reservation = await prisma.reservation.findFirst({
      where: {
        id,
        businessId: access.business.id,
        business: {
          is: {
            isActive: true,
          },
        },
      },

      include: {
        payments: {
          include: {
            refunds: {
              select: {
                businessId: true,
                reservationId: true,
                paymentId: true,
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
      hasPaymentFinancialScopeViolation(
        reservation.payments,
        access.business.id,
        reservation.id,
      )
    ) {
      throw new Error("PAYMENT_FINANCIAL_SCOPE_INVALID");
    }

    const payments = reservation.payments.map((payment) => ({
      ...payment,
      refunds: payment.refunds.map((refund) => ({
        amount: refund.amount,
        status: refund.status,
      })),
    }));

    const paymentSummary = calculatePaymentSummary({
      total: Number(reservation.total),
      paymentOption: reservation.paymentOption,
      payments,
    });

    const financialState = calculateReservationFinancialState({
      status: reservation.status,

      paymentSummary,
    });

    return privateJson({
      success: true,

      reservation: {
        id: reservation.id,

        confirmationCode: reservation.confirmationCode,

        status: reservation.status,

        expiresAt:
          reservation.expiresAt,

        total: reservation.total,

        paymentOption: reservation.paymentOption,
      },

      paymentSummary,

      financialState,

      payments,
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

    console.error("GET reservation payments error:", error);

    return privateJson(
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
    await requireAuthenticatedUser();

    const { id } = await context.params;

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return privateJson(
        {
          success: false,
          code: "INVALID_JSON",
          error: "El cuerpo de la solicitud no contiene JSON válido.",
        },
        {
          status: 400,
        },
      );
    }

    if (!isJsonObject(body)) {
      return privateJson(
        {
          success: false,
          code: "INVALID_JSON",
          error: "El cuerpo de la solicitud debe ser un objeto JSON válido.",
        },
        {
          status: 400,
        },
      );
    }

    const method =
      typeof body.method === "string" ? body.method : undefined;

    const proofUrl =
      body.proofUrl !== undefined && body.proofUrl !== null
        ? String(body.proofUrl)
        : null;

    // verifiedById puede seguir llegando por compatibilidad,
    // pero el servidor siempre utiliza al usuario de la sesión.

    if (!method) {
      return privateJson(
        {
          success: false,
          error: "Debes indicar un método de pago",
        },
        {
          status: 400,
        },
      );
    }

    const reservationScope = await prisma.reservation.findUnique({
      where: {
        id,
      },
      select: {
        businessId: true,
      },
    });

    if (!reservationScope) {
      throw new Error("RESERVATION_NOT_FOUND");
    }

    const access = await requireBusinessAccess(
      reservationScope.businessId,
      PAYMENT_ALLOWED_ROLES,
    );

    const result = await prisma.$transaction(
      async (tx) => {
        const reservation = await tx.reservation.findFirst({
          where: {
            id,
            businessId: access.business.id,
          },

          select: {
            id: true,
            businessId: true,

            confirmationCode: true,

            status: true,

            expiresAt:
              true,

            total: true,

            paymentOption: true,
          },
        });

        if (!reservation) {
          throw new Error("RESERVATION_NOT_FOUND");
        }

        const actorMembership = await tx.businessMembership.findFirst({
          where: {
            businessId: access.business.id,
            userId: access.user.id,
            isActive: true,
            role: {
              in: [...PAYMENT_ALLOWED_ROLES],
            },
            user: {
              is: {
                isActive: true,
              },
            },
            business: {
              is: {
                isActive: true,
              },
            },
          },
          select: {
            role: true,
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        });

        if (!actorMembership) {
          throw new Error("PAYMENT_ACTOR_NOT_VALID");
        }

        const actor = {
          id: actorMembership.user.id,
          name: actorMembership.user.name,
          email: actorMembership.user.email,
          role: actorMembership.role,
        };

        if (!isReservationPayable(reservation.status)) {
          throw new Error("RESERVATION_NOT_PAYABLE");
        }

        validatePendingReservationPaymentWindow({
          status:
            reservation.status,

          expiresAt:
            reservation.expiresAt,

          requestedAt:
            new Date(),
        });

        // Las reservas nuevas deben conservar una
        // modalidad de pago reconocida en su contrato.

        if (!isPaymentOption(reservation.paymentOption)) {
          throw new Error("PAYMENT_OPTION_NOT_CONFIGURED");
        }

        const payments = await tx.payment.findMany({
          where: {
            reservationId: reservation.id,
          },

          include: {
            refunds: {
              select: {
                businessId: true,
                reservationId: true,
                paymentId: true,
                amount: true,
                status: true,
              },
            },
          },

          orderBy: {
            createdAt: "desc",
          },
        });

        if (
          hasPaymentFinancialScopeViolation(
            payments,
            access.business.id,
            reservation.id,
          )
        ) {
          throw new Error("PAYMENT_FINANCIAL_SCOPE_INVALID");
        }

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
        // restante de una modalidad con anticipo
        // y únicamente durante CHECK_IN.
        // ─────────────────────────────────────

        if (method === "CASH") {
          if (
            !isDepositPaymentOption(
              reservation.paymentOption,
            )
          ) {
            throw new Error("CASH_ONLY_FOR_DEPOSIT_BALANCE");
          }

          if (reservation.status !== "CHECKED_IN") {
            throw new Error("CASH_ONLY_AT_CHECK_IN");
          }

          if (!paymentSummary.initialPaymentSatisfied) {
            throw new Error("INITIAL_DEPOSIT_NOT_PAID");
          }

          const receiver = actor;

          const paymentDate = new Date();

          const payment = await tx.payment.create({
            data: {
              businessId: access.business.id,

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
        // DEPOSIT_10 / DEPOSIT_25 / DEPOSIT_50
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
           * Un anticipo porcentual puede requerir más de un pago.
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
            businessId: access.business.id,

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
            businessId: true,
            reservationId: true,
            paymentId: true,
            amount: true,
            status: true,
          },
        },
      },

      orderBy: {
        createdAt: "desc",
      },
    });

    if (
      hasPaymentFinancialScopeViolation(
        updatedPayments,
        access.business.id,
        result.reservation.id,
      )
    ) {
      throw new Error("PAYMENT_FINANCIAL_SCOPE_INVALID");
    }

    const paymentSummary = calculatePaymentSummary({
      total: Number(result.reservation.total),
      paymentOption: result.reservation.paymentOption,
      payments: updatedPayments,
    });

    return privateJson(
      {
        success: true,

        reservation: {
          id: result.reservation.id,

          confirmationCode: result.reservation.confirmationCode,

          status: result.reservation.status,

          expiresAt:
            result.reservation.expiresAt,

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

    const isExpectedExpirationPaymentError =
      error instanceof Error &&
      (
        error.message ===
          "PENDING_RESERVATION_EXPIRATION_NOT_CONFIGURED" ||
        error.message ===
          "INVALID_PENDING_RESERVATION_EXPIRATION_TIMESTAMP" ||
        error.message ===
          "PENDING_RESERVATION_PAYMENT_WINDOW_EXPIRED"
      );

    if (
      !isExpectedExpirationPaymentError
    ) {
      console.error(
        "POST reservation payment error:",
        error,
      );
    }

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

    if (error instanceof Error && error.message === "RESERVATION_NOT_PAYABLE") {
      return privateJson(
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
      error.message ===
        "PENDING_RESERVATION_EXPIRATION_NOT_CONFIGURED"
    ) {
      return privateJson(
        {
          success: false,

          code:
            error.message,

          error:
            "La reserva pendiente no tiene una fecha de vencimiento configurada.",
        },
        {
          status: 409,
        },
      );
    }

    if (
      error instanceof Error &&
      error.message ===
        "INVALID_PENDING_RESERVATION_EXPIRATION_TIMESTAMP"
    ) {
      return privateJson(
        {
          success: false,

          code:
            error.message,

          error:
            "La fecha de vencimiento de la reserva pendiente no es válida.",
        },
        {
          status: 409,
        },
      );
    }

    if (
      error instanceof Error &&
      error.message ===
        "PENDING_RESERVATION_PAYMENT_WINDOW_EXPIRED"
    ) {
      return privateJson(
        {
          success: false,

          code:
            error.message,

          error:
            "El plazo de pago de la reserva venció y no pueden iniciarse pagos nuevos.",
        },
        {
          status: 409,
        },
      );
    }

    if (
      error instanceof Error &&
      error.message === "PAYMENT_ACTOR_NOT_VALID"
    ) {
      return privateJson(
        {
          success: false,
          error:
            "El usuario que registra el pago no tiene una membresía activa con un rol permitido en este negocio",
        },
        {
          status: 403,
        },
      );
    }

    if (
      error instanceof Error &&
      error.message === "PAYMENT_OPTION_NOT_CONFIGURED"
    ) {
      return privateJson(
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
      return privateJson(
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
      return privateJson(
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
      return privateJson(
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
      return privateJson(
        {
          success: false,
          error:
            "El anticipo requerido ya fue pagado. El saldo restante se paga en efectivo durante el check-in.",
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
      return privateJson(
        {
          success: false,
          error:
            "El efectivo solo puede utilizarse para cubrir el saldo restante de una reserva con anticipo",
        },
        {
          status: 400,
        },
      );
    }

    if (error instanceof Error && error.message === "CASH_ONLY_AT_CHECK_IN") {
      return privateJson(
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
      return privateJson(
        {
          success: false,
          error:
            "El anticipo requerido debe estar pagado antes de registrar el saldo en efectivo",
        },
        {
          status: 409,
        },
      );
    }

    if (
      error instanceof Error &&
      error.message === "PAYMENT_FINANCIAL_SCOPE_INVALID"
    ) {
      return privateJson(
        {
          success: false,
          error:
            "Los datos financieros de la reserva no son consistentes con el negocio autorizado",
        },
        {
          status: 500,
        },
      );
    }

    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2034"
    ) {
      return privateJson(
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

    return privateJson(
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
