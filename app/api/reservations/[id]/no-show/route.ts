import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  markReservationNoShow,
} from "@/lib/booking/reservation-no-show-operation";

import {
  prisma,
} from "@/lib/prisma";

type RouteContext = {
  params:
    Promise<{
      id:
        string;
    }>;
};

function errorResponse(
  status:
    number,

  code:
    string,

  error:
    string,
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

  context:
    RouteContext,
) {
  try {
    const {
      id:
        reservationId,
    } =
      await context.params;

    let body:
      unknown;

    try {
      body =
        await request.json();
    } catch {
      return errorResponse(
        400,
        "INVALID_JSON",
        "El cuerpo de la solicitud no contiene JSON válido.",
      );
    }

    if (
      typeof body !==
        "object" ||
      body ===
        null ||
      Array.isArray(
        body,
      )
    ) {
      return errorResponse(
        400,
        "INVALID_JSON",
        "El cuerpo de la solicitud debe ser un objeto JSON válido.",
      );
    }

    const payload =
      body as
        Record<
          string,
          unknown
        >;

    const changedById =
      typeof payload.changedById ===
        "string"
        ? payload.changedById.trim()
        : "";

    if (
      !changedById
    ) {
      return errorResponse(
        400,
        "NO_SHOW_CHANGED_BY_REQUIRED",
        "Debes indicar el usuario que registra la ausencia.",
      );
    }

    if (
      payload.reason ===
        undefined ||
      payload.reason ===
        null
    ) {
      return errorResponse(
        400,
        "NO_SHOW_REASON_REQUIRED",
        "Debes indicar el motivo por el que se marca la reserva como no presentada.",
      );
    }

    if (
      typeof payload.reason !==
      "string"
    ) {
      return errorResponse(
        400,
        "INVALID_NO_SHOW_REASON",
        "El motivo de la ausencia debe ser texto.",
      );
    }

    const reason =
      payload.reason.trim();

    if (
      !reason
    ) {
      return errorResponse(
        400,
        "NO_SHOW_REASON_REQUIRED",
        "Debes indicar el motivo por el que se marca la reserva como no presentada.",
      );
    }

    if (
      reason.length >
      1000
    ) {
      return errorResponse(
        400,
        "INVALID_NO_SHOW_REASON",
        "El motivo de la ausencia no puede superar los 1000 caracteres.",
      );
    }

    const requestedAt =
      new Date();

    const result =
      await prisma.$transaction(
        async (
          tx,
        ) =>
          markReservationNoShow({
            reservationId,

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

    return NextResponse.json(
      {
        success:
          true,

        reservation:
          result.reservation,

        actor:
          result.actor,

        noShow:
          result.noShow,

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
            result.change.createdAt,
        },

        resources:
          result.resources,

        paymentSummary: {
          total:
            result.paymentSummary.total,

          paid:
            result.paymentSummary.paid,

          grossPaid:
            result.paymentSummary.grossPaid,

          pending:
            result.paymentSummary.pending,

          refundPending:
            result.paymentSummary.refundPending,

          refunded:
            result.paymentSummary.refunded,

          netPaid:
            result.paymentSummary.netPaid,

          balance:
            result.paymentSummary.balance,

          isPaid:
            result.paymentSummary.isPaid,
        },

        financialState:
          result.financialState,
      },

      {
        status:
          201,
      },
    );
  } catch (
    error
  ) {
    const code =
      error instanceof
        Error
        ? error.message
        : null;

    if (
      code ===
      "RESERVATION_NOT_FOUND"
    ) {
      return errorResponse(
        404,
        code,
        "La reserva no existe.",
      );
    }

    if (
      code ===
      "NO_SHOW_ACTOR_NOT_VALID"
    ) {
      return errorResponse(
        403,
        code,
        "El usuario que registra la ausencia no existe, está inactivo o pertenece a otro negocio.",
      );
    }

    if (
      code ===
      "RESERVATION_NOT_ELIGIBLE_FOR_NO_SHOW"
    ) {
      return errorResponse(
        409,
        code,
        "Solo una reserva confirmada puede marcarse como no presentada.",
      );
    }

    if (
      code ===
      "NO_SHOW_NOT_DUE"
    ) {
      return errorResponse(
        409,
        code,
        "La reserva todavía no ha alcanzado su hora programada de inicio.",
      );
    }

    if (
      code ===
      "NO_SHOW_REASON_REQUIRED"
    ) {
      return errorResponse(
        400,
        code,
        "Debes indicar el motivo por el que se marca la reserva como no presentada.",
      );
    }

    if (
      code ===
      "INVALID_NO_SHOW_REASON"
    ) {
      return errorResponse(
        400,
        code,
        "El motivo de la ausencia no es válido.",
      );
    }

    if (
      code ===
      "PENDING_PAYMENTS_MUST_BE_RESOLVED_FOR_NO_SHOW"
    ) {
      return errorResponse(
        409,
        code,
        "Debes confirmar o rechazar los pagos pendientes antes de marcar la reserva como no presentada.",
      );
    }

    if (
      code ===
        "NO_SHOW_BUSINESS_NOT_FOUND" ||
      code ===
        "NO_SHOW_BUSINESS_TYPE_NOT_FOUND"
    ) {
      return errorResponse(
        409,
        code,
        "La configuración del negocio no permite registrar la ausencia.",
      );
    }

    if (
      code ===
      "INVALID_NO_SHOW_TIMESTAMPS"
    ) {
      return errorResponse(
        409,
        code,
        "Las fechas de la reserva no permiten registrar la ausencia.",
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
        409,
        "NO_SHOW_SERIALIZATION_CONFLICT",
        "La reserva cambió mientras se registraba la ausencia. Intenta nuevamente.",
      );
    }

    console.error(
      "POST reservation no-show error:",
      error,
    );

    return errorResponse(
      500,
      "NO_SHOW_OPERATION_FAILED",
      "No fue posible marcar la reserva como no presentada.",
    );
  }
}