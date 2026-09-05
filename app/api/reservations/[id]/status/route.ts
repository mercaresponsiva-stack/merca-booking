import {
  isReservationStatus,
  type ReservationStatus,
} from "@/lib/booking/reservation-state";

import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  AuthorizationError,
  requireAuthenticatedUser,
} from "@/lib/auth/business-access";

export const dynamic =
  "force-dynamic";

type StatusBarrier = {
  code: string;
  error: string;
};

const STATUS_BARRIERS: Record<
  ReservationStatus,
  StatusBarrier
> = {
  PENDING: {
    code:
      "GENERIC_STATUS_CHANGES_DISABLED",

    error:
      "Los estados de reserva solo pueden modificarse mediante sus operaciones dedicadas.",
  },

  CONFIRMED: {
    code:
      "CONFIRMATION_REQUIRES_DEDICATED_OPERATION",

    error:
      "La reserva debe confirmarse mediante la operación dedicada de confirmación.",
  },

  CANCELLED: {
    code:
      "CANCELLATION_REQUIRES_DEDICATED_OPERATION",

    error:
      "La cancelación debe registrarse mediante la operación dedicada de cancelación.",
  },

  EXPIRED: {
    code:
      "EXPIRATION_REQUIRES_DEDICATED_OPERATION",

    error:
      "La expiración debe realizarse mediante el proceso programado del servidor.",
  },

  NO_SHOW: {
    code:
      "NO_SHOW_REQUIRES_DEDICATED_OPERATION",

    error:
      "La ausencia debe registrarse mediante la operación dedicada de no presentación.",
  },

  CHECKED_IN: {
    code:
      "CHECK_IN_REQUIRES_DEDICATED_OPERATION",

    error:
      "El check-in debe registrarse mediante la operación dedicada de ingreso.",
  },

  CHECKED_OUT: {
    code:
      "CHECK_OUT_REQUIRES_DEDICATED_OPERATION",

    error:
      "El check-out debe registrarse mediante la operación dedicada de salida.",
  },

  COMPLETED: {
    code:
      "COMPLETION_REQUIRES_DEDICATED_OPERATION",

    error:
      "La reserva debe completarse mediante la operación dedicada de cierre administrativo.",
  },
};

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

function isJsonObject(
  value: unknown,
): value is Record<
  string,
  unknown
> {
  return (
    typeof value ===
      "object" &&
    value !==
      null &&
    !Array.isArray(
      value,
    )
  );
}

export async function PATCH(
  request: NextRequest,
) {
  try {
    await requireAuthenticatedUser();

    let body:
      unknown;

    try {
      body =
        await request.json();
    } catch {
      return privateJson(
        {
          success:
            false,

          code:
            "INVALID_JSON",

          error:
            "El cuerpo de la solicitud no contiene JSON válido.",
        },
        {
          status:
            400,
        },
      );
    }

    if (
      !isJsonObject(
        body,
      )
    ) {
      return privateJson(
        {
          success:
            false,

          code:
            "INVALID_RESERVATION_STATUS_BODY",

          error:
            "El cuerpo de la solicitud debe ser un objeto JSON válido.",
        },
        {
          status:
            400,
        },
      );
    }

    const status =
      body.status;

    if (
      !isReservationStatus(
        status,
      )
    ) {
      return privateJson(
        {
          success:
            false,

          code:
            "INVALID_RESERVATION_STATUS",

          error:
            "Estado de reserva inválido.",
        },
        {
          status:
            400,
        },
      );
    }

    const barrier =
      STATUS_BARRIERS[
        status
      ];

    return privateJson(
      {
        success:
          false,

        code:
          barrier.code,

        error:
          barrier.error,
      },
      {
        status:
          409,
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
      "PATCH reservation status barrier error:",
      error,
    );

    return privateJson(
      {
        success:
          false,

        code:
          "RESERVATION_STATUS_BARRIER_FAILED",

        error:
          "No fue posible validar la operación de estado.",
      },
      {
        status:
          500,
      },
    );
  }
}
