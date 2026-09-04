import { calculatePercentageCents } from "@/lib/booking/money";

export const PAYMENT_OPTIONS = [
  "DEPOSIT_10",
  "DEPOSIT_25",
  "DEPOSIT_50",
  "FULL",
] as const;

export type PaymentOption =
  (typeof PAYMENT_OPTIONS)[number];

export type PaymentOptionValue =
  | PaymentOption
  | null;

export const DEFAULT_ENABLED_PAYMENT_OPTIONS = [
  "DEPOSIT_50",
  "FULL",
] as const satisfies readonly PaymentOption[];

const PAYMENT_OPTION_PERCENTAGES = {
  DEPOSIT_10: 10,
  DEPOSIT_25: 25,
  DEPOSIT_50: 50,
  FULL: 100,
} as const satisfies Record<PaymentOption, number>;

const PAYMENT_OPTION_LABELS = {
  DEPOSIT_10: "Anticipo 10 %",
  DEPOSIT_25: "Anticipo 25 %",
  DEPOSIT_50: "Anticipo 50 %",
  FULL: "Pago completo",
} as const satisfies Record<PaymentOption, string>;

export function isPaymentOption(
  value: unknown,
): value is PaymentOption {
  return (
    typeof value === "string" &&
    PAYMENT_OPTIONS.some(
      (paymentOption) => paymentOption === value,
    )
  );
}

export function isDepositPaymentOption(
  paymentOption: PaymentOptionValue,
): paymentOption is Exclude<PaymentOption, "FULL"> {
  return paymentOption !== null && paymentOption !== "FULL";
}

export function getPaymentOptionPercentage(
  paymentOption: PaymentOptionValue,
) {
  return paymentOption === null
    ? null
    : PAYMENT_OPTION_PERCENTAGES[paymentOption];
}

export function getPaymentOptionLabel(
  paymentOption: PaymentOptionValue,
) {
  return paymentOption === null
    ? "Histórica"
    : PAYMENT_OPTION_LABELS[paymentOption];
}

export function getRequiredInitialPaymentCents(
  totalCents: number,
  paymentOption: PaymentOptionValue,
) {
  const percentage =
    getPaymentOptionPercentage(paymentOption);

  return percentage === null
    ? null
    : calculatePercentageCents(totalCents, percentage);
}