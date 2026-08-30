import { toCents } from "@/lib/booking/money";
import { isReservationPayable } from "@/lib/booking/reservation-state";
import {
  isPaymentTargetStatus,
  isPaymentTransitionAllowed,
} from "@/lib/booking/payment-state";
import { calculatePaymentSummary } from "@/lib/booking/payment-summary";
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

const PAYMENT_UPDATE_ALLOWED_ROLES = ["OWNER", "ADMIN", "RECEPTIONIST"] as const;

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
    await requireAuthenticatedUser();

    const { id, paymentId } = await context.params;

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

    const status = body.status;

    const externalReference =
      body.externalReference !== undefined && body.externalReference !== null
        ? String(body.externalReference)
        : undefined;

    // verifiedById puede seguir llegando por compatibilidad,
    // pero el servidor siempre utiliza al usuario de la sesión.

    // ─────────────────────────────────────────────
    // 1. VALIDAR STATUS
    // ─────────────────────────────────────────────

    if (!isPaymentTargetStatus(status)) {
      return privateJson(
        {
          success: false,
          error: "Estado de pago inválido",
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
      PAYMENT_UPDATE_ALLOWED_ROLES,
    );

    // ─────────────────────────────────────────────
    // 2. TRANSACTION
    // ─────────────────────────────────────────────

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
              in: [...PAYMENT_UPDATE_ALLOWED_ROLES],
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

        // ───────────────────────────────────────
        // 3. PAYMENT
        // ───────────────────────────────────────

        const payment = await tx.payment.findFirst({
          where: {
            id: paymentId,

            reservationId: reservation.id,

            businessId: access.business.id,
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

        if (!isPaymentTransitionAllowed(payment.status, status)) {
          throw new Error("INVALID_PAYMENT_TRANSITION");
        }

        // ───────────────────────────────────────
        // 5. CONFIRMACIÓN PAID
        // ───────────────────────────────────────

        let verifier: {
          id: string;
          name: string;
          email: string;
          role: string;
        } | null = null;

        let verificationDate: Date | null = null;

        if (status === "PAID") {
          /*
           * Ya no permitimos confirmar nuevos
           * cobros después de que la reserva
           * haya finalizado o sido cancelada.
           */

          if (!isReservationPayable(reservation.status)) {
            throw new Error("RESERVATION_NOT_PAYABLE");
          }

          // ─────────────────────────────────────
          // BANK TRANSFER
          //
          // Requiere verificación humana.
          // ─────────────────────────────────────

          if (payment.method === "BANK_TRANSFER") {
            verifier = actor;
            verificationDate = new Date();
          }

          // ─────────────────────────────────────
          // PREVENIR SOBREPAGO
          // ─────────────────────────────────────

          const financialRecords = await tx.payment.findMany({
            where: {
              reservationId: reservation.id,
            },

            select: {
              id: true,
              businessId: true,
              reservationId: true,

              amount: true,
              status: true,

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
          });

          if (
            hasPaymentFinancialScopeViolation(
              financialRecords,
              access.business.id,
              reservation.id,
            )
          ) {
            throw new Error("PAYMENT_FINANCIAL_SCOPE_INVALID");
          }

          /*
           * El Payment que se está confirmando todavía
           * permanece PENDING y no forma parte de netPaid.
           *
           * Las devoluciones COMPLETED sí reducen netPaid
           * y vuelven a generar saldo contractual.
           *
           * Las devoluciones PENDING o PROCESSING todavía
           * no liberan saldo porque el dinero no ha salido.
           */
          const currentPaymentSummary = calculatePaymentSummary({
            total: Number(reservation.total),
            paymentOption: reservation.paymentOption,
            payments: financialRecords,
          });

          const remainingBalanceCents = toCents(currentPaymentSummary.balance);

          const paymentAmountCents = toCents(Number(payment.amount));

          if (paymentAmountCents > remainingBalanceCents) {
            throw new Error("PAYMENT_EXCEEDS_CURRENT_BALANCE");
          }
        }

        // ───────────────────────────────────────
        // 6. UPDATE PAYMENT
        // ───────────────────────────────────────

        const updatedPayment = await tx.payment.update({
          where: {
            id: payment.id,
            businessId: access.business.id,
            reservationId: reservation.id,
          },

          data: {
            status,

            paidAt:
              status === "PAID"
                ? new Date()
                : status === "FAILED"
                  ? null
                  : payment.paidAt,

            /*
             * PAID conserva la información
             * de verificación del pago.
             *
             * FAILED limpia la verificación.
             *
             * Los reembolsos ya no cambian el
             * estado del Payment. Se registran
             * mediante el modelo Refund.
             */
            verifiedAt:
              status === "PAID" && payment.method === "BANK_TRANSFER"
                ? verificationDate
                : status === "FAILED"
                  ? null
                  : payment.verifiedAt,

            verifiedById:
              status === "PAID" && payment.method === "BANK_TRANSFER"
                ? (verifier?.id ?? null)
                : status === "FAILED"
                  ? null
                  : payment.verifiedById,

            ...(externalReference !== undefined
              ? {
                  externalReference,
                }
              : {}),
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

        // ───────────────────────────────────────
        // 7. RECALCULAR RESUMEN
        // ───────────────────────────────────────

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

        return {
          reservation,

          payment: updatedPayment,

          paymentSummary,
        };
      },

      {
        isolationLevel: "Serializable",
      },
    );

    return privateJson({
      success: true,

      reservation: {
        id: result.reservation.id,

        confirmationCode: result.reservation.confirmationCode,

        status: result.reservation.status,

        total: result.reservation.total,

        paymentOption: result.reservation.paymentOption,
      },

      payment: result.payment,

      paymentSummary: result.paymentSummary,
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

    console.error("PATCH reservation payment error:", error);

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

    if (error instanceof Error && error.message === "PAYMENT_NOT_FOUND") {
      return privateJson(
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
      error.message === "PAYMENT_ACTOR_NOT_VALID"
    ) {
      return privateJson(
        {
          success: false,
          error:
            "El usuario que actualiza el pago no tiene una membresía activa con un rol permitido en este negocio",
        },
        {
          status: 403,
        },
      );
    }

    if (
      error instanceof Error &&
      error.message === "PAYMENT_STATUS_ALREADY_SET"
    ) {
      return privateJson(
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
      return privateJson(
        {
          success: false,
          error: "La transición de estado del pago no está permitida",
        },
        {
          status: 409,
        },
      );
    }

    if (error instanceof Error && error.message === "RESERVATION_NOT_PAYABLE") {
      return privateJson(
        {
          success: false,
          error: "La reserva ya no permite confirmar nuevos pagos",
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
      return privateJson(
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
        error: "No fue posible actualizar el pago",
      },
      {
        status: 500,
      },
    );
  }
}
