import {
  checkOutHotelReservation,
} from "@/lib/booking/reservation-checkout-operation";

import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  prisma,
} from "@/lib/prisma";

import {
  AuthorizationError,
  requireAuthenticatedUser,
  requireBusinessAccess,
} from "@/lib/auth/business-access";

export const dynamic =
  "force-dynamic";

const RESERVATION_LIFECYCLE_ALLOWED_ROLES = [
  "OWNER",
  "ADMIN",
  "RECEPTIONIST",
] as const;

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

function errorResponse(
  code:
    string,

  error:
    string,

  status:
    number,
) {
  return privateJson(
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
  try {
    await requireAuthenticatedUser();

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
        "INVALID_CHECK_OUT_BODY",
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

    // El changedById recibido por compatibilidad no se usa para auditoría.

    if (
      body.reason !==
        undefined &&
      body.reason !==
        null &&
      typeof body.reason !==
        "string"
    ) {
      return errorResponse(
        "INVALID_CHECK_OUT_REASON",
        "El motivo del check-out debe ser texto.",
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
        "INVALID_CHECK_OUT_REASON",
        "El motivo del check-out no puede superar los 1000 caracteres.",
        400,
      );
    }

    /*
     * Un único instante representa toda
     * la operación y su evento de auditoría.
     */
    const reservationScope =
      await prisma.reservation.findUnique({
        where: {
          id,
        },

        select: {
          businessId:
            true,
        },
      });

    if (
      !reservationScope
    ) {
      throw new Error(
        "RESERVATION_NOT_FOUND",
      );
    }

    const access =
      await requireBusinessAccess(
        reservationScope.businessId,

        RESERVATION_LIFECYCLE_ALLOWED_ROLES,
      );

    const requestedAt =
      new Date();

    const result =
      await prisma.$transaction(
        async (
          tx,
        ) =>
          checkOutHotelReservation({
            reservationId:
              id,

            changedById:
              access.user.id,

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

    return privateJson({
      success:
        true,

      reservation:
        result.reservation,

      actor:
        result.actor,

      checkout:
        result.checkout,

      change: {
        id:
          result.change.id,

        type:
          result.change.type,

        changedById:
          result.change.changedById,

        reason:
          result.change.reason,

        oldStartAt:
          result.change.oldStartAt,

        newStartAt:
          result.change.newStartAt,

        oldEndAt:
          result.change.oldEndAt,

        newEndAt:
          result.change.newEndAt,

        oldSubtotal:
          result.change.oldSubtotal !==
          null
            ? Number(
                result.change.oldSubtotal,
              )
            : null,

        newSubtotal:
          result.change.newSubtotal !==
          null
            ? Number(
                result.change.newSubtotal,
              )
            : null,

        oldTotal:
          result.change.oldTotal !==
          null
            ? Number(
                result.change.oldTotal,
              )
            : null,

        newTotal:
          result.change.newTotal !==
          null
            ? Number(
                result.change.newTotal,
              )
            : null,

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

      paymentSummary:
        result.paymentSummary,

      financialState:
        result.financialState,
    });
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
      "POST reservation checkout error:",
      error,
    );

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
        "Reserva no encontrada.",
        404,
      );
    }

    if (
      errorCode ===
      "CHECK_OUT_ACTOR_NOT_VALID"
    ) {
      return errorResponse(
        errorCode,
        "El usuario que registra el check-out no existe, está inactivo o pertenece a otro negocio.",
        403,
      );
    }

    if (
      errorCode ===
      "RESERVATION_NOT_ELIGIBLE_FOR_CHECK_OUT"
    ) {
      return errorResponse(
        errorCode,
        "Solo una reserva actualmente registrada como CHECKED_IN puede realizar check-out.",
        409,
      );
    }

    if (
      errorCode ===
      "CHECK_OUT_PENDING_PAYMENT"
    ) {
      return errorResponse(
        errorCode,
        "La reserva tiene uno o más pagos pendientes. Deben confirmarse, fallar o resolverse antes del check-out.",
        409,
      );
    }

    if (
      errorCode ===
      "CHECK_OUT_BALANCE_DUE"
    ) {
      return errorResponse(
        errorCode,
        "No se puede registrar el check-out mientras exista un saldo pendiente de pago.",
        409,
      );
    }

    if (
      errorCode ===
      "EARLY_CHECK_OUT_REASON_REQUIRED"
    ) {
      return errorResponse(
        errorCode,
        "Debes indicar un motivo para registrar un check-out antes de la salida programada.",
        400,
      );
    }

    if (
      errorCode ===
      "CHECK_OUT_VERTICAL_NOT_IMPLEMENTED"
    ) {
      return errorResponse(
        errorCode,
        "El check-out dedicado todavía no está implementado para este tipo de negocio.",
        501,
      );
    }

    if (
      errorCode ===
        "CHECK_OUT_BUSINESS_NOT_FOUND" ||
      errorCode ===
        "INVALID_CHECK_OUT_TIMESTAMP" ||
      errorCode ===
        "INVALID_CHECK_OUT_FINANCIAL_VALUES" ||
      errorCode ===
        "CHECK_OUT_FINANCIAL_OVERFLOW"
    ) {
      return errorResponse(
        errorCode,
        "La reserva contiene información operativa o financiera inconsistente y el check-out no puede continuar.",
        409,
      );
    }

    /*
     * Conflicto Serializable.
     *
     * Puede ocurrir si simultáneamente se
     * registra un pago, reembolso, extensión
     * o cambio de estado.
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
        "CHECK_OUT_CONCURRENT_MODIFICATION",
        "La reserva cambió mientras se registraba el check-out. Actualiza la información e intenta nuevamente.",
        409,
      );
    }

    return errorResponse(
      "CHECK_OUT_FAILED",
      "No fue posible registrar el check-out.",
      500,
    );
  }
}