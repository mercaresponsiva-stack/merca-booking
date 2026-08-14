export const RESERVATION_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "CANCELLED",
  "NO_SHOW",
  "CHECKED_IN",
  "CHECKED_OUT",
  "COMPLETED",
] as const;

export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

// ─────────────────────────────────────────────
// ACTIVE RESERVATION STATUSES
//
// Son las reservas que todavía consumen
// disponibilidad / inventario.
// ─────────────────────────────────────────────

export const ACTIVE_RESERVATION_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "CHECKED_IN",
] as const;

// ─────────────────────────────────────────────
// RESERVATION TRANSITIONS
// ─────────────────────────────────────────────

const RESERVATION_TRANSITIONS: Record<
  ReservationStatus,
  readonly ReservationStatus[]
> = {
  PENDING: ["CONFIRMED", "CANCELLED"],

  CONFIRMED: ["CHECKED_IN", "CANCELLED", "NO_SHOW"],

  CHECKED_IN: ["CHECKED_OUT"],

  CHECKED_OUT: ["COMPLETED"],

  CANCELLED: [],
  NO_SHOW: [],
  COMPLETED: [],
};

// ─────────────────────────────────────────────
// VALID STATUS
// ─────────────────────────────────────────────

export function isReservationStatus(
  value: unknown,
): value is ReservationStatus {
  return (
    typeof value === "string" &&
    RESERVATION_STATUSES.includes(value as ReservationStatus)
  );
}

// ─────────────────────────────────────────────
// VALID TRANSITION
// ─────────────────────────────────────────────

export function isReservationTransitionAllowed(
  currentStatus: ReservationStatus,
  targetStatus: ReservationStatus,
) {
  return RESERVATION_TRANSITIONS[currentStatus].includes(targetStatus);
}

// ─────────────────────────────────────────────
// ACTIVE RESERVATION
//
// PENDING
// CONFIRMED
// CHECKED_IN
//
// siguen consumiendo inventario.
// ─────────────────────────────────────────────

export function isReservationActive(status: ReservationStatus) {
  return ACTIVE_RESERVATION_STATUSES.includes(
    status as (typeof ACTIVE_RESERVATION_STATUSES)[number],
  );
}

// ─────────────────────────────────────────────
// PAYABLE RESERVATION
//
// Actualmente coincide con "active":
//
// PENDING     → sí
// CONFIRMED   → sí
// CHECKED_IN  → sí
//
// CANCELLED   → no
// NO_SHOW     → no
// CHECKED_OUT → no
// COMPLETED   → no
// ─────────────────────────────────────────────

export function isReservationPayable(status: ReservationStatus) {
  return isReservationActive(status);
}
