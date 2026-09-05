import {
  NextResponse,
} from "next/server";

import {
  AuthorizationError,
  requireAuthenticatedUser,
} from "@/lib/auth/business-access";

export const dynamic =
  "force-dynamic";

function privateJson(
  body: unknown,
  init: ResponseInit = {},
) {
  const headers =
    new Headers(
      init.headers,
    );

  headers.set(
    "Cache-Control",
    "private, no-store, max-age=0, must-revalidate",
  );
  headers.set(
    "Pragma",
    "no-cache",
  );
  headers.set(
    "Expires",
    "0",
  );
  headers.set(
    "X-Robots-Tag",
    "noindex, nofollow",
  );

  return NextResponse.json(
    body,
    {
      ...init,
      headers,
    },
  );
}

/*
 * La expiración individual desde HTTP fue retirada.
 *
 * Las reservas pendientes vencen exclusivamente
 * mediante el proceso interno protegido por
 * CRON_SECRET.
 */
export async function POST() {
  try {
    await requireAuthenticatedUser();

    return privateJson(
      {
        success:
          false,

        code:
          "MANUAL_RESERVATION_EXPIRATION_DISABLED",

        error:
          "La expiración manual está deshabilitada. Las reservas pendientes vencen mediante el proceso programado del servidor.",
      },
      {
        status:
          410,
      },
    );
  } catch (
    error
  ) {
    if (
      error instanceof
        AuthorizationError
    ) {
      return privateJson(
        {
          success:
            false,

          code:
            error.code,

          error:
            error.message,
        },
        {
          status:
            error.status,
        },
      );
    }

    console.error(
      "POST reservation expiration barrier error:",
      error,
    );

    return privateJson(
      {
        success:
          false,

        code:
          "RESERVATION_EXPIRATION_BARRIER_FAILED",

        error:
          "No fue posible validar la operación de expiración.",
      },
      {
        status:
          500,
      },
    );
  }
}
