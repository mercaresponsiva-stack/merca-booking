import { fromCents, toCents } from "@/lib/booking/money";

const REFUND_PRINCIPAL_RESERVED_STATUSES = new Set([
  "PENDING",
  "PROCESSING",
  "COMPLETED",
]);

export type PaymentForRefundAllocation = {
  id: string;

  amount: unknown;

  status: string;

  paidAt: Date | null;

  refunds?: Array<{
    baseAmount: unknown;
    status: string;
  }>;
};

type AllocateRefundInput = {
  amount: number;

  payments: PaymentForRefundAllocation[];
};

export type RefundAllocation = {
  paymentId: string;

  /*
   * Para PRICE_ADJUSTMENT:
   *
   * baseAmount === amount
   *
   * porque no existe retención.
   */
  baseAmount: number;

  amount: number;
};

export function allocateRefundAcrossPayments({
  amount,
  payments,
}: AllocateRefundInput) {
  const requestedCents = toCents(amount);

  if (requestedCents < 0) {
    throw new Error("INVALID_REFUND_ALLOCATION_AMOUNT");
  }

  if (requestedCents === 0) {
    return {
      requestedAmount: 0,

      allocatedAmount: 0,

      allocations: [] as RefundAllocation[],
    };
  }

  /*
   * Los Payment históricos REFUNDED
   * no pueden recibir Refund nuevos.
   *
   * Desde el nuevo modelo solamente
   * trabajamos con Payment.status = PAID.
   */
  const refundablePayments = payments
    .filter((payment) => payment.status === "PAID")
    .map((payment) => {
      if (!payment.paidAt) {
        throw new Error("PAID_PAYMENT_WITHOUT_PAID_AT");
      }

      const paymentCents = toCents(Number(payment.amount));

      if (paymentCents < 0) {
        throw new Error("INVALID_PAYMENT_AMOUNT");
      }

      /*
       * baseAmount, no Refund.amount.
       *
       * Si una parte del principal ya
       * fue utilizada como base de una
       * devolución, no puede volver a
       * utilizarse posteriormente.
       */
      const reservedPrincipalCents = (payment.refunds ?? [])
        .filter((refund) =>
          REFUND_PRINCIPAL_RESERVED_STATUSES.has(refund.status),
        )
        .reduce(
          (sum, refund) => sum + toCents(Number(refund.baseAmount)),

          0,
        );

      const availablePrincipalCents = Math.max(
        paymentCents - reservedPrincipalCents,

        0,
      );

      return {
        id: payment.id,

        paidAt: payment.paidAt,

        availablePrincipalCents,
      };
    })
    /*
     * LIFO financiero:
     * pago más reciente primero.
     */
    .sort((a, b) => b.paidAt.getTime() - a.paidAt.getTime());

  let remainingCents = requestedCents;

  const allocations: RefundAllocation[] = [];

  for (const payment of refundablePayments) {
    if (remainingCents <= 0) {
      break;
    }

    if (payment.availablePrincipalCents <= 0) {
      continue;
    }

    const allocationCents = Math.min(
      remainingCents,

      payment.availablePrincipalCents,
    );

    allocations.push({
      paymentId: payment.id,

      baseAmount: fromCents(allocationCents),

      amount: fromCents(allocationCents),
    });

    remainingCents -= allocationCents;
  }

  /*
   * Nunca generamos una devolución
   * parcialmente respaldada.
   *
   * Si el estado financiero indica
   * $60 de sobrepago pero solamente
   * encontramos $40 de principal
   * reembolsable, hay una inconsistencia
   * que debe investigarse.
   */
  if (remainingCents > 0) {
    throw new Error("INSUFFICIENT_REFUNDABLE_PAYMENT_PRINCIPAL");
  }

  return {
    requestedAmount: fromCents(requestedCents),

    allocatedAmount: fromCents(requestedCents - remainingCents),

    allocations,
  };
}
