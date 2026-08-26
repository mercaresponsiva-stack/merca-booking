const MILLISECONDS_PER_MINUTE =
  60_000;

type CalculatePendingReservationExpiresAtInput = {
  createdAt: Date;

  holdMinutes: number;
};

/*
 * Calculates the deadline of a newly-created
 * pending reservation from one server-owned
 * creation timestamp.
 */
export function calculatePendingReservationExpiresAt({
  createdAt,

  holdMinutes,
}: CalculatePendingReservationExpiresAtInput) {
  const createdAtTimestamp =
    createdAt.getTime();

  if (
    !Number.isFinite(
      createdAtTimestamp,
    )
  ) {
    throw new Error(
      "INVALID_PENDING_RESERVATION_CREATION_TIMESTAMP",
    );
  }

  if (
    !Number.isSafeInteger(
      holdMinutes,
    ) ||
    holdMinutes <=
      0
  ) {
    throw new Error(
      "INVALID_PENDING_RESERVATION_HOLD_MINUTES",
    );
  }

  const expiresAt =
    new Date(
      createdAtTimestamp +
        holdMinutes *
          MILLISECONDS_PER_MINUTE,
    );

  if (
    !Number.isFinite(
      expiresAt.getTime(),
    ) ||
    expiresAt.getTime() <=
      createdAtTimestamp
  ) {
    throw new Error(
      "INVALID_PENDING_RESERVATION_EXPIRATION_TIMESTAMP",
    );
  }

  return expiresAt;
}

type PendingReservationPaymentWindowTimestamp =
  | Date
  | string;

type ValidatePendingReservationPaymentWindowInput = {
  status:
    string;

  expiresAt:
    | PendingReservationPaymentWindowTimestamp
    | null;

  requestedAt:
    PendingReservationPaymentWindowTimestamp;
};

function getPendingReservationPaymentWindowTimestamp(
  value:
    PendingReservationPaymentWindowTimestamp,
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
      "INVALID_PENDING_RESERVATION_EXPIRATION_TIMESTAMP",
    );
  }

  return timestamp;
}

/*
 * Prevents new payment attempts after a pending
 * reservation has reached its expiration deadline.
 *
 * Existing pending payments are resolved through
 * their own route and are intentionally unaffected.
 */
export function validatePendingReservationPaymentWindow({
  status,

  expiresAt,

  requestedAt,
}: ValidatePendingReservationPaymentWindowInput) {
  if (
    status !==
    "PENDING"
  ) {
    return {
      enforced:
        false,

      expiresAt:
        null,
    };
  }

  if (
    expiresAt ===
    null
  ) {
    throw new Error(
      "PENDING_RESERVATION_EXPIRATION_NOT_CONFIGURED",
    );
  }

  const expiresAtTimestamp =
    getPendingReservationPaymentWindowTimestamp(
      expiresAt,
    );

  const requestedAtTimestamp =
    getPendingReservationPaymentWindowTimestamp(
      requestedAt,
    );

  if (
    requestedAtTimestamp >=
    expiresAtTimestamp
  ) {
    throw new Error(
      "PENDING_RESERVATION_PAYMENT_WINDOW_EXPIRED",
    );
  }

  return {
    enforced:
      true,

    expiresAt:
      new Date(
        expiresAtTimestamp,
      ),
  };
}
