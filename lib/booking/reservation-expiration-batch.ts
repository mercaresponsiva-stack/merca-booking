import {
  expirePendingReservation,
} from "@/lib/booking/reservation-expiration-operation";

import {
  prisma,
} from "@/lib/prisma";

const DEFAULT_EXPIRATION_BATCH_LIMIT =
  100;

const MAX_EXPIRATION_BATCH_LIMIT =
  500;

const SKIPPABLE_EXPIRATION_CODES =
  new Set<string>([
    "RESERVATION_NOT_FOUND",
    "RESERVATION_NOT_ELIGIBLE_FOR_EXPIRATION",
    "RESERVATION_EXPIRATION_NOT_CONFIGURED",
    "INVALID_EXPIRATION_TIMESTAMP",
    "RESERVATION_EXPIRATION_NOT_DUE",
    "PENDING_PAYMENTS_MUST_BE_RESOLVED_FOR_EXPIRATION",
    "REFUNDS_MUST_BE_RESOLVED_FOR_EXPIRATION",
    "RESERVATION_PAYMENT_PROTECTS_FROM_EXPIRATION",
    "PAYMENTS_MUST_BE_RESOLVED_FOR_EXPIRATION",
  ]);

type ExpireDuePendingReservationsInput = {
  requestedAt:
    Date;

  limit?:
    number;
};

function validateBatchTimestamp(
  requestedAt:
    Date,
) {
  if (
    !(
      requestedAt instanceof
        Date
    ) ||
    !Number.isFinite(
      requestedAt.getTime(),
    )
  ) {
    throw new Error(
      "INVALID_EXPIRATION_BATCH_TIMESTAMP",
    );
  }
}

function validateBatchLimit(
  limit:
    number,
) {
  if (
    !Number.isSafeInteger(
      limit,
    ) ||
    limit <
      1 ||
    limit >
      MAX_EXPIRATION_BATCH_LIMIT
  ) {
    throw new Error(
      "INVALID_EXPIRATION_BATCH_LIMIT",
    );
  }
}

function getErrorCode(
  error:
    unknown,
) {
  return error instanceof
    Error
    ? error.message
    : null;
}

function isSerializationConflict(
  error:
    unknown,
) {
  return (
    typeof error ===
      "object" &&
    error !==
      null &&
    "code" in
      error &&
    error.code ===
      "P2034"
  );
}

/*
 * Procesa reservas PENDING cuyo expiresAt
 * ya fue alcanzado.
 *
 * Cada reserva usa su propia transacción
 * Serializable. Así, el fallo o protección
 * financiera de una reserva no revierte las
 * demás.
 *
 * Las operaciones son secuenciales para no
 * ejecutar consultas concurrentes sobre un
 * mismo cliente pg.
 */
export async function expireDuePendingReservations({
  requestedAt,

  limit =
    DEFAULT_EXPIRATION_BATCH_LIMIT,
}: ExpireDuePendingReservationsInput) {
  validateBatchTimestamp(
    requestedAt,
  );

  validateBatchLimit(
    limit,
  );

  /*
   * Solicitamos un elemento adicional para
   * informar si todavía quedan candidatos.
   */
  const discoveredCandidates =
    await prisma.reservation.findMany({
      where: {
        status:
          "PENDING",

        expiresAt: {
          lte:
            requestedAt,
        },
      },

      select: {
        id:
          true,

        confirmationCode:
          true,

        expiresAt:
          true,
      },

      orderBy: [
        {
          expiresAt:
            "asc",
        },

        {
          id:
            "asc",
        },
      ],

      take:
        limit +
        1,
    });

  const hasMoreDueReservations =
    discoveredCandidates.length >
    limit;

  const candidates =
    discoveredCandidates.slice(
      0,
      limit,
    );

  const expired: Array<{
    reservationId:
      string;

    confirmationCode:
      string;

    expiresAt:
      Date;

    expiredAt:
      Date;

    changeId:
      string;
  }> = [];

  const skipped: Array<{
    reservationId:
      string;

    confirmationCode:
      string;

    code:
      string;
  }> = [];

  const failed: Array<{
    reservationId:
      string;

    confirmationCode:
      string;

    code:
      string;

    error:
      string;
  }> = [];

  for (
    const candidate of
    candidates
  ) {
    if (
      !candidate.expiresAt
    ) {
      skipped.push({
        reservationId:
          candidate.id,

        confirmationCode:
          candidate.confirmationCode,

        code:
          "RESERVATION_EXPIRATION_NOT_CONFIGURED",
      });

      continue;
    }

    try {
      const result =
        await prisma.$transaction(
          async (
            tx,
          ) =>
            expirePendingReservation({
              reservationId:
                candidate.id,

              requestedAt,

              db:
                tx,
            }),

          {
            isolationLevel:
              "Serializable",
          },
        );

      expired.push({
        reservationId:
          result.reservation.id,

        confirmationCode:
          result.reservation
            .confirmationCode,

        expiresAt:
          result.expiration.expiresAt,

        expiredAt:
          result.expiration.expiredAt,

        changeId:
          result.change.id,
      });
    } catch (
      error
    ) {
      const errorCode =
        getErrorCode(
          error,
        );

      if (
        errorCode &&
        SKIPPABLE_EXPIRATION_CODES.has(
          errorCode,
        )
      ) {
        skipped.push({
          reservationId:
            candidate.id,

          confirmationCode:
            candidate.confirmationCode,

          code:
            errorCode,
        });

        continue;
      }

      if (
        isSerializationConflict(
          error,
        )
      ) {
        skipped.push({
          reservationId:
            candidate.id,

          confirmationCode:
            candidate.confirmationCode,

          code:
            "EXPIRATION_SERIALIZATION_CONFLICT",
        });

        continue;
      }

      failed.push({
        reservationId:
          candidate.id,

        confirmationCode:
          candidate.confirmationCode,

        code:
          "EXPIRATION_BATCH_ITEM_FAILED",

        error:
          error instanceof
            Error
            ? error.message
            : "UNKNOWN_EXPIRATION_BATCH_ERROR",
      });
    }
  }

  return {
    requestedAt,

    completedAt:
      new Date(),

    limit,

    discoveredCount:
      candidates.length,

    hasMoreDueReservations,

    expiredCount:
      expired.length,

    skippedCount:
      skipped.length,

    failedCount:
      failed.length,

    expired,

    skipped,

    failed,
  };
}