import {
  checkInHotelReservation,
} from "@/lib/booking/reservation-checkin-operation";

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
  const {
    id,
  } =
    await context.params;

  let body:
    Record<string, unknown>;

  try {
    const parsedBody:
      unknown =
      await request.json();

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

    body =
      parsedBody as
        Record<string, unknown>;
  } catch {
    return errorResponse(
      "INVALID_JSON",
      "El cuerpo de la solicitud no contiene JSON válido.",
      400,
    );
  }

  const changedById =
    typeof body.changedById ===
      "string"
      ? body.changedById.trim()
      : "";

  if (
    !changedById
  ) {
    return errorResponse(
      "CHECK_IN_CHANGED_BY_REQUIRED",
      "Debes indicar el usuario que registra el check-in.",
      400,
    );
  }

  if (
    body.reason !==
      undefined &&
    body.reason !==
      null &&
    typeof body.reason !==
      "string"
  ) {
    return errorResponse(
      "INVALID_CHECK_IN_REASON",
      "El motivo del check-in debe ser texto.",
      400,
    );
  }

  const reason =
    typeof body.reason ===
      "string"
      ? body.reason.trim() ||
        null
      : null;

  if (
    reason &&
    reason.length >
      1000
  ) {
    return errorResponse(
      "INVALID_CHECK_IN_REASON",
      "El motivo del check-in no puede superar los 1000 caracteres.",
      400,
    );
  }

  const requestedAt =
    new Date();

  try {
    const result =
      await prisma.$transaction(
        async (
          tx,
        ) =>
          checkInHotelReservation({
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

      reservation: {
        ...result.reservation,

        startAt:
          result.reservation.startAt.toISOString(),

        endAt:
          result.reservation.endAt.toISOString(),
      },

      actor:
        result.actor,

      checkin: {
        timing:
          result.checkin.timing,

        scheduledStartAt:
          result.checkin.scheduledStartAt.toISOString(),

        scheduledEndAt:
          result.checkin.scheduledEndAt.toISOString(),

        checkedInAt:
          result.checkin.checkedInAt.toISOString(),

        earlyCheckin:
          result.checkin.earlyCheckin,
      },

      change: {
        id:
          result.change.id,

        type:
          result.change.type,

        changedById:
          result.change.changedById,

        reason:
          result.change.reason,

        oldStatus:
          result.change.oldStatus,

        newStatus:
          result.change.newStatus,

        createdAt:
          result.change.createdAt.toISOString(),
      },

      resources: {
        retained:
          result.resources.retained,

        assignmentCount:
          result.resources.assignmentCount,

        integrityValidated:
          result.resources.integrityValidated,

        validationStartAt:
          result.resources.validationStartAt.toISOString(),

        validationEndAt:
          result.resources.validationEndAt.toISOString(),

        earlyIntervalExpanded:
          result.resources.earlyIntervalExpanded,
      },

      paymentSummary:
        result.paymentSummary,

      financialState:
        result.financialState,
    });
  } catch (error) {
    console.error(
      "POST reservation check-in error:",
      error,
    );

    const errorCode =
      error instanceof Error
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
      "CHECK_IN_BUSINESS_NOT_FOUND"
    ) {
      return errorResponse(
        errorCode,
        "No fue posible encontrar el negocio asociado a la reserva.",
        409,
      );
    }

    if (
      errorCode ===
      "CHECK_IN_VERTICAL_NOT_IMPLEMENTED"
    ) {
      return errorResponse(
        errorCode,
        "El check-in dedicado todavía no está disponible para este tipo de negocio.",
        409,
      );
    }

    if (
      errorCode ===
      "CHECK_IN_ACTOR_NOT_VALID"
    ) {
      return errorResponse(
        errorCode,
        "El usuario que registra el check-in no existe, está inactivo o pertenece a otro negocio.",
        403,
      );
    }

    if (
      errorCode ===
      "RESERVATION_NOT_ELIGIBLE_FOR_CHECK_IN"
    ) {
      return errorResponse(
        errorCode,
        "Solo una reserva confirmada puede registrar check-in.",
        409,
      );
    }

    if (
      errorCode ===
      "EARLY_CHECK_IN_REASON_REQUIRED"
    ) {
      return errorResponse(
        errorCode,
        "Debes indicar un motivo para registrar un check-in antes de la hora programada.",
        400,
      );
    }

    if (
      errorCode ===
      "CHECK_IN_WINDOW_CLOSED"
    ) {
      return errorResponse(
        errorCode,
        "La salida programada de la reserva ya venció. Debes gestionar la reserva como no presentada en lugar de registrar check-in.",
        409,
      );
    }

    if (
      errorCode ===
        "INVALID_CHECK_IN_TIMESTAMPS" ||
      errorCode ===
        "INVALID_CHECK_IN_INTERVAL"
    ) {
      return errorResponse(
        errorCode,
        "Las fechas contractuales de la reserva no permiten registrar el check-in de forma segura.",
        409,
      );
    }

    if (
      errorCode ===
      "INITIAL_PAYMENT_REQUIRED_FOR_CHECK_IN"
    ) {
      return errorResponse(
        errorCode,
        "No se puede realizar el check-in porque el pago inicial requerido no está cubierto.",
        409,
      );
    }

    if (
      errorCode ===
      "RESOURCES_REQUIRED_FOR_CHECK_IN"
    ) {
      return errorResponse(
        errorCode,
        "No se puede realizar el check-in hasta asignar todos los recursos físicos requeridos por la reserva.",
        409,
      );
    }

    if (
      errorCode ===
      "OPTION_RESOURCES_REQUIRED_FOR_CHECK_IN"
    ) {
      return errorResponse(
        errorCode,
        "No se puede realizar el check-in hasta asignar todos los recursos físicos requeridos por los complementos activos.",
        409,
      );
    }

    if (
      errorCode ===
        "ASSIGNED_RESOURCES_UNAVAILABLE_FOR_CHECK_IN" ||
      errorCode ===
        "RESERVATION_OPTION_INTERVAL_INCOMPLETE" ||
      errorCode ===
        "INVALID_RESERVATION_RESOURCE_EFFECTIVE_INTERVAL" ||
      errorCode ===
        "RESERVATION_RESOURCE_RESOURCE_NOT_FOUND" ||
      errorCode ===
        "INVALID_RESOURCE_INTERVAL"
    ) {
      return errorResponse(
        "ASSIGNED_RESOURCES_UNAVAILABLE_FOR_CHECK_IN",
        "No se puede realizar el check-in porque uno o más recursos asignados ya no están disponibles. Revisa o reasigna los recursos de la reserva.",
        409,
      );
    }

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
        "CHECK_IN_CONCURRENT_MODIFICATION",
        "La reserva cambió mientras se registraba el check-in. Actualiza la información e intenta nuevamente.",
        409,
      );
    }

    return errorResponse(
      "CHECK_IN_FAILED",
      "No fue posible registrar el check-in.",
      500,
    );
  }
}