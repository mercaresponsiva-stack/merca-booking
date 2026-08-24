import {
  isValidDateOnly,
} from "@/lib/booking/datetime";

import {
  extendCheckedInHotelStay,
} from "@/lib/booking/verticals/hotel/stay-extension-operation";

import {
  NextRequest,
  NextResponse,
} from "next/server";

import { prisma } from "@/lib/prisma";

const STAY_EXTENSION_CONFIGURATION_ERRORS:
  ReadonlySet<string> =
  new Set([
    "DUPLICATE_STAY_EXTENSION_OPTION",
    "INVALID_STAY_EXTENSION_TIMEZONE_DATE",
    "RESERVATION_OPTION_INTERVAL_INCOMPLETE",
    "STAY_EXTENSION_OPTION_BILLING_UNITS_DECREASED",
    "OPTION_INTERVAL_INCOMPLETE",
    "INVALID_OPTION_INTERVAL",
    "HOTEL_OPTION_TIMEZONE_REQUIRED",
    "HOTEL_OPTION_HOURLY_INTERVAL_REQUIRED",
    "INVALID_OPTION_BILLING_UNITS",
    "INVALID_INCLUDED_QUANTITY",
    "INVALID_OPTIONAL_QUANTITY",
    "OPTION_QUANTITY_REQUIRED",
    "INVALID_OPTION_PRICING_BASE",
    "INVALID_OPTION_PRICING_FREQUENCY",
    "INVALID_OPTION_UNIT_PRICE",
    "OPTION_PRICE_OVERFLOW",
    "INVALID_RESOURCE_INTERVAL",
    "INVALID_RESERVATION_RESOURCE_EFFECTIVE_INTERVAL",
    "INVALID_OPTION_DEMAND_INTERVAL",
    "INVALID_PROSPECTIVE_INVENTORY_INTERVAL",
    "INVALID_PROSPECTIVE_INVENTORY_QUANTITY",
    "INVALID_RESERVATION_OPTION_INTERVAL",
    "INVALID_RESOURCE_TYPE_INVENTORY_INTERVAL",
    "RESERVATION_OPTION_RESERVATION_NOT_FOUND",
  ]);

const STAY_EXTENSION_FINANCIAL_ERRORS:
  ReadonlySet<string> =
  new Set([
    "INVALID_STAY_EXTENSION_FINANCIAL_VALUES",
    "STAY_EXTENSION_FINANCIAL_OVERFLOW",
    "STAY_EXTENSION_OPTION_CALCULATION_OVERFLOW",
  ]);

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

