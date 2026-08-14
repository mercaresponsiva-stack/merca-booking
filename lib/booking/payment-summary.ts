import { calculateHalfCents, fromCents, toCents } from "@/lib/booking/money";

export type PaymentOptionValue = "FULL" | "DEPOSIT_50" | null;

type PaymentForSummary = {
  amount: unknown;
  status: string;
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
   * Reservas históricas creadas antes
   * de introducir PaymentOption.
   */
  return null;
}

export function calculatePaymentSummary({
  total,
  paymentOption,
  payments,
}: CalculatePaymentSummaryInput) {
  const totalCents = toCents(total);

  const paidCents = payments
    .filter((payment) => payment.status === "PAID")
    .reduce((sum, payment) => sum + toCents(Number(payment.amount)), 0);

  const pendingCents = payments
    .filter((payment) => payment.status === "PENDING")
    .reduce((sum, payment) => sum + toCents(Number(payment.amount)), 0);

  const refundedCents = payments
    .filter((payment) => payment.status === "REFUNDED")
    .reduce((sum, payment) => sum + toCents(Number(payment.amount)), 0);

  const balanceCents = Math.max(totalCents - paidCents, 0);

  const requiredInitialPaymentCents = getRequiredInitialPaymentCents(
    totalCents,
    paymentOption,
  );

  const initialPaymentRemainingCents =
    requiredInitialPaymentCents === null
      ? null
      : Math.max(requiredInitialPaymentCents - paidCents, 0);

  const initialPaymentSatisfied =
    requiredInitialPaymentCents === null
      ? true
      : paidCents >= requiredInitialPaymentCents;

  const balanceDueAt =
    paymentOption === "DEPOSIT_50" &&
    initialPaymentSatisfied &&
    balanceCents > 0
      ? "CHECK_IN"
      : null;

  return {
    total: fromCents(totalCents),

    paid: fromCents(paidCents),

    pending: fromCents(pendingCents),

    refunded: fromCents(refundedCents),

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
