import {
  isValidDateOnly,
  zonedDateTimeToUtc,
} from "@/lib/booking/datetime";

import {
  calculateHotelNights,
} from "@/lib/booking/verticals/hotel/pricing";

import {
  getHotelAvailability,
} from "@/lib/booking/verticals/hotel/availability";

import {
  NextRequest,
} from "next/server";

import {
  prisma,
} from "@/lib/prisma";

import {
  publicError,
  publicJson,
  publicOptions,
} from "@/lib/public-api/http";

export const dynamic =
  "force-dynamic";

const HOTEL_BUSINESS_TYPE_SLUG =
  "hotel";

const BUSINESS_SLUG_PATTERN =
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const MAXIMUM_BUSINESS_SLUG_LENGTH =
  100;

const MAXIMUM_AVAILABILITY_NIGHTS =
  31;

const MAXIMUM_ADULTS =
  20;

const MAXIMUM_CHILDREN =
  20;

const MAXIMUM_TOTAL_GUESTS =
  20;

type RouteContext = {
  params:
    Promise<{
      businessSlug:
        string;
    }>;
};

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

function parseGuestCount(
  value: string | null,

  fallback: number,
) {
  if (
    value ===
      null
  ) {
    return fallback;
  }

  const normalized =
    value.trim();

  if (
    !/^\d+$/.test(
      normalized,
    )
  ) {
    return null;
  }

  const parsed =
    Number(
      normalized,
    );

  if (
    !Number.isSafeInteger(
      parsed,
    )
  ) {
    return null;
  }

  return parsed;
}

function getErrorCode(
  error: unknown,
) {
  return error instanceof
    Error
    ? error.message
    : null;
}

export function OPTIONS() {
  return publicOptions();
}

export async function GET(
  request:
    NextRequest,

  context:
    RouteContext,
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
      return publicError(
        400,
        "INVALID_BUSINESS_SLUG",
        "El identificador público del negocio no es válido.",
      );
    }

    const {
      searchParams,
    } =
      request.nextUrl;

    const checkIn =
      searchParams
        .get(
          "checkIn",
        )
        ?.trim() ??
      "";

    const checkOut =
      searchParams
        .get(
          "checkOut",
        )
        ?.trim() ??
      "";

    if (
      !checkIn ||
      !checkOut ||
      !isValidDateOnly(
        checkIn,
      ) ||
      !isValidDateOnly(
        checkOut,
      )
    ) {
      return publicError(
        400,
        "INVALID_AVAILABILITY_DATES",
        "checkIn y checkOut deben contener fechas válidas con formato YYYY-MM-DD.",
      );
    }

    let nights:
      number;

    try {
      nights =
        calculateHotelNights(
          checkIn,
          checkOut,
        );
    } catch {
      return publicError(
        400,
        "INVALID_AVAILABILITY_INTERVAL",
        "checkOut debe ser posterior a checkIn.",
      );
    }

    if (
      nights >
      MAXIMUM_AVAILABILITY_NIGHTS
    ) {
      return publicJson(
        {
          success:
            false,

          code:
            "AVAILABILITY_INTERVAL_TOO_LONG",

          error:
            "El período consultado supera el máximo permitido.",

          limits: {
            maximumNights:
              MAXIMUM_AVAILABILITY_NIGHTS,
          },
        },
        {
          status:
            400,
        },
      );
    }

    const adults =
      parseGuestCount(
        searchParams.get(
          "adults",
        ),
        1,
      );

    const children =
      parseGuestCount(
        searchParams.get(
          "children",
        ),
        0,
      );

    if (
      adults ===
        null ||
      children ===
        null ||
      adults <
        1 ||
      adults >
        MAXIMUM_ADULTS ||
      children <
        0 ||
      children >
        MAXIMUM_CHILDREN ||
      adults +
        children >
        MAXIMUM_TOTAL_GUESTS
    ) {
      return publicJson(
        {
          success:
            false,

          code:
            "INVALID_GUEST_COUNTS",

          error:
            "La cantidad de huéspedes no es válida.",

          limits: {
            maximumAdults:
              MAXIMUM_ADULTS,

            maximumChildren:
              MAXIMUM_CHILDREN,

            maximumTotalGuests:
              MAXIMUM_TOTAL_GUESTS,
          },
        },
        {
          status:
            400,
        },
      );
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
        },
      });

    if (
      !business
    ) {
      return publicError(
        404,
        "BUSINESS_NOT_FOUND",
        "El negocio solicitado no se encuentra disponible.",
      );
    }

    const startAt =
      zonedDateTimeToUtc(
        checkIn,
        business.checkInTime ??
          "00:00",
        business.timezone,
      );

    const endAt =
      zonedDateTimeToUtc(
        checkOut,
        business.checkOutTime ??
          "00:00",
        business.timezone,
      );

    if (
      endAt <=
      startAt
    ) {
      return publicError(
        400,
        "INVALID_AVAILABILITY_INTERVAL",
        "checkOut debe ser posterior a checkIn.",
      );
    }

    const availability =
      await getHotelAvailability({
        businessId:
          business.id,

        startAt,

        endAt,

        checkIn,

        checkOut,

        adults,

        children,
      });

    return publicJson({
      success:
        true,

      business: {
        slug:
          business.slug,

        name:
          business.name,

        currency:
          business.currency,

        timezone:
          business.timezone,

        checkInTime:
          business.checkInTime,

        checkOutTime:
          business.checkOutTime,
      },

      search: {
        checkIn,

        checkOut,

        adults,

        children,

        totalGuests:
          adults +
          children,
      },

      stay: {
        nights,

        startAt:
          startAt.toISOString(),

        endAt:
          endAt.toISOString(),
      },

      services:
        availability.services.map(
          (
            service,
          ) => ({
            id:
              service.serviceId,

            slug:
              service.slug,

            name:
              service.name,

            description:
              service.description,

            capacity: {
              maxPeople:
                service.maxPeople,

              maxAdults:
                service.maxAdults,

              maxChildren:
                service.maxChildren,
            },

            availability: {
              available:
                service.available,
            },

            pricing: {
              currency:
                business.currency,

              nightlyPrices:
                service.pricing
                  .nightlyPrices,

              total:
                service.pricing
                  .total,
            },
          }),
        ),
    });
  } catch (
    error
  ) {
    const code =
      getErrorCode(
        error,
      );

    if (
      code ===
        "RATE_NOT_AVAILABLE" ||
      code ===
        "INVALID_RATE_PRICE"
    ) {
      return publicError(
        503,
        "AVAILABILITY_PRICING_UNAVAILABLE",
        "La disponibilidad no puede cotizarse para las fechas solicitadas.",
      );
    }

    console.error(
      "GET public hotel availability error:",
      error,
    );

    return publicError(
      500,
      "PUBLIC_AVAILABILITY_REQUEST_FAILED",
      "No fue posible consultar la disponibilidad.",
    );
  }
}
