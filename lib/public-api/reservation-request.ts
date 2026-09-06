import "server-only";

import {
  isValidDateOnly,
} from "@/lib/booking/datetime";

import {
  isPaymentOption,
  type PaymentOption,
} from "@/lib/booking/payment-option";

import {
  calculateHotelNights,
} from "@/lib/booking/verticals/hotel/pricing";

import type {
  HotelOptionSelection,
} from "@/lib/booking/verticals/hotel/option-quote";

import {
  MAXIMUM_TURNSTILE_TOKEN_LENGTH,
} from "@/lib/public-api/turnstile";

const MAXIMUM_SERVICE_ID_LENGTH = 191;
const MAXIMUM_NAME_LENGTH = 100;
const MAXIMUM_EMAIL_LENGTH = 254;
const MAXIMUM_PHONE_LENGTH = 50;
const MAXIMUM_SPECIAL_REQUESTS_LENGTH = 1000;
const MAXIMUM_OPTIONS = 20;
const MAXIMUM_OPTIONAL_QUANTITY = 20;
const MAXIMUM_RESERVATION_NIGHTS = 31;
const MAXIMUM_ADULTS = 20;
const MAXIMUM_CHILDREN = 20;
const MAXIMUM_TOTAL_GUESTS = 20;

const IDENTIFIER_PATTERN =
  /^[A-Za-z0-9_-]+$/;

const EMAIL_PATTERN =
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ISO_DATETIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

const ALLOWED_REQUEST_FIELDS =
  new Set([
    "serviceId",
    "firstName",
    "lastName",
    "email",
    "phone",
    "checkIn",
    "checkOut",
    "adults",
    "children",
    "paymentOption",
    "specialRequests",
    "options",
    "turnstileToken",
  ]);

const ALLOWED_OPTION_FIELDS =
  new Set([
    "serviceOptionId",
    "optionalQuantity",
    "startAt",
    "endAt",
  ]);

export type PublicReservationRequest = {
  serviceId: string;

  firstName: string;
  lastName: string;

  email: string | null;
  phone: string | null;

  checkIn: string;
  checkOut: string;

  adults: number;
  children: number;
  guests: number;

  paymentOption: PaymentOption;

  specialRequests: string | null;

  optionSelections:
    HotelOptionSelection[];

  turnstileToken: string;
};

export type PublicReservationRequestResult =
  | {
      success: true;

      request:
        PublicReservationRequest;
    }
  | {
      success: false;

      code: string;
      error: string;
    };

function invalid(
  code: string,
  error: string,
): PublicReservationRequestResult {
  return {
    success: false,
    code,
    error,
  };
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function containsOnlyAllowedFields(
  value: Record<string, unknown>,
  allowedFields: Set<string>,
) {
  return Object.keys(value).every(
    (field) =>
      allowedFields.has(field),
  );
}

function parseOptionalText(
  value: unknown,
  maximumLength: number,
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return {
      valid: true as const,
      value: null,
    };
  }

  if (
    typeof value !== "string"
  ) {
    return {
      valid: false as const,
      value: null,
    };
  }

  const normalized =
    value.trim();

  if (
    !normalized
  ) {
    return {
      valid: true as const,
      value: null,
    };
  }

  if (
    normalized.length >
      maximumLength
  ) {
    return {
      valid: false as const,
      value: null,
    };
  }

  return {
    valid: true as const,
    value: normalized,
  };
}

function parseOptionInterval(
  startValue: unknown,
  endValue: unknown,
) {
  const hasStart =
    startValue !== undefined &&
    startValue !== null &&
    startValue !== "";

  const hasEnd =
    endValue !== undefined &&
    endValue !== null &&
    endValue !== "";

  if (
    hasStart !== hasEnd
  ) {
    return null;
  }

  if (
    !hasStart &&
    !hasEnd
  ) {
    return {
      startAt: null,
      endAt: null,
    };
  }

  if (
    typeof startValue !== "string" ||
    typeof endValue !== "string" ||
    !ISO_DATETIME_PATTERN.test(
      startValue,
    ) ||
    !ISO_DATETIME_PATTERN.test(
      endValue,
    )
  ) {
    return null;
  }

  const startAt =
    new Date(startValue);

  const endAt =
    new Date(endValue);

  if (
    Number.isNaN(startAt.getTime()) ||
    Number.isNaN(endAt.getTime()) ||
    endAt <= startAt
  ) {
    return null;
  }

  return {
    startAt,
    endAt,
  };
}

