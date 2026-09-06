import {
  zonedDateTimeToUtc,
} from "@/lib/booking/datetime";

import {
  fromCents,
  toCents,
} from "@/lib/booking/money";

import {
  getPaymentOptionLabel,
  getPaymentOptionPercentage,
  getRequiredInitialPaymentCents,
} from "@/lib/booking/payment-option";

import {
  createHotelReservation,
} from "@/lib/booking/reservation-creation-operation";

import {
  calculateHotelNights,
} from "@/lib/booking/verticals/hotel/pricing";

import {
  NextRequest,
} from "next/server";

import {
  prisma,
} from "@/lib/prisma";

import {
  type PublicCorsOptions,
  publicError,
  publicJson,
  publicOptions,
} from "@/lib/public-api/http";

import {
  createPublicReservationFingerprint,
  PublicReservationIdempotencyConfigurationError,
  publicReservationFingerprintsMatch,
} from "@/lib/public-api/reservation-idempotency";

import {
  getPublicReservationFingerprintPayload,
  parsePublicReservationRequest,
  type PublicReservationRequest,
} from "@/lib/public-api/reservation-request";

import {
  verifyTurnstileToken,
} from "@/lib/public-api/turnstile";

export const dynamic =
  "force-dynamic";

const HOTEL_BUSINESS_TYPE_SLUG =
  "hotel";

const BUSINESS_SLUG_PATTERN =
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const MAXIMUM_BUSINESS_SLUG_LENGTH =
  100;

const MAXIMUM_REQUEST_BODY_BYTES =
  32 * 1024;

const IDEMPOTENCY_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const RESERVATION_CORS = {
  allowedMethods: [
    "POST",
    "OPTIONS",
  ],

  allowedHeaders: [
    "Content-Type",
    "Idempotency-Key",
  ],
} as const satisfies PublicCorsOptions;

const INVALID_OPTION_SELECTION_CODES =
  new Set([
    "DUPLICATE_OPTION_SELECTION",
    "SERVICE_OPTION_NOT_OPTIONAL",
    "INVALID_OPTIONAL_QUANTITY",
    "OPTIONAL_QUANTITY_BELOW_MINIMUM",
    "OPTIONAL_QUANTITY_ABOVE_MAXIMUM",
    "OPTION_PERSON_QUANTITY_EXCEEDS_GUESTS",
    "OPTION_INTERVAL_INCOMPLETE",
    "INVALID_OPTION_INTERVAL",
    "HOTEL_OPTION_HOURLY_INTERVAL_REQUIRED",
    "INVALID_OPTION_BILLING_UNITS",
  ]);

const STALE_OPTION_SELECTION_CODES =
  new Set([
    "SERVICE_OPTION_NOT_FOUND",
    "SERVICE_OPTION_NOT_ACTIVE",
    "SERVICE_OPTION_NOT_AVAILABLE_DURING_BOOKING",
  ]);

const INVALID_CONFIGURATION_CODES =
  new Set([
    "INVALID_RATE_PRICE",
    "SERVICE_RESOURCE_NOT_CONFIGURED",
    "INVALID_INCLUDED_QUANTITY",
    "INCLUDED_QUANTITY_REQUIRED",
  ]);

type RouteContext = {
  params:
    Promise<{
      businessSlug:
        string;
    }>;
};

function reservationJson(
  body: unknown,
  init: ResponseInit = {},
) {
  return publicJson(
    body,
    init,
    RESERVATION_CORS,
  );
}

function reservationError(
  status: number,
  code: string,
  error: string,
) {
  return publicError(
    status,
    code,
    error,
    RESERVATION_CORS,
  );
}

function parseBusinessSlug(
  value: string,
) {
  const businessSlug =
    value
      .trim()
      .toLowerCase();

  if (
    !businessSlug ||
    businessSlug.length >
      MAXIMUM_BUSINESS_SLUG_LENGTH ||
    !BUSINESS_SLUG_PATTERN.test(
      businessSlug,
    )
  ) {
    return null;
  }

  return businessSlug;
}

function parseIdempotencyKey(
  value: string | null,
) {
  const idempotencyKey =
    value
      ?.trim()
      .toLowerCase() ??
    "";

  return IDEMPOTENCY_KEY_PATTERN.test(
    idempotencyKey,
  )
    ? idempotencyKey
    : null;
}

