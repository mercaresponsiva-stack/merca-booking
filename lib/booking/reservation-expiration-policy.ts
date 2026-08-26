import { toCents } from "@/lib/booking/money";

import type { ReservationStatus } from "@/lib/booking/reservation-state";

type ReservationExpirationTimestamp =
  | Date
  | string;

type ReservationExpirationPaymentOption =
  | "FULL"
  | "DEPOSIT_50"
  | null;

type ReservationExpirationPaymentSummary = {
  pending: number;

  refundPending: number;

  netPaid: number;

  initialPaymentSatisfied: boolean;
};

type ValidateReservationForExpirationInput = {
  status: ReservationStatus;

  expiresAt:
    | ReservationExpirationTimestamp
    | null;

  requestedAt:
    ReservationExpirationTimestamp;

  paymentOption:
    ReservationExpirationPaymentOption;

  paymentSummary:
    ReservationExpirationPaymentSummary;
};

function getValidExpirationTimestamp(
  value: ReservationExpirationTimestamp,
) {
  const timestamp =
    value instanceof Date
      ? value.getTime()
      : new Date(
          value,
        ).getTime();

  if (
    !Number.isFinite(
      timestamp,
    )
  ) {
    throw new Error(
      "INVALID_EXPIRATION_TIMESTAMP",
    );
  }

  return timestamp;
}

/*
 * Validates whether a pending reservation can
 * leave active inventory through expiration.
 *
 * Expiration never resolves money automatically:
 *
 * - pending payments must be resolved first
 * - pending refunds must be resolved first
 * - retained customer funds require manual action
 * - a satisfied modern payment contract protects
 *   the reservation from automatic expiration
 *
 * Legacy reservations without a payment option can
 * expire only when no unresolved money remains.
 */
export function validateReservationForExpiration({
  status,

  expiresAt,

  requestedAt,

  paymentOption,

  paymentSummary,
}: ValidateReservationForExpirationInput) {
  if (
    status !==
    "PENDING"
  ) {
    throw new Error(
      "RESERVATION_NOT_ELIGIBLE_FOR_EXPIRATION",
    );
  }

  if (
    expiresAt ===
    null
  ) {
    throw new Error(
      "RESERVATION_EXPIRATION_NOT_CONFIGURED",
    );
  }

  const expiresAtTimestamp =
    getValidExpirationTimestamp(
      expiresAt,
    );

  const requestedAtTimestamp =
    getValidExpirationTimestamp(
      requestedAt,
    );

  if (
    requestedAtTimestamp <
    expiresAtTimestamp
  ) {
    throw new Error(
      "RESERVATION_EXPIRATION_NOT_DUE",
    );
  }

  const pendingPaymentCents =
    toCents(
      paymentSummary.pending,
    );

  if (
    pendingPaymentCents >
    0
  ) {
    throw new Error(
      "PENDING_PAYMENTS_MUST_BE_RESOLVED_FOR_EXPIRATION",
    );
  }

  const refundPendingCents =
    toCents(
      paymentSummary.refundPending,
    );

  if (
    refundPendingCents >
    0
  ) {
    throw new Error(
      "REFUNDS_MUST_BE_RESOLVED_FOR_EXPIRATION",
    );
  }

  const paymentContract =
    paymentOption ===
    null
      ? "LEGACY"
      : "CONFIGURED";

  if (
    paymentContract ===
      "CONFIGURED" &&
    paymentSummary
      .initialPaymentSatisfied
  ) {
    throw new Error(
      "RESERVATION_PAYMENT_PROTECTS_FROM_EXPIRATION",
    );
  }

  const netPaidCents =
    toCents(
      paymentSummary.netPaid,
    );

  if (
    netPaidCents >
    0
  ) {
    throw new Error(
      "PAYMENTS_MUST_BE_RESOLVED_FOR_EXPIRATION",
    );
  }

  return {
    currentStatus:
      status,

    nextStatus:
      "EXPIRED" as const,

    expiresAt:
      new Date(
        expiresAtTimestamp,
      ),

    expiredAt:
      new Date(
        requestedAtTimestamp,
      ),

    paymentContract,
  };
}
