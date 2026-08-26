import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  expirePendingReservation,
} from "@/lib/booking/reservation-expiration-operation";

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

    /*
     * La expiración usa exclusivamente el reloj
     * del servidor. No acepta actor, motivo,
     * estado ni requestedAt desde el cliente.
     */
    if (
      Object.keys(
        payload,
      ).length >
      0
    ) {
      return errorResponse(
        400,
        "EXPIRATION_PAYLOAD_NOT_ALLOWED",
        "La expiración no acepta datos controlados por el cliente.",
      );
    }

    const requestedAt =
      new Date();

    const result =
      await prisma.$transaction(
        async (
          tx,
        ) =>
          expirePendingReservation({
            reservationId,

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

        expiration:
          result.expiration,

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

          details:
            result.change.details,

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

          paymentOption:
            result.paymentSummary
              .paymentOption,

          requiredInitialPayment:
            result.paymentSummary
              .requiredInitialPayment,

          initialPaymentRemaining:
            result.paymentSummary
              .initialPaymentRemaining,

          initialPaymentSatisfied:
            result.paymentSummary
              .initialPaymentSatisfied,

          balanceDueAt:
            result.paymentSummary
              .balanceDueAt,
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
      "RESERVATION_NOT_ELIGIBLE_FOR_EXPIRATION"
    ) {
      return errorResponse(
        409,
        code,
        "Solo una reserva pendiente puede expirar.",
      );
    }

    if (
      code ===
      "RESERVATION_EXPIRATION_NOT_CONFIGURED"
    ) {
      return errorResponse(
        409,
        code,
        "La reserva pendiente no tiene una fecha de vencimiento configurada.",
      );
    }

    if (
      code ===
      "INVALID_EXPIRATION_TIMESTAMP"
    ) {
      return errorResponse(
        409,
        code,
        "La fecha de vencimiento de la reserva no es válida.",
      );
    }

    if (
      code ===
      "RESERVATION_EXPIRATION_NOT_DUE"
    ) {
      return errorResponse(
        409,
        code,
        "La reserva todavía se encuentra dentro de su plazo de pago.",
      );
    }

    if (
      code ===
      "PENDING_PAYMENTS_MUST_BE_RESOLVED_FOR_EXPIRATION"
    ) {
      return errorResponse(
        409,
        code,
        "Debes confirmar o rechazar los pagos pendientes antes de expirar la reserva.",
      );
    }

    if (
      code ===
      "REFUNDS_MUST_BE_RESOLVED_FOR_EXPIRATION"
    ) {
      return errorResponse(
        409,
        code,
        "Debes completar las devoluciones pendientes antes de expirar la reserva.",
      );
    }

    if (
      code ===
      "RESERVATION_PAYMENT_PROTECTS_FROM_EXPIRATION"
    ) {
      return errorResponse(
        409,
        code,
        "El pago inicial requerido ya está cubierto; confirma la reserva en lugar de expirarla.",
      );
    }

    if (
      code ===
      "PAYMENTS_MUST_BE_RESOLVED_FOR_EXPIRATION"
    ) {
      return errorResponse(
        409,
        code,
        "La reserva conserva fondos recibidos y requiere resolución financiera manual antes de expirar.",
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
        "EXPIRATION_SERIALIZATION_CONFLICT",
        "La reserva cambió mientras se procesaba su vencimiento. Intenta nuevamente.",
      );
    }

    console.error(
      "POST reservation expiration error:",
      error,
    );

    return errorResponse(
      500,
      "EXPIRATION_OPERATION_FAILED",
      "No fue posible expirar la reserva.",
    );
  }
}
