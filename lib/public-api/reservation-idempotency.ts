import "server-only";

import {
  createHmac,
  timingSafeEqual,
} from "crypto";

const MINIMUM_IDEMPOTENCY_SECRET_LENGTH =
  32;

export class PublicReservationIdempotencyConfigurationError
  extends Error {
  constructor() {
    super(
      "PUBLIC_RESERVATION_IDEMPOTENCY_NOT_CONFIGURED",
    );

    this.name =
      "PublicReservationIdempotencyConfigurationError";
  }
}

function getIdempotencySecret() {
  const secret =
    process.env
      .PUBLIC_API_IDEMPOTENCY_SECRET;

  if (
    !secret ||
    secret.length <
      MINIMUM_IDEMPOTENCY_SECRET_LENGTH
  ) {
    throw new PublicReservationIdempotencyConfigurationError();
  }

  return secret;
}

export function createPublicReservationFingerprint(
  payload: unknown,
) {
  const serialized =
    JSON.stringify(
      payload,
    );

  if (
    serialized ===
      undefined
  ) {
    throw new Error(
      "PUBLIC_RESERVATION_FINGERPRINT_PAYLOAD_INVALID",
    );
  }

  return createHmac(
    "sha256",
    getIdempotencySecret(),
  )
    .update(
      serialized,
      "utf8",
    )
    .digest(
      "hex",
    );
}

export function publicReservationFingerprintsMatch(
  first: string,
  second: string,
) {
  const firstBuffer =
    Buffer.from(
      first,
      "utf8",
    );

  const secondBuffer =
    Buffer.from(
      second,
      "utf8",
    );

  return (
    firstBuffer.length ===
      secondBuffer.length &&
    timingSafeEqual(
      firstBuffer,
      secondBuffer,
    )
  );
}
