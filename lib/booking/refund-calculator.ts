import { fromCents, toCents } from "@/lib/booking/money";

export const REFUND_YEAR_DAYS = 365;

export type RefundCalculationBasis =
  | "RETRACTO"
  | "DESISTIMIENTO"
  | "PROVIDER_CANCELLATION"
  | "PRICE_ADJUSTMENT"
  | "MANUAL";

type CalculateRefundInput = {
  baseAmount: number;

  basis: RefundCalculationBasis;

  /*
   * Días desde la celebración del contrato
   * hasta la solicitud de cancelación.
   *
   * Determina la ventana de retracto.
   */
  contractElapsedDays: number;

  /*
   * Días desde este pago concreto
   * hasta la solicitud de cancelación.
   *
   * Determina la retención administrativa.
   */
  paymentElapsedDays: number;

  fullRefundDays: number;

  annualAdministrativeRate: number;

  administrativeRetention?: number;
};

export type RefundCalculation = {
  basis: RefundCalculationBasis;

  baseAmount: number;

  contractElapsedDays: number;

  paymentElapsedDays: number;

  fullRefundDays: number;

  annualAdministrativeRate: number;

  maxAdministrativeRetention: number;

  administrativeRetention: number;

  refundAmount: number;

  isFullRefund: boolean;
};

export function calculateRefund({
  baseAmount,
  basis,
  contractElapsedDays,
  paymentElapsedDays,
  fullRefundDays,
  annualAdministrativeRate,
  administrativeRetention,
}: CalculateRefundInput): RefundCalculation {
  validateRefundInput({
    baseAmount,
    contractElapsedDays,
    paymentElapsedDays,
    fullRefundDays,
    annualAdministrativeRate,
  });

  const baseCents = toCents(baseAmount);

  // ─────────────────────────────────────────────
  // FULL REFUNDS
  // ─────────────────────────────────────────────

  if (
    basis === "RETRACTO" ||
    basis === "PROVIDER_CANCELLATION" ||
    basis === "PRICE_ADJUSTMENT"
  ) {
    return {
      basis,

      baseAmount: fromCents(baseCents),

      contractElapsedDays,
      paymentElapsedDays,

      fullRefundDays,

      annualAdministrativeRate,

      maxAdministrativeRetention: 0,

      administrativeRetention: 0,

      refundAmount: fromCents(baseCents),

      isFullRefund: true,
    };
  }

  // ─────────────────────────────────────────────
  // DESISTIMIENTO
  //
  // La clasificación depende del tiempo
  // transcurrido desde la contratación.
  //
  // El cálculo económico depende del tiempo
  // transcurrido desde cada pago.
  // ─────────────────────────────────────────────

  if (basis === "DESISTIMIENTO") {
    const maxAdministrativeRetentionCents = Math.round(
      baseCents *
        annualAdministrativeRate *
        (paymentElapsedDays / REFUND_YEAR_DAYS),
    );

    const requestedRetentionCents =
      administrativeRetention === undefined
        ? maxAdministrativeRetentionCents
        : toCents(administrativeRetention);

    if (requestedRetentionCents < 0) {
      throw new Error("INVALID_ADMINISTRATIVE_RETENTION");
    }

    if (requestedRetentionCents > maxAdministrativeRetentionCents) {
      throw new Error("ADMINISTRATIVE_RETENTION_EXCEEDS_MAXIMUM");
    }

    const appliedRetentionCents = Math.min(requestedRetentionCents, baseCents);

    const refundCents = Math.max(baseCents - appliedRetentionCents, 0);

    return {
      basis,

      baseAmount: fromCents(baseCents),

      contractElapsedDays,
      paymentElapsedDays,

      fullRefundDays,

      annualAdministrativeRate,

      maxAdministrativeRetention: fromCents(maxAdministrativeRetentionCents),

      administrativeRetention: fromCents(appliedRetentionCents),

      refundAmount: fromCents(refundCents),

      isFullRefund: refundCents === baseCents,
    };
  }

  // ─────────────────────────────────────────────
  // MANUAL
  // ─────────────────────────────────────────────

  if (administrativeRetention === undefined) {
    throw new Error("MANUAL_REFUND_RETENTION_REQUIRED");
  }

  const administrativeRetentionCents = toCents(administrativeRetention);

  if (
    administrativeRetentionCents < 0 ||
    administrativeRetentionCents > baseCents
  ) {
    throw new Error("INVALID_ADMINISTRATIVE_RETENTION");
  }

  const refundCents = baseCents - administrativeRetentionCents;

  return {
    basis,

    baseAmount: fromCents(baseCents),

    contractElapsedDays,
    paymentElapsedDays,

    fullRefundDays,

    annualAdministrativeRate,

    maxAdministrativeRetention: 0,

    administrativeRetention: fromCents(administrativeRetentionCents),

    refundAmount: fromCents(refundCents),

    isFullRefund: refundCents === baseCents,
  };
}

function validateRefundInput({
  baseAmount,
  contractElapsedDays,
  paymentElapsedDays,
  fullRefundDays,
  annualAdministrativeRate,
}: {
  baseAmount: number;
  contractElapsedDays: number;
  paymentElapsedDays: number;
  fullRefundDays: number;
  annualAdministrativeRate: number;
}) {
  if (!Number.isFinite(baseAmount) || baseAmount < 0) {
    throw new Error("INVALID_REFUND_BASE_AMOUNT");
  }

  if (!Number.isInteger(contractElapsedDays) || contractElapsedDays < 0) {
    throw new Error("INVALID_CONTRACT_ELAPSED_DAYS");
  }

  if (!Number.isInteger(paymentElapsedDays) || paymentElapsedDays < 0) {
    throw new Error("INVALID_PAYMENT_ELAPSED_DAYS");
  }

  if (!Number.isInteger(fullRefundDays) || fullRefundDays < 0) {
    throw new Error("INVALID_FULL_REFUND_DAYS");
  }

  if (
    !Number.isFinite(annualAdministrativeRate) ||
    annualAdministrativeRate < 0 ||
    annualAdministrativeRate > 1
  ) {
    throw new Error("INVALID_ANNUAL_ADMINISTRATIVE_RATE");
  }
}
