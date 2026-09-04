import { NextRequest, NextResponse } from "next/server";

import {
  getPaymentOptionLabel,
  getPaymentOptionPercentage,
  isPaymentOption,
  PAYMENT_OPTIONS,
  type PaymentOption,
} from "@/lib/booking/payment-option";
import {
  AuthorizationError,
  requireAuthenticatedUser,
  requireBusinessAccess,
  type BusinessAccess,
} from "@/lib/auth/business-access";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

const PAYMENT_OPTIONS_READ_ROLES = [
  "OWNER",
  "ADMIN",
  "RECEPTIONIST",
] as const;

const PAYMENT_OPTIONS_WRITE_ROLES = [
  "OWNER",
  "ADMIN",
] as const;

function privateJson(
  body: unknown,
  init: ResponseInit = {},
) {
  const headers = new Headers(init.headers);

  headers.set(
    "Cache-Control",
    "private, no-store, max-age=0, must-revalidate",
  );
  headers.set("Pragma", "no-cache");
  headers.set("Expires", "0");
  headers.set("X-Robots-Tag", "noindex, nofollow");

  return NextResponse.json(body, {
    ...init,
    headers,
  });
}

function isJsonObject(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function serializePaymentOptions(
  access: BusinessAccess,
  business: {
    id: string;
    name: string;
    enabledPaymentOptions: readonly PaymentOption[];
  },
) {
  return {
    success: true,

    business: {
      id: business.id,
      name: business.name,
      enabledPaymentOptions: [
        ...business.enabledPaymentOptions,
      ],
    },

    options: PAYMENT_OPTIONS.map((value) => ({
      value,
      label: getPaymentOptionLabel(value),
      percentage: getPaymentOptionPercentage(value),
    })),

    permissions: {
      canEdit:
        access.role === "OWNER" ||
        access.role === "ADMIN",
    },
  };
}

function handleRouteError(
  error: unknown,
  operation: "GET" | "PATCH",
) {
  if (error instanceof AuthorizationError) {
    return privateJson(
      {
        success: false,
        code: error.code,
        error: error.message,
      },
      {
        status: error.status,
      },
    );
  }

  if (
    error instanceof Error &&
    error.message ===
      "BUSINESS_PAYMENT_OPTIONS_NOT_FOUND"
  ) {
    return privateJson(
      {
        success: false,
        code: error.message,
        error:
          "No fue posible encontrar la configuración del negocio.",
      },
      {
        status: 404,
      },
    );
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2034"
  ) {
    return privateJson(
      {
        success: false,
        code:
          "BUSINESS_PAYMENT_OPTIONS_CONCURRENT_MODIFICATION",
        error:
          "La configuración cambió mientras se guardaba. Consulta nuevamente e inténtalo otra vez.",
      },
      {
        status: 409,
      },
    );
  }

  console.error(
    `${operation} business payment options error:`,
    error,
  );

  return privateJson(
    {
      success: false,
      code: "BUSINESS_PAYMENT_OPTIONS_FAILED",
      error:
        "No fue posible procesar la configuración de modalidades de pago.",
    },
    {
      status: 500,
    },
  );
}

export async function GET(
  _request: NextRequest,
  context: RouteContext,
) {
  try {
    await requireAuthenticatedUser();

    const { id: businessId } = await context.params;

    const access = await requireBusinessAccess(
      businessId,
      PAYMENT_OPTIONS_READ_ROLES,
    );

    const business = await prisma.business.findFirst({
      where: {
        id: access.business.id,
        isActive: true,
      },

      select: {
        id: true,
        name: true,
        enabledPaymentOptions: true,
      },
    });

    if (!business) {
      throw new Error(
        "BUSINESS_PAYMENT_OPTIONS_NOT_FOUND",
      );
    }

    return privateJson(
      serializePaymentOptions(access, business),
    );
  } catch (error) {
    return handleRouteError(error, "GET");
  }
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext,
) {
  try {
    await requireAuthenticatedUser();

    const { id: businessId } = await context.params;

    const access = await requireBusinessAccess(
      businessId,
      PAYMENT_OPTIONS_WRITE_ROLES,
    );

    let rawBody: unknown;

    try {
      rawBody = await request.json();
    } catch {
      return privateJson(
        {
          success: false,
          code: "INVALID_JSON",
          error:
            "El cuerpo de la solicitud debe ser JSON válido.",
        },
        {
          status: 400,
        },
      );
    }

    if (!isJsonObject(rawBody)) {
      return privateJson(
        {
          success: false,
          code: "INVALID_PAYMENT_OPTIONS_BODY",
          error:
            "El cuerpo de la solicitud debe ser un objeto JSON válido.",
        },
        {
          status: 400,
        },
      );
    }

    const rawOptions =
      rawBody.enabledPaymentOptions;

    if (!Array.isArray(rawOptions)) {
      return privateJson(
        {
          success: false,
          code: "INVALID_PAYMENT_OPTIONS",
          error:
            "enabledPaymentOptions debe ser un arreglo.",
        },
        {
          status: 400,
        },
      );
    }

    if (rawOptions.length === 0) {
      return privateJson(
        {
          success: false,
          code: "PAYMENT_OPTIONS_REQUIRED",
          error:
            "Debes mantener al menos una modalidad de pago habilitada.",
        },
        {
          status: 400,
        },
      );
    }

    if (
      rawOptions.length >
      PAYMENT_OPTIONS.length
    ) {
      return privateJson(
        {
          success: false,
          code: "INVALID_PAYMENT_OPTIONS",
          error:
            "La configuración contiene más modalidades de las admitidas.",
        },
        {
          status: 400,
        },
      );
    }

    const enabledPaymentOptions: PaymentOption[] = [];
    const uniqueOptions = new Set<PaymentOption>();

    for (const rawOption of rawOptions) {
      if (!isPaymentOption(rawOption)) {
        return privateJson(
          {
            success: false,
            code: "INVALID_PAYMENT_OPTION",
            error:
              "La configuración contiene una modalidad de pago no válida.",
          },
          {
            status: 400,
          },
        );
      }

      if (uniqueOptions.has(rawOption)) {
        return privateJson(
          {
            success: false,
            code: "DUPLICATE_PAYMENT_OPTION",
            error:
              "Una modalidad de pago no puede aparecer más de una vez.",
          },
          {
            status: 400,
          },
        );
      }

      uniqueOptions.add(rawOption);
      enabledPaymentOptions.push(rawOption);
    }

    const business = await prisma.$transaction(
      async (tx) => {
        const updateResult =
          await tx.business.updateMany({
            where: {
              id: access.business.id,
              isActive: true,
            },

            data: {
              enabledPaymentOptions,
            },
          });

        if (updateResult.count !== 1) {
          throw new Error(
            "BUSINESS_PAYMENT_OPTIONS_NOT_FOUND",
          );
        }

        const updatedBusiness =
          await tx.business.findFirst({
            where: {
              id: access.business.id,
              isActive: true,
            },

            select: {
              id: true,
              name: true,
              enabledPaymentOptions: true,
            },
          });

        if (!updatedBusiness) {
          throw new Error(
            "BUSINESS_PAYMENT_OPTIONS_NOT_FOUND",
          );
        }

        return updatedBusiness;
      },
      {
        isolationLevel: "Serializable",
      },
    );

    return privateJson(
      serializePaymentOptions(access, business),
    );
  } catch (error) {
    return handleRouteError(error, "PATCH");
  }
}