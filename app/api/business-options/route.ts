import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  AuthorizationError,
  requireAuthenticatedUser,
  requireBusinessAccess,
} from "@/lib/auth/business-access";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const BUSINESS_OPTION_READ_ALLOWED_ROLES = [
  "OWNER",
  "ADMIN",
  "RECEPTIONIST",
] as const;

const BUSINESS_OPTION_WRITE_ALLOWED_ROLES = [
  "OWNER",
  "ADMIN",
] as const;

function privateJson(
  body: unknown,
  init: ResponseInit = {},
) {
  const headers =
    new Headers(init.headers);

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

function isJsonObject(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function optionalText(
  value: unknown,
) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  if (
    typeof value !==
    "string"
  ) {
    return null;
  }

  const normalized =
    value.trim();

  return normalized
    ? normalized
    : null;
}

function isUniqueConstraintError(
  error: unknown,
) {
  return (
    typeof error ===
      "object" &&
    error !== null &&
    "code" in error &&
    (
      error as {
        code?: unknown;
      }
    ).code ===
      "P2002"
  );
}

export async function GET(
  request: NextRequest,
) {
  try {
    await requireAuthenticatedUser();

    const businessId =
      request.nextUrl.searchParams
        .get("businessId")
        ?.trim() ?? "";

    const includeInactive =
      request.nextUrl.searchParams
        .get("includeInactive") ===
      "true";

    if (!businessId) {
      return privateJson(
        {
          success: false,
          error:
            "businessId es obligatorio",
        },
        {
          status: 400,
        },
      );
    }

    await requireBusinessAccess(
      businessId,
      BUSINESS_OPTION_READ_ALLOWED_ROLES,
    );

    const business =
      await prisma.business.findFirst({
        where: {
          id: businessId,
          isActive: true,
        },

        select: {
          id: true,
          name: true,
        },
      });

    if (!business) {
      return privateJson(
        {
          success: false,
          error:
            "Negocio no encontrado o inactivo",
        },
        {
          status: 404,
        },
      );
    }

    const options =
      await prisma.businessOption.findMany({
        where: {
          businessId,

          ...(includeInactive
            ? {}
            : {
                isActive:
                  true,
              }),
        },

        orderBy: [
          {
            category:
              "asc",
          },

          {
            name:
              "asc",
          },
        ],

        select: {
          id: true,
          businessId: true,

          name: true,
          slug: true,

          description:
            true,

          category:
            true,

          isActive:
            true,

          createdAt:
            true,

          updatedAt:
            true,

          services: {
            orderBy: {
              service: {
                name:
                  "asc",
              },
            },

            select: {
              id: true,

              isIncluded:
                true,

              isOptional:
                true,

              includedQuantity:
                true,

              minOptionalQuantity:
                true,

              maxOptionalQuantity:
                true,

              price:
                true,

              pricingBase:
                true,

              pricingFrequency:
                true,

              availableDuringBooking:
                true,

              availableAfterBooking:
                true,

              isActive:
                true,

              service: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                  isActive:
                    true,
                },
              },

              resourceTypes: {
                select: {
                  id: true,

                  requiredQuantity:
                    true,

                  resourceType: {
                    select: {
                      id: true,
                      name: true,
                      slug: true,

                      _count: {
                        select: {
                          resources: {
                            where: {
                              isActive:
                                true,
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },

          _count: {
            select: {
              reservations:
                true,
            },
          },
        },
      });

    return privateJson({
      success: true,

      business,

      items:
        options.map(
          (option) => ({
            id:
              option.id,

            businessId:
              option.businessId,

            name:
              option.name,

            slug:
              option.slug,

            description:
              option.description,

            category:
              option.category,

            isActive:
              option.isActive,

            reservationCount:
              option._count
                .reservations,

            serviceCount:
              option.services
                .length,

            activeServiceCount:
              option.services.filter(
                (
                  serviceOption,
                ) =>
                  serviceOption.isActive &&
                  serviceOption
                    .service
                    .isActive,
              ).length,

            services:
              option.services.map(
                (
                  serviceOption,
                ) => ({
                  id:
                    serviceOption.id,

                  service:
                    serviceOption.service,

                  isIncluded:
                    serviceOption.isIncluded,

                  isOptional:
                    serviceOption.isOptional,

                  includedQuantity:
                    serviceOption.includedQuantity,

                  minOptionalQuantity:
                    serviceOption.minOptionalQuantity,

                  maxOptionalQuantity:
                    serviceOption.maxOptionalQuantity,

                  price:
                    Number(
                      serviceOption.price,
                    ),

                  pricingBase:
                    serviceOption.pricingBase,

                  pricingFrequency:
                    serviceOption.pricingFrequency,

                  availableDuringBooking:
                    serviceOption.availableDuringBooking,

                  availableAfterBooking:
                    serviceOption.availableAfterBooking,

                  isActive:
                    serviceOption.isActive,

                  resourceTypes:
                    serviceOption.resourceTypes.map(
                      (
                        requirement,
                      ) => ({
                        id:
                          requirement.id,

                        requiredQuantity:
                          requirement.requiredQuantity,

                        resourceType: {
                          id:
                            requirement.resourceType
                              .id,

                          name:
                            requirement.resourceType
                              .name,

                          slug:
                            requirement.resourceType
                              .slug,

                          activeResourceCount:
                            requirement.resourceType
                              ._count
                              .resources,
                        },
                      }),
                    ),
                }),
              ),

            createdAt:
              option.createdAt,

            updatedAt:
              option.updatedAt,
          }),
        ),
    });
  } catch (error) {
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

    console.error(
      "GET /api/business-options error:",
      error,
    );

    return privateJson(
      {
        success: false,
        error:
          "No fue posible obtener las opciones del negocio",
      },
      {
        status: 500,
      },
    );
  }
}

export async function POST(
  request: NextRequest,
) {
  try {
    await requireAuthenticatedUser();

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return privateJson(
        {
          success: false,
          code: "INVALID_JSON",
          error:
            "El cuerpo de la solicitud no es JSON válido.",
        },
        {
          status: 400,
        },
      );
    }

    if (!isJsonObject(body)) {
      return privateJson(
        {
          success: false,
          code: "INVALID_BUSINESS_OPTION_BODY",
          error:
            "El cuerpo de la solicitud debe ser un objeto JSON válido.",
        },
        {
          status: 400,
        },
      );
    }

    const businessId =
      typeof body.businessId ===
      "string"
        ? body.businessId.trim()
        : "";

    const name =
      typeof body.name ===
      "string"
        ? body.name.trim()
        : "";

    const slug =
      typeof body.slug ===
      "string"
        ? body.slug
            .trim()
            .toLowerCase()
        : "";

    const description =
      optionalText(
        body.description,
      );

    const category =
      optionalText(
        body.category,
      );

    const isActive =
      body.isActive ===
      undefined
        ? true
        : body.isActive ===
            true;

    if (!businessId) {
      return privateJson(
        {
          success: false,
          error:
            "businessId es obligatorio",
        },
        {
          status: 400,
        },
      );
    }

    await requireBusinessAccess(
      businessId,
      BUSINESS_OPTION_WRITE_ALLOWED_ROLES,
    );

    if (!name) {
      return privateJson(
        {
          success: false,
          error:
            "El nombre es obligatorio",
        },
        {
          status: 400,
        },
      );
    }

    if (!slug) {
      return privateJson(
        {
          success: false,
          error:
            "El slug es obligatorio",
        },
        {
          status: 400,
        },
      );
    }

    if (
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(
        slug,
      )
    ) {
      return privateJson(
        {
          success: false,
          error:
            "El slug solo puede contener letras minúsculas, números y guiones",
        },
        {
          status: 400,
        },
      );
    }

    const result =
      await prisma.$transaction(
        async (tx) => {
          const business =
            await tx.business.findFirst({
              where: {
                id:
                  businessId,

                isActive:
                  true,
              },

              select: {
                id: true,
                name: true,
              },
            });

          if (!business) {
            throw new Error(
              "BUSINESS_NOT_FOUND",
            );
          }

          const duplicate =
            await tx.businessOption.findFirst({
              where: {
                businessId,
                slug,
              },

              select: {
                id: true,
              },
            });

          if (duplicate) {
            throw new Error(
              "OPTION_SLUG_ALREADY_EXISTS",
            );
          }

          const option =
            await tx.businessOption.create({
              data: {
                businessId,

                name,
                slug,

                description,
                category,

                isActive,
              },

              select: {
                id: true,
                businessId: true,

                name: true,
                slug: true,

                description:
                  true,

                category:
                  true,

                isActive:
                  true,

                createdAt:
                  true,

                updatedAt:
                  true,
              },
            });

          return {
            business,
            option,
          };
        },
        {
          isolationLevel:
            "Serializable",
        },
      );

    return privateJson(
      {
        success: true,

        business:
          result.business,

        item: {
          ...result.option,

          reservationCount:
            0,

          serviceCount:
            0,

          activeServiceCount:
            0,

          services:
            [],
        },
      },
      {
        status: 201,
      },
    );
  } catch (error) {
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

    console.error(
      "POST /api/business-options error:",
      error,
    );

    if (
      error instanceof Error
    ) {
      switch (
        error.message
      ) {
        case "BUSINESS_NOT_FOUND":
          return privateJson(
            {
              success: false,
              error:
                "Negocio no encontrado o inactivo",
            },
            {
              status: 404,
            },
          );

        case "OPTION_SLUG_ALREADY_EXISTS":
          return privateJson(
            {
              success: false,
              error:
                "Ya existe una opción con ese slug en el negocio",
            },
            {
              status: 409,
            },
          );
      }
    }

    if (
      isUniqueConstraintError(
        error,
      )
    ) {
      return privateJson(
        {
          success: false,
          error:
            "Ya existe una opción con ese slug en el negocio",
        },
        {
          status: 409,
        },
      );
    }

    return privateJson(
      {
        success: false,
        error:
          "No fue posible crear la opción del negocio",
      },
      {
        status: 500,
      },
    );
  }
}
