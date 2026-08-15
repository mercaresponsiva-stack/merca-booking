import { calculateHalfCents, fromCents, toCents } from "@/lib/booking/money";

export type PaymentOptionValue = "FULL" | "DEPOSIT_50" | null;

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

export function getRequiredInitialPaymentCents(
  totalCents: number,
  paymentOption: PaymentOptionValue,
) {
  if (paymentOption === "FULL") {
    return totalCents;
  }

  if (paymentOption === "DEPOSIT_50") {
    return calculateHalfCents(totalCents);
  }

  /*
   * Reservas históricas anteriores
   * a PaymentOption.
   */
  return null;
}

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
    paymentOption === "DEPOSIT_50" &&
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
