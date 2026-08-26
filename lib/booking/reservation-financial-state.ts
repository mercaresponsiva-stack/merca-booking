import { fromCents, toCents } from "@/lib/booking/money";

import {
  isReservationPayable,
  type ReservationStatus,
} from "@/lib/booking/reservation-state";

type PaymentSummaryForFinancialState = {
  total: number;

  balance: number;

  grossPaid: number;

  refundPending: number;

  refunded: number;

  netPaid: number;
};

type CalculateReservationFinancialStateInput = {
  status: ReservationStatus;

  paymentSummary: PaymentSummaryForFinancialState;
};

export function calculateReservationFinancialState({
  status,
  paymentSummary,
}: CalculateReservationFinancialStateInput) {
  const contractualBalanceCents = toCents(paymentSummary.balance);

  /*
   * Una reserva CANCELLED conserva su
   * historial económico, pero ya no existe
   * un saldo exigible por la estancia.
   */
  /*
   * EXPIRED follows the same non-collectible
   * balance rule without being a cancellation.
   */
  const amountDueCents =
    status ===
      "CANCELLED" ||
    status ===
      "EXPIRED"
      ? 0
      : contractualBalanceCents;

  const paymentAcceptanceAllowedByStatus = isReservationPayable(status);

  const canAcceptPayment =
    paymentAcceptanceAllowedByStatus && amountDueCents > 0;

  return {
    /*
     * Diferencia puramente financiera:
     *
     * total contractual - netPaid.
     *
     * Se conserva incluso después de cancelar
     * para auditoría.
     */
    contractualBalance: fromCents(contractualBalanceCents),

    /*
     * Lo que realmente puede exigirse
     * actualmente al cliente.
     */
    amountDue: fromCents(amountDueCents),

    paymentAcceptanceAllowedByStatus,

    canAcceptPayment,

    hasRefundPending: toCents(paymentSummary.refundPending) > 0,

    isCancelled: status === "CANCELLED",
  };
}