export async function PATCH(
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

    let body:
      Record<string, unknown>;

    try {
      body =
        await request.json() as
          Record<string, unknown>;
    } catch {
      return errorResponse(
        "INVALID_JSON",
        "El cuerpo de la solicitud no es JSON válido.",
        400,
      );
    }

    const checkOut =
      typeof body.checkOut ===
      "string"
        ? body.checkOut.trim()
        : "";

    const changedById =
      typeof body.changedById ===
      "string"
        ? body.changedById.trim()
        : "";

    const reason =
      typeof body.reason ===
        "string" &&
      body.reason.trim()
        ? body.reason.trim()
        : null;

    if (!checkOut) {
      return errorResponse(
        "STAY_EXTENSION_CHECK_OUT_REQUIRED",
        "La nueva fecha de salida es requerida.",
        400,
      );
    }

    if (
      !isValidDateOnly(
        checkOut,
      )
    ) {
      return errorResponse(
        "INVALID_STAY_EXTENSION_DATE_ONLY",
        "La fecha de salida no es válida. Usa el formato YYYY-MM-DD.",
        400,
      );
    }

    if (!changedById) {
      return errorResponse(
        "STAY_EXTENSION_CHANGED_BY_REQUIRED",
        "changedById es requerido.",
        400,
      );
    }

    /*
     * Un solo instante coherente para
     * toda la operación y su auditoría.
     */
    const requestedAt =
      new Date();

    const result =
      await prisma.$transaction(
        async (
          tx,
        ) =>
          extendCheckedInHotelStay({
            reservationId:
              id,

            newCheckOut:
              checkOut,

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
          result.change.oldSubtotal ===
          null
            ? null
            : Number(
                result.change
                  .oldSubtotal,
              ),

        newSubtotal:
          result.change.newSubtotal ===
          null
            ? null
            : Number(
                result.change
                  .newSubtotal,
              ),

        oldTotal:
          result.change.oldTotal ===
          null
            ? null
            : Number(
                result.change
                  .oldTotal,
              ),

        newTotal:
          result.change.newTotal ===
          null
            ? null
            : Number(
                result.change
                  .newTotal,
              ),

        oldStatus:
          result.change.oldStatus,

        newStatus:
          result.change.newStatus,

        createdAt:
          result.change.createdAt,
      },

      pricing:
        result.pricing,

      resources:
        result.resources,

      inventory:
        result.inventory,

      financialImpact:
        result.financialImpact,

      paymentSummary:
        result.paymentSummary,
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
        "Reserva no encontrada.",
        404,
      );
    }

    if (
      errorCode ===
      "STAY_EXTENSION_BUSINESS_NOT_FOUND"
    ) {
      return errorResponse(
        errorCode,
        "La reserva no tiene un negocio válido asociado.",
        409,
      );
    }

    if (
      errorCode ===
      "STAY_EXTENSION_ACTOR_NOT_VALID"
    ) {
      return errorResponse(
        errorCode,
        "El usuario que realiza la extensión no existe, está inactivo o pertenece a otro negocio.",
        403,
      );
    }

    if (
      errorCode ===
      "RESERVATION_NOT_EXTENDABLE"
    ) {
      return errorResponse(
        errorCode,
        "Solo puede extenderse una reserva que tenga el check-in realizado.",
        409,
      );
    }

    if (
      errorCode ===
      "STAY_EXTENSION_ACTIVE_REFUND"
    ) {
      return errorResponse(
        errorCode,
        "La reserva tiene una devolución pendiente o en procesamiento. Debe resolverse antes de extender la estancia.",
        409,
      );
    }

    if (
      errorCode ===
      "STAY_EXTENSION_END_MUST_INCREASE"
    ) {
      return errorResponse(
        errorCode,
        "La nueva fecha de salida debe ser posterior a la salida actual.",
        409,
      );
    }

    if (
      errorCode ===
      "STAY_EXTENSION_END_MUST_BE_FUTURE"
    ) {
      return errorResponse(
        errorCode,
        "La nueva fecha de salida debe permanecer en el futuro al aplicar la extensión.",
        409,
      );
    }

    if (
      errorCode ===
      "STAY_EXTENSION_VERTICAL_NOT_IMPLEMENTED"
    ) {
      return errorResponse(
        errorCode,
        "La extensión de estancia todavía no está implementada para este tipo de negocio.",
        501,
      );
    }

    if (
      errorCode ===
      "HOTEL_STAY_EXTENSION_MULTI_SERVICE_NOT_IMPLEMENTED"
    ) {
      return errorResponse(
        errorCode,
        "Hotel V1 todavía no admite extender reservas con múltiples servicios o cantidades superiores a una unidad.",
        409,
      );
    }

    if (
      errorCode ===
      "STAY_EXTENSION_SERVICE_NOT_FOUND"
    ) {
      return errorResponse(
        errorCode,
        "El servicio asociado a la reserva ya no existe o no pertenece al negocio.",
        409,
      );
    }

    if (
      errorCode ===
      "RATE_NOT_AVAILABLE"
    ) {
      return errorResponse(
        errorCode,
        "No existe una tarifa activa para todas las noches adicionales solicitadas.",
        409,
      );
    }

    if (
      errorCode ===
      "INVALID_RATE_PRICE"
    ) {
      return errorResponse(
        errorCode,
        "Una de las tarifas aplicables a la extensión tiene un precio inválido.",
        409,
      );
    }

    if (
      errorCode ===
        "INVALID_STAY_EXTENSION_DATE_ONLY" ||
      errorCode ===
        "STAY_EXTENSION_NIGHTS_REQUIRED" ||
      errorCode ===
        "INVALID_NUMBER_OF_NIGHTS"
    ) {
      return errorResponse(
        errorCode,
        "La extensión debe agregar al menos una noche completa con fechas válidas.",
        400,
      );
    }

    if (
      errorCode ===
      "PROSPECTIVE_INVENTORY_NOT_AVAILABLE"
    ) {
      return errorResponse(
        errorCode,
        "No hay inventario suficiente para cubrir todas las noches adicionales y sus complementos.",
        409,
      );
    }

    if (
      errorCode ===
      "STAY_EXTENSION_REQUIRED_RESOURCES_NOT_ASSIGNED"
    ) {
      return errorResponse(
        errorCode,
        "Todos los recursos físicos obligatorios deben estar asignados antes de extender la estancia.",
        409,
      );
    }

    if (
      errorCode ===
      "ASSIGNED_RESOURCES_UNAVAILABLE_FOR_STAY_EXTENSION"
    ) {
      return errorResponse(
        errorCode,
        "Uno o más recursos asignados no pueden conservarse durante las noches adicionales. Resuelve el conflicto antes de extender la estancia.",
        409,
      );
    }

    if (
      errorCode &&
      STAY_EXTENSION_CONFIGURATION_ERRORS.has(
        errorCode,
      )
    ) {
      return errorResponse(
        errorCode,
        "La configuración histórica de los recursos o complementos no permite calcular esta extensión.",
        409,
      );
    }

    if (
      errorCode &&
      STAY_EXTENSION_FINANCIAL_ERRORS.has(
        errorCode,
      )
    ) {
      return errorResponse(
        errorCode,
        "No fue posible calcular el ajuste económico de la extensión de forma segura.",
        409,
      );
    }

    /*
     * Conflicto Serializable de Prisma.
     *
     * Recepción puede volver a consultar
     * la reserva e intentar nuevamente.
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
        "STAY_EXTENSION_CONCURRENT_MODIFICATION",
        "La reserva cambió mientras se procesaba la extensión. Consulta nuevamente e inténtalo otra vez.",
        409,
      );
    }

    console.error(
      "PATCH reservation stay extension error:",
      error,
    );

    return errorResponse(
      "STAY_EXTENSION_FAILED",
      "Error al extender la estancia.",
      500,
    );
  }
}