function getErrorMessage(
  error: unknown,
) {
  return error instanceof Error
    ? error.message
    : null;
}

function getDatabaseErrorCode(
  error: unknown,
) {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }

  return null;
}

async function findReservationByIdempotency(
  businessId: string,
  idempotencyKey: string,
) {
  return prisma.reservation.findUnique({
    where: {
      businessId_idempotencyKey: {
        businessId,
        idempotencyKey,
      },
    },

    select: {
      idempotencyFingerprint:
        true,

      confirmationCode:
        true,

      status:
        true,

      startAt:
        true,

      endAt:
        true,

      guests:
        true,

      adults:
        true,

      children:
        true,

      expiresAt:
        true,

      subtotal:
        true,

      total:
        true,

      paymentOption:
        true,

      services: {
        select: {
          quantity:
            true,

          unitPrice:
            true,

          subtotal:
            true,

          service: {
            select: {
              id:
                true,

              slug:
                true,

              name:
                true,
            },
          },
        },
      },

      options: {
        select: {
          serviceOptionId:
            true,

          name:
            true,

          description:
            true,

          quantity:
            true,

          includedQuantity:
            true,

          optionalQuantity:
            true,

          unitPrice:
            true,

          pricingBase:
            true,

          pricingFrequency:
            true,

          billingUnits:
            true,

          subtotal:
            true,

          startAt:
            true,

          endAt:
            true,
        },
      },
    },
  });
}

type PublicReservationRecord =
  NonNullable<
    Awaited<
      ReturnType<
        typeof findReservationByIdempotency
      >
    >
  >;

type PublicBusinessRecord = {
  slug: string;
  name: string;
  currency: string;
  timezone: string;
};

function createReservationResponse(
  input: {
    business:
      PublicBusinessRecord;

    reservation:
      PublicReservationRecord;

    request:
      PublicReservationRequest;

    idempotencyKey:
      string;

    replayed:
      boolean;
  },
) {
  const total =
    Number(
      input.reservation.total,
    );

  const totalCents =
    toCents(
      total,
    );

  const requiredPaymentCents =
    getRequiredInitialPaymentCents(
      totalCents,
      input.reservation.paymentOption,
    );

  return {
    success:
      true,

    idempotency: {
      key:
        input.idempotencyKey,

      replayed:
        input.replayed,
    },

    business: {
      slug:
        input.business.slug,

      name:
        input.business.name,

      currency:
        input.business.currency,

      timezone:
        input.business.timezone,
    },

    reservation: {
      confirmationCode:
        input.reservation
          .confirmationCode,

      status:
        input.reservation.status,

      expiresAt:
        input.reservation.expiresAt
          ?.toISOString() ??
        null,

      stay: {
        checkIn:
          input.request.checkIn,

        checkOut:
          input.request.checkOut,

        startAt:
          input.reservation.startAt
            .toISOString(),

        endAt:
          input.reservation.endAt
            .toISOString(),

        nights:
          calculateHotelNights(
            input.request.checkIn,
            input.request.checkOut,
          ),
      },

      guests: {
        adults:
          input.reservation.adults,

        children:
          input.reservation.children,

        total:
          input.reservation.guests,
      },

      services:
        input.reservation.services.map(
          (item) => ({
            id:
              item.service.id,

            slug:
              item.service.slug,

            name:
              item.service.name,

            quantity:
              item.quantity,

            unitPrice:
              Number(
                item.unitPrice,
              ),

            subtotal:
              Number(
                item.subtotal,
              ),
          }),
        ),

      options:
        input.reservation.options.map(
          (item) => ({
            serviceOptionId:
              item.serviceOptionId,

            name:
              item.name,

            description:
              item.description,

            quantity:
              item.quantity,

            includedQuantity:
              item.includedQuantity,

            optionalQuantity:
              item.optionalQuantity,

            unitPrice:
              Number(
                item.unitPrice,
              ),

            pricingBase:
              item.pricingBase,

            pricingFrequency:
              item.pricingFrequency,

            billingUnits:
              Number(
                item.billingUnits,
              ),

            subtotal:
              Number(
                item.subtotal,
              ),

            startAt:
              item.startAt
                ?.toISOString() ??
              null,

            endAt:
              item.endAt
                ?.toISOString() ??
              null,
          }),
        ),

      pricing: {
        currency:
          input.business.currency,

        subtotal:
          Number(
            input.reservation.subtotal,
          ),

        total,
      },

      payment: {
        option:
          input.reservation.paymentOption,

        label:
          getPaymentOptionLabel(
            input.reservation.paymentOption,
          ),

        percentage:
          getPaymentOptionPercentage(
            input.reservation.paymentOption,
          ),

        requiredAmount:
          requiredPaymentCents ===
            null
            ? null
            : fromCents(
                requiredPaymentCents,
              ),
      },
    },
  };
}

