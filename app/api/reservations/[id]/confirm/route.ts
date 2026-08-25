import {
  confirmReservation,
} from "@/lib/booking/reservation-confirmation-operation";

import {
  RESERVATION_CONFIRMATION_REASON_MAX_LENGTH,
} from "@/lib/booking/reservation-confirmation-policy";

import {
  NextRequest,
  NextResponse,
} from "next/server";

import { prisma } from "@/lib/prisma";

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

function hasPrismaErrorCode(
  error: unknown,
  code: string,
) {
  return (
    typeof error ===
      "object" &&
    error !==
      null &&
    "code" in
      error &&
    error.code ===
      code
  );
}

export async function POST(
  request: NextRequest,

  context: {
    params: Promise<{
      id: string;
    }>;
  },
) {
  try {
    const {
      id,
    } =
      await context.params;

    let body: unknown;

    try {
      body =
        await request.json();
    } catch {
      return NextResponse.json(
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
      return NextResponse.json(
        {
          success:
            false,

          code:
            "INVALID_JSON",

          error:
            "El cuerpo de la solicitud debe ser un objeto JSON válido.",
        },
        {
          status:
            400,
        },
      );
    }

    const changedByIdValue =
      body.changedById;

    if (
      typeof changedByIdValue !==
        "string" ||
      !changedByIdValue.trim()
    ) {
      return NextResponse.json(
        {
          success:
            false,

          code:
            "CONFIRMATION_CHANGED_BY_REQUIRED",

          error:
            "Debes indicar el usuario que confirma la reserva.",
        },
        {
          status:
            400,
        },
      );
    }

    const reasonValue =
      body.reason;

    if (
      reasonValue !==
        undefined &&
      reasonValue !==
        null &&
      typeof reasonValue !==
        "string"
    ) {
      return NextResponse.json(
        {
          success:
            false,

          code:
            "INVALID_CONFIRMATION_REASON",

          error:
            "El motivo de la confirmación debe ser texto.",
        },
        {
          status:
            400,
        },
      );
    }

    const reason =
      typeof reasonValue ===
        "string"
        ? reasonValue
        : null;

    if (
      reason !==
        null &&
      reason.trim().length >
        RESERVATION_CONFIRMATION_REASON_MAX_LENGTH
    ) {
      return NextResponse.json(
        {
          success:
            false,

          code:
            "INVALID_CONFIRMATION_REASON",

          error:
            "El motivo de la confirmación no puede superar los 1000 caracteres.",
        },
        {
          status:
            400,
        },
      );
    }

    const confirmedAt =
      new Date();

    const result =
      await prisma.$transaction(
        async (
          tx,
        ) =>
          confirmReservation({
            reservationId:
              id,

            changedById:
              changedByIdValue.trim(),

            reason,

            confirmedAt,

            db:
              tx,
          }),

        {
          isolationLevel:
            "Serializable",
        },
      );

    return NextResponse.json({
      success:
        true,

      ...result,
    });
  } catch (
    error
  ) {
    if (
      error instanceof
        Error &&
      error.message ===
        "RESERVATION_NOT_FOUND"
    ) {
      return NextResponse.json(
        {
          success:
            false,

          code:
            "RESERVATION_NOT_FOUND",

          error:
            "La reserva no existe.",
        },
        {
          status:
            404,
        },
      );
    }

    if (
      error instanceof
        Error &&
      error.message ===
        "CONFIRMATION_ACTOR_NOT_VALID"
    ) {
      return NextResponse.json(
        {
          success:
            false,

          code:
            "CONFIRMATION_ACTOR_NOT_VALID",

          error:
            "El usuario que confirma la reserva no existe, está inactivo o pertenece a otro negocio.",
        },
        {
          status:
            403,
        },
      );
    }

    if (
      error instanceof
        Error &&
      error.message ===
        "RESERVATION_NOT_ELIGIBLE_FOR_CONFIRMATION"
    ) {
      return NextResponse.json(
        {
          success:
            false,

          code:
            "RESERVATION_NOT_ELIGIBLE_FOR_CONFIRMATION",

          error:
            "Solo una reserva pendiente puede confirmarse.",
        },
        {
          status:
            409,
        },
      );
    }

    if (
      error instanceof
        Error &&
      error.message ===
        "INITIAL_PAYMENT_REQUIRED_FOR_CONFIRMATION"
    ) {
      return NextResponse.json(
        {
          success:
            false,

          code:
            "INITIAL_PAYMENT_REQUIRED_FOR_CONFIRMATION",

          error:
            "La reserva no puede confirmarse hasta que se haya pagado el monto inicial requerido.",
        },
        {
          status:
            409,
        },
      );
    }

    if (
      error instanceof
        Error &&
      error.message ===
        "INVALID_CONFIRMATION_REASON"
    ) {
      return NextResponse.json(
        {
          success:
            false,

          code:
            "INVALID_CONFIRMATION_REASON",

          error:
            "El motivo de la confirmación no puede superar los 1000 caracteres.",
        },
        {
          status:
            400,
        },
      );
    }

    if (
      error instanceof
        Error &&
      error.message ===
        "INVALID_CONFIRMATION_TIMESTAMP"
    ) {
      console.error(
        "Invalid reservation confirmation timestamp:",
        error,
      );

      return NextResponse.json(
        {
          success:
            false,

          code:
            "INVALID_CONFIRMATION_TIMESTAMP",

          error:
            "No fue posible establecer la fecha de confirmación.",
        },
        {
          status:
            500,
        },
      );
    }

    if (
      hasPrismaErrorCode(
        error,
        "P2034",
      )
    ) {
      return NextResponse.json(
        {
          success:
            false,

          code:
            "CONCURRENT_CONFIRMATION_CONFLICT",

          error:
            "La reserva cambió mientras se intentaba confirmar. Actualiza la información e inténtalo nuevamente.",
        },
        {
          status:
            409,
        },
      );
    }

    console.error(
      "POST reservation confirmation error:",
      error,
    );

    return NextResponse.json(
      {
        success:
          false,

        code:
          "RESERVATION_CONFIRMATION_FAILED",

        error:
          "No fue posible confirmar la reserva.",
      },
      {
        status:
          500,
      },
    );
  }
}