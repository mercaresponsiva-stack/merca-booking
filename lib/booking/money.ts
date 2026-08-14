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
  return Math.round(totalCents * percentage);
}

export function calculateHalfCents(totalCents: number) {
  return Math.round(totalCents / 2);
}