function mapCreationError(
  error: unknown,
) {
  const errorCode =
    getErrorMessage(
      error,
    );

  if (
    errorCode ===
      "PAYMENT_OPTION_NOT_ENABLED"
  ) {
    return reservationError(
      409,
      errorCode,
      "La modalidad de pago seleccionada ya no está habilitada.",
    );
  }

  if (
    errorCode ===
      "PROSPECTIVE_INVENTORY_NOT_AVAILABLE" ||
    errorCode ===
      "SERVICE_NOT_AVAILABLE"
  ) {
    return reservationError(
      409,
      "RESERVATION_NOT_AVAILABLE",
      "El servicio o uno de sus complementos ya no está disponible para esas fechas.",
    );
  }

  if (
    errorCode &&
    INVALID_OPTION_SELECTION_CODES.has(
      errorCode,
    )
  ) {
    return reservationError(
      400,
      errorCode,
      "Una o más opciones seleccionadas no son válidas para esta reserva.",
    );
  }

  if (
    errorCode &&
    STALE_OPTION_SELECTION_CODES.has(
      errorCode,
    )
  ) {
    return reservationError(
      409,
      errorCode,
      "Una de las opciones seleccionadas ya no está disponible.",
    );
  }

  if (
    errorCode ===
      "SERVICE_NOT_FOUND"
  ) {
    return reservationError(
      404,
      errorCode,
      "El servicio seleccionado no se encuentra disponible.",
    );
  }

  if (
    errorCode ===
      "SERVICE_CAPACITY_EXCEEDED"
  ) {
    return reservationError(
      400,
      errorCode,
      "El servicio no admite esa cantidad de huéspedes.",
    );
  }

  if (
    errorCode ===
      "RATE_NOT_AVAILABLE"
  ) {
    return reservationError(
      409,
      "RESERVATION_PRICING_UNAVAILABLE",
      "No existe una tarifa disponible para todas las fechas seleccionadas.",
    );
  }

  if (
    errorCode &&
    INVALID_CONFIGURATION_CODES.has(
      errorCode,
    )
  ) {
    return reservationError(
      503,
      "RESERVATION_CONFIGURATION_UNAVAILABLE",
      "La configuración del servicio no permite crear la reserva en este momento.",
    );
  }

  if (
    getDatabaseErrorCode(
      error,
    ) ===
      "P2034"
  ) {
    return reservationError(
      409,
      "RESERVATION_CONCURRENT_MODIFICATION",
      "La disponibilidad cambió mientras se procesaba la reserva. Intenta nuevamente.",
    );
  }

  console.error(
    "POST public hotel reservation error:",
    error,
  );

  return reservationError(
    500,
    "PUBLIC_RESERVATION_CREATION_FAILED",
    "No fue posible crear la reserva.",
  );
}

export function OPTIONS() {
  return publicOptions(
    RESERVATION_CORS,
  );
}