export function parsePublicReservationRequest(
  value: unknown,
): PublicReservationRequestResult {
  if (
    !isRecord(value)
  ) {
    return invalid(
      "INVALID_RESERVATION_BODY",
      "El cuerpo de la solicitud debe ser un objeto JSON válido.",
    );
  }

  if (
    !containsOnlyAllowedFields(
      value,
      ALLOWED_REQUEST_FIELDS,
    )
  ) {
    return invalid(
      "UNSUPPORTED_RESERVATION_FIELDS",
      "El cuerpo contiene campos que no están permitidos en la API pública.",
    );
  }

  const serviceId =
    typeof value.serviceId === "string"
      ? value.serviceId.trim()
      : "";

  if (
    !serviceId ||
    serviceId.length >
      MAXIMUM_SERVICE_ID_LENGTH ||
    !IDENTIFIER_PATTERN.test(
      serviceId,
    )
  ) {
    return invalid(
      "INVALID_SERVICE_ID",
      "El servicio seleccionado no es válido.",
    );
  }

  const firstName =
    typeof value.firstName === "string"
      ? value.firstName.trim()
      : "";

  const lastName =
    typeof value.lastName === "string"
      ? value.lastName.trim()
      : "";

  if (
    !firstName ||
    !lastName ||
    firstName.length >
      MAXIMUM_NAME_LENGTH ||
    lastName.length >
      MAXIMUM_NAME_LENGTH
  ) {
    return invalid(
      "INVALID_CUSTOMER_NAME",
      "Debes indicar un nombre y apellido válidos.",
    );
  }

  const parsedEmail =
    parseOptionalText(
      value.email,
      MAXIMUM_EMAIL_LENGTH,
    );

  const parsedPhone =
    parseOptionalText(
      value.phone,
      MAXIMUM_PHONE_LENGTH,
    );

  if (
    !parsedEmail.valid ||
    !parsedPhone.valid
  ) {
    return invalid(
      "INVALID_CUSTOMER_CONTACT",
      "Los datos de contacto no son válidos.",
    );
  }

  const email =
    parsedEmail.value
      ?.toLowerCase() ??
    null;

  const phone =
    parsedPhone.value;

  if (
    email &&
    !EMAIL_PATTERN.test(email)
  ) {
    return invalid(
      "INVALID_CUSTOMER_EMAIL",
      "El correo electrónico no es válido.",
    );
  }

  if (
    phone &&
    phone.length < 7
  ) {
    return invalid(
      "INVALID_CUSTOMER_PHONE",
      "El número de teléfono no es válido.",
    );
  }

  if (
    !email &&
    !phone
  ) {
    return invalid(
      "CUSTOMER_CONTACT_REQUIRED",
      "Debes indicar un correo electrónico o un número de teléfono.",
    );
  }

  const checkIn =
    typeof value.checkIn === "string"
      ? value.checkIn.trim()
      : "";

  const checkOut =
    typeof value.checkOut === "string"
      ? value.checkOut.trim()
      : "";

  if (
    !isValidDateOnly(checkIn) ||
    !isValidDateOnly(checkOut)
  ) {
    return invalid(
      "INVALID_RESERVATION_DATES",
      "checkIn y checkOut deben contener fechas válidas con formato YYYY-MM-DD.",
    );
  }

  let nights: number;

  try {
    nights =
      calculateHotelNights(
        checkIn,
        checkOut,
      );
  } catch {
    return invalid(
      "INVALID_RESERVATION_INTERVAL",
      "checkOut debe ser posterior a checkIn.",
    );
  }

  if (
    nights >
      MAXIMUM_RESERVATION_NIGHTS
  ) {
    return invalid(
      "RESERVATION_INTERVAL_TOO_LONG",
      "El período solicitado supera el máximo de 31 noches.",
    );
  }

  const adults =
    value.adults;

  const children =
    value.children;

  if (
    typeof adults !== "number" ||
    typeof children !== "number" ||
    !Number.isInteger(adults) ||
    !Number.isInteger(children) ||
    adults < 1 ||
    adults > MAXIMUM_ADULTS ||
    children < 0 ||
    children > MAXIMUM_CHILDREN ||
    adults + children >
      MAXIMUM_TOTAL_GUESTS
  ) {
    return invalid(
      "INVALID_GUEST_COUNTS",
      "La cantidad de huéspedes no es válida.",
    );
  }

  const paymentOption =
    value.paymentOption;

  if (
    !isPaymentOption(
      paymentOption,
    )
  ) {
    return invalid(
      "INVALID_PAYMENT_OPTION",
      "Debes seleccionar una modalidad de pago válida.",
    );
  }

  const parsedSpecialRequests =
    parseOptionalText(
      value.specialRequests,
      MAXIMUM_SPECIAL_REQUESTS_LENGTH,
    );

  if (
    !parsedSpecialRequests.valid
  ) {
    return invalid(
      "INVALID_SPECIAL_REQUESTS",
      "Las solicitudes especiales deben ser texto de hasta 1000 caracteres.",
    );
  }

  const rawOptions =
    value.options ??
    [];

  if (
    !Array.isArray(
      rawOptions,
    ) ||
    rawOptions.length >
      MAXIMUM_OPTIONS
  ) {
    return invalid(
      "INVALID_RESERVATION_OPTIONS",
      "Las opciones seleccionadas no son válidas.",
    );
  }

  const optionSelections:
    HotelOptionSelection[] =
    [];

  for (
    const rawOption of
    rawOptions
  ) {
    if (
      !isRecord(
        rawOption,
      ) ||
      !containsOnlyAllowedFields(
        rawOption,
        ALLOWED_OPTION_FIELDS,
      )
    ) {
      return invalid(
        "INVALID_RESERVATION_OPTION",
        "Cada opción debe contener únicamente campos públicos permitidos.",
      );
    }

    const serviceOptionId =
      typeof rawOption.serviceOptionId ===
        "string"
        ? rawOption.serviceOptionId.trim()
        : "";

    const optionalQuantity =
      rawOption.optionalQuantity;

    if (
      !serviceOptionId ||
      serviceOptionId.length >
        MAXIMUM_SERVICE_ID_LENGTH ||
      !IDENTIFIER_PATTERN.test(
        serviceOptionId,
      ) ||
      typeof optionalQuantity !==
        "number" ||
      !Number.isInteger(
        optionalQuantity,
      ) ||
      optionalQuantity < 1 ||
      optionalQuantity >
        MAXIMUM_OPTIONAL_QUANTITY
    ) {
      return invalid(
        "INVALID_RESERVATION_OPTION",
        "Cada opción debe incluir un identificador y una cantidad válidos.",
      );
    }

    const interval =
      parseOptionInterval(
        rawOption.startAt,
        rawOption.endAt,
      );

    if (
      !interval
    ) {
      return invalid(
        "INVALID_OPTION_INTERVAL",
        "El intervalo propio de una opción no es válido.",
      );
    }

    optionSelections.push({
      serviceOptionId,
      optionalQuantity,
      startAt:
        interval.startAt,
      endAt:
        interval.endAt,
    });
  }

  const turnstileToken =
    typeof value.turnstileToken ===
      "string"
      ? value.turnstileToken.trim()
      : "";

  if (
    !turnstileToken ||
    turnstileToken.length >
      MAXIMUM_TURNSTILE_TOKEN_LENGTH
  ) {
    return invalid(
      "INVALID_TURNSTILE_TOKEN",
      "La verificación de seguridad no es válida.",
    );
  }

  return {
    success: true,

    request: {
      serviceId,

      firstName,
      lastName,

      email,
      phone,

      checkIn,
      checkOut,

      adults,
      children,
      guests:
        adults +
        children,

      paymentOption,

      specialRequests:
        parsedSpecialRequests.value,

      optionSelections,

      turnstileToken,
    },
  };
}

export function getPublicReservationFingerprintPayload(
  businessSlug: string,
  request: PublicReservationRequest,
) {
  return {
    version: 1,

    businessSlug,

    serviceId:
      request.serviceId,

    customer: {
      firstName:
        request.firstName,

      lastName:
        request.lastName,

      email:
        request.email,

      phone:
        request.phone,
    },

    stay: {
      checkIn:
        request.checkIn,

      checkOut:
        request.checkOut,

      adults:
        request.adults,

      children:
        request.children,
    },

    paymentOption:
      request.paymentOption,

    specialRequests:
      request.specialRequests,

    options:
      request.optionSelections.map(
        (option) => ({
          serviceOptionId:
            option.serviceOptionId,

          optionalQuantity:
            option.optionalQuantity,

          startAt:
            option.startAt
              ?.toISOString() ??
            null,

          endAt:
            option.endAt
              ?.toISOString() ??
            null,
        }),
      ),
  };
}