import {
  timingSafeEqual,
} from "node:crypto";

import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  expireDuePendingReservations,
} from "@/lib/booking/reservation-expiration-batch";

export const dynamic =
  "force-dynamic";

export const runtime =
  "nodejs";

export const maxDuration =
  300;

const DEFAULT_EXPIRATION_BATCH_LIMIT =
  100;

const MINIMUM_CRON_SECRET_LENGTH =
  16;

function jsonResponse({
  status,

  body,
}: {
  status:
    number;

  body:
    Record<
      string,
      unknown
    >;
}) {
  return NextResponse.json(
    body,
    {
      status,

      headers: {
        "Cache-Control":
          "no-store, max-age=0",

        "X-Robots-Tag":
          "noindex",
      },
    },
  );
}

function errorResponse(
  status:
    number,

  code:
    string,

  error:
    string,
) {
  return jsonResponse({
    status,

    body: {
      success:
        false,

      code,

      error,
    },
  });
}

function resolveCronSecret() {
  const cronSecret =
    process.env
      .CRON_SECRET
      ?.trim();

  if (
    !cronSecret
  ) {
    throw new Error(
      "CRON_SECRET_NOT_CONFIGURED",
    );
  }

  if (
    cronSecret.length <
    MINIMUM_CRON_SECRET_LENGTH
  ) {
    throw new Error(
      "CRON_SECRET_NOT_SECURE",
    );
  }

  return cronSecret;
}

function resolveBatchLimit() {
  const configuredLimit =
    process.env
      .RESERVATION_EXPIRATION_BATCH_LIMIT
      ?.trim();

  if (
    !configuredLimit
  ) {
    return DEFAULT_EXPIRATION_BATCH_LIMIT;
  }

  return Number(
    configuredLimit,
  );
}

function isAuthorizedCronRequest({
  request,

  cronSecret,
}: {
  request:
    NextRequest;

  cronSecret:
    string;
}) {
  const authorizationHeader =
    request.headers.get(
      "authorization",
    );

  if (
    !authorizationHeader
  ) {
    return false;
  }

  const expectedAuthorization =
    `Bearer ${cronSecret}`;

  const receivedBytes =
    Buffer.from(
      authorizationHeader,
      "utf8",
    );

  const expectedBytes =
    Buffer.from(
      expectedAuthorization,
      "utf8",
    );

  return (
    receivedBytes.length ===
      expectedBytes.length &&
    timingSafeEqual(
      receivedBytes,
      expectedBytes,
    )
  );
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

/*
 * Ruta interna invocada por Vercel Cron.
 *
 * La autenticación se realiza antes de
 * consultar o modificar reservas.
 *
 * CRON_SECRET nunca se devuelve ni se
 * escribe en los registros.
 */
export async function GET(
  request:
    NextRequest,
) {
  try {
    const cronSecret =
      resolveCronSecret();

    if (
      !isAuthorizedCronRequest({
        request,

        cronSecret,
      })
    ) {
      return errorResponse(
        401,
        "CRON_AUTHORIZATION_INVALID",
        "La solicitud no está autorizada para ejecutar la expiración.",
      );
    }

    const requestedAt =
      new Date();

    const result =
      await expireDuePendingReservations({
        requestedAt,

        limit:
          resolveBatchLimit(),
      });

    if (
      result.failedCount >
      0
    ) {
      console.error(
        "GET reservation expiration cron partial failure:",
        {
          requestedAt:
            result.requestedAt
              .toISOString(),

          completedAt:
            result.completedAt
              .toISOString(),

          discoveredCount:
            result.discoveredCount,

          expiredCount:
            result.expiredCount,

          skippedCount:
            result.skippedCount,

          failedCount:
            result.failedCount,

          failed:
            result.failed,
        },
      );

      return jsonResponse({
        status:
          500,

        body: {
          success:
            false,

          code:
            "RESERVATION_EXPIRATION_BATCH_PARTIAL_FAILURE",

          error:
            "La ejecución programada terminó con uno o más fallos inesperados.",

          operation:
            "EXPIRE_DUE_PENDING_RESERVATIONS",

          batch:
            result,
        },
      });
    }

    return jsonResponse({
      status:
        200,

      body: {
        success:
          true,

        operation:
          "EXPIRE_DUE_PENDING_RESERVATIONS",

        batch:
          result,
      },
    });
  } catch (
    error
  ) {
    const code =
      getErrorCode(
        error,
      );

    if (
      code ===
      "CRON_SECRET_NOT_CONFIGURED"
    ) {
      return errorResponse(
        503,
        code,
        "La ejecución programada no tiene configurado CRON_SECRET.",
      );
    }

    if (
      code ===
      "CRON_SECRET_NOT_SECURE"
    ) {
      return errorResponse(
        503,
        code,
        "CRON_SECRET debe contener al menos 16 caracteres.",
      );
    }

    if (
      code ===
      "INVALID_EXPIRATION_BATCH_LIMIT"
    ) {
      return errorResponse(
        503,
        code,
        "RESERVATION_EXPIRATION_BATCH_LIMIT no contiene un límite válido.",
      );
    }

    console.error(
      "GET reservation expiration cron error:",
      error,
    );

    return errorResponse(
      500,
      "RESERVATION_EXPIRATION_CRON_FAILED",
      "No fue posible ejecutar la expiración programada.",
    );
  }
}