export async function POST(
  request: NextRequest,
  context: RouteContext,
) {
  try {
    const {
      businessSlug:
        rawBusinessSlug,
    } =
      await context.params;

    const businessSlug =
      parseBusinessSlug(
        rawBusinessSlug,
      );

    if (
      !businessSlug
    ) {
      return reservationError(
        400,
        "INVALID_BUSINESS_SLUG",
        "El identificador público del negocio no es válido.",
      );
    }

    const idempotencyKey =
      parseIdempotencyKey(
        request.headers.get(
          "Idempotency-Key",
        ),
      );

    if (
      !idempotencyKey
    ) {
      return reservationError(
        400,
        "INVALID_IDEMPOTENCY_KEY",
        "Idempotency-Key es obligatorio y debe contener un UUID válido.",
      );
    }

    const contentType =
      request.headers
        .get(
          "Content-Type",
        )
        ?.split(
          ";",
        )[0]
        ?.trim()
        .toLowerCase() ??
      "";

    if (
      contentType !==
        "application/json"
    ) {
      return reservationError(
        415,
        "UNSUPPORTED_MEDIA_TYPE",
        "La solicitud debe utilizar Content-Type: application/json.",
      );
    }

    const declaredBodyLength =
      Number(
        request.headers.get(
          "Content-Length",
        ),
      );

    if (
      Number.isFinite(
        declaredBodyLength,
      ) &&
      declaredBodyLength >
        MAXIMUM_REQUEST_BODY_BYTES
    ) {
      return reservationError(
        413,
        "RESERVATION_BODY_TOO_LARGE",
        "El cuerpo de la solicitud supera el tamaño permitido.",
      );
    }

    let rawBody: string;

    try {
      rawBody =
        await request.text();
    } catch {
      return reservationError(
        400,
        "INVALID_JSON",
        "El cuerpo de la solicitud no contiene JSON válido.",
      );
    }

    if (
      new TextEncoder()
        .encode(
          rawBody,
        )
        .byteLength >
      MAXIMUM_REQUEST_BODY_BYTES
    ) {
      return reservationError(
        413,
        "RESERVATION_BODY_TOO_LARGE",
        "El cuerpo de la solicitud supera el tamaño permitido.",
      );
    }

    let parsedBody: unknown;

    try {
      parsedBody =
        JSON.parse(
          rawBody,
        );
    } catch {
      return reservationError(
        400,
        "INVALID_JSON",
        "El cuerpo de la solicitud no contiene JSON válido.",
      );
    }

    const parsedRequest =
      parsePublicReservationRequest(
        parsedBody,
      );

    if (
      !parsedRequest.success
    ) {
      return reservationError(
        400,
        parsedRequest.code,
        parsedRequest.error,
      );
    }

    const publicRequest =
      parsedRequest.request;

    let idempotencyFingerprint:
      string;

    try {
      idempotencyFingerprint =
        createPublicReservationFingerprint(
          getPublicReservationFingerprintPayload(
            businessSlug,
            publicRequest,
          ),
        );
    } catch (
      error
    ) {
      if (
        error instanceof
          PublicReservationIdempotencyConfigurationError
      ) {
        return reservationError(
          503,
          "PUBLIC_RESERVATION_IDEMPOTENCY_NOT_CONFIGURED",
          "La creación pública de reservas no está disponible en este momento.",
        );
      }

      throw error;
    }

    const business =
      await prisma.business.findFirst({
        where: {
          slug:
            businessSlug,

          isActive:
            true,

          businessType: {
            is: {
              slug:
                HOTEL_BUSINESS_TYPE_SLUG,

              isActive:
                true,
            },
          },
        },

        select: {
          id:
            true,

          slug:
            true,

          name:
            true,

          currency:
            true,

          timezone:
            true,

          checkInTime:
            true,

          checkOutTime:
            true,

          pendingReservationHoldMinutes:
            true,

          enabledPaymentOptions:
            true,
        },
      });

    if (
      !business
    ) {
      return reservationError(
        404,
        "BUSINESS_NOT_FOUND",
        "El negocio solicitado no se encuentra disponible.",
      );
    }

    const existingReservation =
      await findReservationByIdempotency(
        business.id,
        idempotencyKey,
      );

    if (
      existingReservation
    ) {
      if (
        !existingReservation
          .idempotencyFingerprint ||
        !publicReservationFingerprintsMatch(
          existingReservation
            .idempotencyFingerprint,
          idempotencyFingerprint,
        )
      ) {
        return reservationError(
          409,
          "IDEMPOTENCY_KEY_REUSED",
          "La clave de idempotencia ya fue utilizada con una solicitud diferente.",
        );
      }

      return reservationJson(
        createReservationResponse({
          business,

          reservation:
            existingReservation,

          request:
            publicRequest,

          idempotencyKey,

          replayed:
            true,
        }),
        {
          status:
            200,
        },
      );
    }

    const paymentOptionIsEnabled =
      business
        .enabledPaymentOptions
        .some(
          (paymentOption) =>
            paymentOption ===
              publicRequest
                .paymentOption,
        );

    if (
      !paymentOptionIsEnabled
    ) {
      return reservationError(
        409,
        "PAYMENT_OPTION_NOT_ENABLED",
        "La modalidad de pago seleccionada ya no está habilitada.",
      );
    }

    const turnstileVerification =
      await verifyTurnstileToken({
        token:
          publicRequest
            .turnstileToken,

        idempotencyKey,
      });

    if (
      turnstileVerification.status ===
        "configuration_error"
    ) {
      return reservationError(
        503,
        "PUBLIC_RESERVATION_SECURITY_NOT_CONFIGURED",
        "La creación pública de reservas no está disponible en este momento.",
      );
    }

    if (
      turnstileVerification.status ===
        "unavailable"
    ) {
      return reservationError(
        503,
        "PUBLIC_RESERVATION_SECURITY_UNAVAILABLE",
        "No fue posible validar la solicitud. Intenta nuevamente.",
      );
    }

    if (
      turnstileVerification.status ===
        "invalid"
    ) {
      console.warn(
        "Public reservation Turnstile validation failed:",
        {
          businessSlug,
          idempotencyKey,

          errorCodes:
            turnstileVerification
              .errorCodes,
        },
      );

      return reservationError(
        403,
        "TURNSTILE_VERIFICATION_FAILED",
        "No fue posible validar la solicitud. Actualiza la verificación e intenta nuevamente.",
      );
    }

    const startAt =
      zonedDateTimeToUtc(
        publicRequest.checkIn,
        business.checkInTime ??
          "00:00",
        business.timezone,
      );

    const endAt =
      zonedDateTimeToUtc(
        publicRequest.checkOut,
        business.checkOutTime ??
          "00:00",
        business.timezone,
      );

    try {
      const result =
        await createHotelReservation({
          business: {
            id:
              business.id,

            pendingReservationHoldMinutes:
              business
                .pendingReservationHoldMinutes,
          },

          idempotency: {
            key:
              idempotencyKey,

            fingerprint:
              idempotencyFingerprint,
          },

          serviceId:
            publicRequest.serviceId,

          customerId:
            "",

          firstName:
            publicRequest.firstName,

          lastName:
            publicRequest.lastName,

          email:
            publicRequest.email,

          phone:
            publicRequest.phone,

          checkIn:
            publicRequest.checkIn,

          checkOut:
            publicRequest.checkOut,

          startAt,
          endAt,

          adults:
            publicRequest.adults,

          children:
            publicRequest.children,

          guests:
            publicRequest.guests,

          specialRequests:
            publicRequest
              .specialRequests,

          paymentOption:
            publicRequest.paymentOption,

          source:
            "WEBSITE",

          optionSelections:
            publicRequest
              .optionSelections,
        });

      return reservationJson(
        createReservationResponse({
          business,

          reservation:
            result.reservation,

          request:
            publicRequest,

          idempotencyKey,

          replayed:
            false,
        }),
        {
          status:
            201,
        },
      );
    } catch (
      error
    ) {
      if (
        getDatabaseErrorCode(
          error,
        ) ===
          "P2002"
      ) {
        const concurrentReservation =
          await findReservationByIdempotency(
            business.id,
            idempotencyKey,
          );

        if (
          concurrentReservation
        ) {
          if (
            !concurrentReservation
              .idempotencyFingerprint ||
            !publicReservationFingerprintsMatch(
              concurrentReservation
                .idempotencyFingerprint,
              idempotencyFingerprint,
            )
          ) {
            return reservationError(
              409,
              "IDEMPOTENCY_KEY_REUSED",
              "La clave de idempotencia ya fue utilizada con una solicitud diferente.",
            );
          }

          return reservationJson(
            createReservationResponse({
              business,

              reservation:
                concurrentReservation,

              request:
                publicRequest,

              idempotencyKey,

              replayed:
                true,
            }),
            {
              status:
                200,
            },
          );
        }

        return reservationError(
          409,
          "RESERVATION_CREATION_CONFLICT",
          "La reserva no pudo crearse por un conflicto concurrente. Intenta nuevamente.",
        );
      }

      return mapCreationError(
        error,
      );
    }
  } catch (
    error
  ) {
    console.error(
      "POST public reservation request error:",
      error,
    );

    return reservationError(
      500,
      "PUBLIC_RESERVATION_REQUEST_FAILED",
      "No fue posible procesar la solicitud.",
    );
  }
}