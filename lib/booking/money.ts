export function toCents(amount: number) {
  return Math.round(amount * 100);
}

export function fromCents(cents: number) {
  return cents / 100;
}

export function calculatePercentageCents(
  totalCents: number,
  percentage: number,
) {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) {
    throw new Error("INVALID_MONEY_CENTS");
  }

  if (
    !Number.isInteger(percentage) ||
    percentage < 1 ||
    percentage > 100
  ) {
    throw new Error("INVALID_PAYMENT_PERCENTAGE");
  }

  const weightedCents = totalCents * percentage;

  if (!Number.isSafeInteger(weightedCents)) {
    throw new Error("MONEY_CALCULATION_OVERFLOW");
  }

  const calculatedCents = Math.round(weightedCents / 100);

  /*
   * Cualquier porcentaje positivo sobre un total
   * positivo exige al menos un centavo.
   */
  return totalCents > 0 ? Math.max(calculatedCents, 1) : 0;
}

export function calculateHalfCents(totalCents: number) {
  return calculatePercentageCents(totalCents, 50);
}
