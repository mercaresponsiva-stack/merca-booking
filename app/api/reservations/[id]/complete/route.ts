import {
  completeCheckedOutReservation,
} from "@/lib/booking/reservation-completion-operation";

import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  prisma,
} from "@/lib/prisma";

function errorResponse(
  code:
    string,

  error:
    string,

  status:
    number,
) {
  return NextResponse.json(
    {
      success:
        false,

      code,

      error,
    },
    {
      status,
    },
  );
}

/*
 * Cierre administrativo definitivo.
 *
 * Esta ruta es la única operación autorizada
 * para aplicar:
 *
 * CHECKED_OUT -> COMPLETED
 */
export async function POST(
  request:
    NextRequest,

  context: {
    params:
      Promise<{
        id:
          string;
      }>;
  },
) {
  try {
    const {
      id,
    } =
      await context.params;

    let parsedBody:
      unknown;

    try {
      parsedBody =
        await request.json();
    } catch {
      return errorResponse(
        "INVALID_JSON",
        "El cuerpo de la solicitud no contiene JSON válido.",
        400,
      );
    }

    if (
      typeof parsedBody !==
        "object" ||
      parsedBody ===
        null ||
      Array.isArray(
        parsedBody,
      )
    ) {
      return errorResponse(
        "INVALID_JSON",
        "El cuerpo de la solicitud debe ser un objeto JSON válido.",
        400,
      );
    }

    const body =
      parsedBody as
        Record<
          string,
          unknown
        >;

    const changedById =
      typeof body.changedById ===
        "string"
        ? body.changedById.trim()
        : "";

    if (
      !changedById
    ) {
      return errorResponse(
        "COMPLETION_CHANGED_BY_REQUIRED",
        "Debes indicar el usuario que completa la reserva.",
        400,
      );
    }

    let reason:
      string | null =
      null;

    if (
      body.reason !==
        undefined &&
      body.reason !==
        null
    ) {
      if (
        typeof body.reason !==
        "string"
      ) {
        return errorResponse(
          "INVALID_COMPLETION_REASON",
          "El motivo del cierre debe ser texto.",
          400,
        );
      }

      const normalizedReason =
        body.reason.trim();

      if (
        normalizedReason.length >
        1000
      ) {
        return errorResponse(
          "INVALID_COMPLETION_REASON",
          "El motivo del cierre no puede superar los 1000 caracteres.",
          400,
        );
      }

      reason =
        normalizedReason ||
        null;
    }

    const requestedAt =
      new Date();

    const result =
      await prisma.$transaction(
        async (
          tx,
        ) =>
          completeCheckedOutReservation({
            reservationId:
              id,

            changedById,

            reason,

            requestedAt,

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

      reservation:
        result.reservation,

      actor:
        result.actor,

      completion:
        result.completion,

      change:
        result.change,

      resources:
        result.resources,

      paymentSummary:
        result.paymentSummary,

      financialState:
        result.financialState,
    });
  } catch (
    error
  ) {
    const errorCode =
      error instanceof
      Error
        ? error.message
        : null;

    if (
      errorCode ===
      "RESERVATION_NOT_FOUND"
    ) {
      return errorResponse(
        errorCode,
        "La reserva no existe.",
        404,
      );
    }

    if (
      errorCode ===
      "COMPLETION_ACTOR_NOT_VALID"
    ) {
      return errorResponse(
        errorCode,
        "El usuario que completa la reserva no existe, está inactivo o pertenece a otro negocio.",
        403,
      );
    }

    if (
      errorCode ===
      "RESERVATION_NOT_ELIGIBLE_FOR_COMPLETION"
    ) {
      return errorResponse(
        errorCode,
        "Solo una reserva con check-out registrado puede completarse.",
        409,
      );
    }

    if (
      errorCode ===
      "RESERVATION_FINANCIAL_SETTLEMENT_REQUIRED_FOR_COMPLETION"
    ) {
      return errorResponse(
        errorCode,
        "La reserva no puede completarse hasta resolver saldos, pagos pendientes, devoluciones pendientes o sobrepagos.",
        409,
      );
    }

    /*
     * Prisma Serializable conflict.
     *
     * El cliente puede volver a consultar
     * la reserva y repetir la operación.
     */
    if (
      typeof error ===
        "object" &&
      error !==
        null &&
      "code" in
        error &&
      error.code ===
        "P2034"
    ) {
      return errorResponse(
        "RESERVATION_COMPLETION_CONFLICT",
        "La reserva cambió mientras se procesaba el cierre. Intenta nuevamente.",
        409,
      );
    }

    console.error(
      "POST reservation completion error:",
      error,
    );

    return errorResponse(
      "RESERVATION_COMPLETION_FAILED",
      "No fue posible completar la reserva.",
      500,
    );
  }
}