import { fromCents, toCents } from "@/lib/booking/money";

import {
  getRequiredInitialPaymentCents,
  isDepositPaymentOption,
  type PaymentOptionValue,
} from "@/lib/booking/payment-option";

export { getRequiredInitialPaymentCents } from "@/lib/booking/payment-option";
export type { PaymentOptionValue } from "@/lib/booking/payment-option";

type RefundForSummary = {
  amount: unknown;
  status: string;
};

type PaymentForSummary = {
  amount: unknown;
  status: string;

  /*
   * Opcional temporalmente para que el Core
   * siga siendo compatible con llamadas que
   * todavía no incluyan Refund[].
   *
   * Después conectaremos todos los queries.
   */
  refunds?: RefundForSummary[];
};

type CalculatePaymentSummaryInput = {
  total: number;

  paymentOption: PaymentOptionValue;

  payments: PaymentForSummary[];
};

/*
 * El resolver de anticipo se reexporta para conservar
 * compatibilidad con consumidores existentes.
 */

export function calculatePaymentSummary({
  total,
  paymentOption,
  payments,
}: CalculatePaymentSummaryInput) {
  const totalCents = toCents(total);

  // ─────────────────────────────────────────────
  // GROSS PAID
  //
  // PAID:
  // dinero que ingresó y permanece registrado.
  //
  // REFUNDED:
  // compatibilidad histórica.
  //
  // Antes del nuevo modelo algunos pagos fueron
  // cambiados directamente de PAID -> REFUNDED.
  // Ese dinero sí ingresó originalmente, por lo
  // tanto forma parte del grossPaid.
  // ─────────────────────────────────────────────

  const grossPaidCents = payments
    .filter(
      (payment) => payment.status === "PAID" || payment.status === "REFUNDED",
    )
    .reduce((sum, payment) => sum + toCents(Number(payment.amount)), 0);

  // ─────────────────────────────────────────────
  // PENDING PAYMENTS
  // ─────────────────────────────────────────────

  const pendingCents = payments
    .filter((payment) => payment.status === "PENDING")
    .reduce((sum, payment) => sum + toCents(Number(payment.amount)), 0);

  // ─────────────────────────────────────────────
  // LEGACY REFUNDS
  //
  // Payment.status = REFUNDED pertenece al flujo
  // anterior al modelo Refund.
  //
  // Lo seguimos reconociendo para no romper
  // historial existente.
  // ─────────────────────────────────────────────

  const legacyRefundedCents = payments
    .filter((payment) => payment.status === "REFUNDED")
    .reduce((sum, payment) => sum + toCents(Number(payment.amount)), 0);

  // ─────────────────────────────────────────────
  // NEW REFUNDS
  //
  // Para un Payment histórico REFUNDED ignoramos
  // Refund[] adicionales para evitar contabilizar
  // dos veces el mismo dinero.
  // ─────────────────────────────────────────────

  let refundPendingCents = 0;

  let completedRefundCents = 0;

  for (const payment of payments) {
    if (payment.status === "REFUNDED") {
      continue;
    }

    for (const refund of payment.refunds ?? []) {
      const refundCents = toCents(Number(refund.amount));

      if (refund.status === "PENDING" || refund.status === "PROCESSING") {
        refundPendingCents += refundCents;

        continue;
      }

      if (refund.status === "COMPLETED") {
        completedRefundCents += refundCents;
      }
    }
  }

  // ─────────────────────────────────────────────
  // REFUNDED
  //
  // Total efectivamente devuelto.
  //
  // Incluye:
  // - sistema antiguo
  // - Refund COMPLETED
  // ─────────────────────────────────────────────

  const refundedCents = legacyRefundedCents + completedRefundCents;

  // ─────────────────────────────────────────────
  // NET PAID
  //
  // Dinero que efectivamente permanece recibido
  // después de devoluciones completadas.
  //
  // Los Refund PENDING todavía no se restan aquí
  // porque el dinero aún no salió realmente.
  // ─────────────────────────────────────────────

  const netPaidCents = Math.max(grossPaidCents - refundedCents, 0);

  // ─────────────────────────────────────────────
  // BALANCE
  // ─────────────────────────────────────────────

  const balanceCents = Math.max(totalCents - netPaidCents, 0);

  // ─────────────────────────────────────────────
  // INITIAL PAYMENT
  // ─────────────────────────────────────────────

  const requiredInitialPaymentCents = getRequiredInitialPaymentCents(
    totalCents,
    paymentOption,
  );

  const initialPaymentRemainingCents =
    requiredInitialPaymentCents === null
      ? null
      : Math.max(requiredInitialPaymentCents - netPaidCents, 0);

  const initialPaymentSatisfied =
    requiredInitialPaymentCents === null
      ? true
      : netPaidCents >= requiredInitialPaymentCents;

  const balanceDueAt =
    isDepositPaymentOption(paymentOption) &&
    initialPaymentSatisfied &&
    balanceCents > 0
      ? "CHECK_IN"
      : null;

  return {
    total: fromCents(totalCents),

    /*
     * Compatibilidad con las APIs actuales.
     *
     * paid ahora representa el dinero neto
     * efectivamente retenido después de
     * reembolsos completados.
     */
    paid: fromCents(netPaidCents),

    grossPaid: fromCents(grossPaidCents),

    pending: fromCents(pendingCents),

    refundPending: fromCents(refundPendingCents),

    refunded: fromCents(refundedCents),

    netPaid: fromCents(netPaidCents),

    balance: fromCents(balanceCents),

    isPaid: balanceCents === 0,

    paymentOption,

    requiredInitialPayment:
      requiredInitialPaymentCents === null
        ? null
        : fromCents(requiredInitialPaymentCents),

    initialPaymentRemaining:
      initialPaymentRemainingCents === null
        ? null
        : fromCents(initialPaymentRemainingCents),

    initialPaymentSatisfied,

    balanceDueAt,
  };
}
