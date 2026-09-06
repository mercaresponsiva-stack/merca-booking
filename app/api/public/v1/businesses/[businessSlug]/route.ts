import {
  NextRequest,
} from "next/server";

import {
  prisma,
} from "@/lib/prisma";

import {
  getPaymentOptionLabel,
  getPaymentOptionPercentage,
} from "@/lib/booking/payment-option";

import {
  PUBLIC_CATALOG_CACHE,
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

export function OPTIONS() {
  return publicOptions();
}

export async function GET(
  request:
    NextRequest,

  context:
    RouteContext,
) {
  void request;

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
          slug:
            true,

          name:
            true,

          description:
            true,

          email:
            true,

          phone:
            true,

          address:
            true,

          city:
            true,

          country:
            true,

          currency:
            true,

          enabledPaymentOptions:
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

    return publicJson(
      {
        success:
          true,

        business: {
          slug:
            business.slug,

          name:
            business.name,

          description:
            business.description,

          currency:
            business.currency,

          paymentOptions:
            business
              .enabledPaymentOptions
              .map(
                (paymentOption) => ({
                  value:
                    paymentOption,

                  label:
                    getPaymentOptionLabel(
                      paymentOption,
                    ),

                  percentage:
                    getPaymentOptionPercentage(
                      paymentOption,
                    ),
                }),
              ),

          timezone:
            business.timezone,

          contact: {
            email:
              business.email,

            phone:
              business.phone,
          },

          location: {
            address:
              business.address,

            city:
              business.city,

            country:
              business.country,
          },

          stay: {
            checkInTime:
              business.checkInTime,

            checkOutTime:
              business.checkOutTime,
          },
        },
      },
      {
        headers: {
          "Cache-Control":
            PUBLIC_CATALOG_CACHE,
        },
      },
    );
  } catch (
    error
  ) {
    console.error(
      "GET public business catalog error:",
      error,
    );

    return publicError(
      500,
      "PUBLIC_BUSINESS_REQUEST_FAILED",
      "No fue posible obtener la información pública del negocio.",
    );
  }
}
