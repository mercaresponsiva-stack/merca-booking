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

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

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

export async function PATCH(
  request: NextRequest,
  context: RouteContext,
) {
  try {
    await requireAuthenticatedUser();

    const {
      id,
    } =
      await context.params;

    const optionId =
      id.trim();

    if (!optionId) {
      return privateJson(
        {
          success: false,
          error:
            "El id de la opción es obligatorio",
        },
        {
          status: 400,
        },
      );
    }

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

    const hasName =
      Object.prototype.hasOwnProperty.call(
        body,
        "name",
      );

    const hasSlug =
      Object.prototype.hasOwnProperty.call(
        body,
        "slug",
      );

    const hasDescription =
      Object.prototype.hasOwnProperty.call(
        body,
        "description",
      );

    const hasCategory =
      Object.prototype.hasOwnProperty.call(
        body,
        "category",
      );

    const hasIsActive =
      Object.prototype.hasOwnProperty.call(
        body,
        "isActive",
      );

    if (
      !hasName &&
      !hasSlug &&
      !hasDescription &&
      !hasCategory &&
      !hasIsActive
    ) {
      return privateJson(
        {
          success: false,
          error:
            "Debes indicar al menos un campo para actualizar",
        },
        {
          status: 400,
        },
      );
    }

    const data: {
      name?: string;
      slug?: string;
      description?: string | null;
      category?: string | null;
      isActive?: boolean;
    } = {};

    if (hasName) {
      if (
        typeof body.name !==
        "string"
      ) {
        return privateJson(
          {
            success: false,
            error:
              "El nombre no es válido",
          },
          {
            status: 400,
          },
        );
      }

      const name =
        body.name.trim();

      if (!name) {
        return privateJson(
          {
            success: false,
            error:
              "El nombre no puede estar vacío",
          },
          {
            status: 400,
          },
        );
      }

      data.name =
        name;
    }

    if (hasSlug) {
      if (
        typeof body.slug !==
        "string"
      ) {
        return privateJson(
          {
            success: false,
            error:
              "El slug no es válido",
          },
          {
            status: 400,
          },
        );
      }

      const slug =
        body.slug
          .trim()
          .toLowerCase();

      if (!slug) {
        return privateJson(
          {
            success: false,
            error:
              "El slug no puede estar vacío",
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

      data.slug =
        slug;
    }

    if (hasDescription) {
      if (
        body.description !==
          null &&
        typeof body.description !==
          "string"
      ) {
        return privateJson(
          {
            success: false,
            error:
              "La descripción no es válida",
          },
          {
            status: 400,
          },
        );
      }

      data.description =
        typeof body.description ===
        "string"
          ? (
              body.description.trim() ||
              null
            )
          : null;
    }

    if (hasCategory) {
      if (
        body.category !==
          null &&
        typeof body.category !==
          "string"
      ) {
        return privateJson(
          {
            success: false,
            error:
              "La categoría no es válida",
          },
          {
            status: 400,
          },
        );
      }

      data.category =
        typeof body.category ===
        "string"
          ? (
              body.category.trim() ||
              null
            )
          : null;
    }

    if (hasIsActive) {
      if (
        typeof body.isActive !==
        "boolean"
      ) {
        return privateJson(
          {
            success: false,
            error:
              "isActive debe ser booleano",
          },
          {
            status: 400,
          },
        );
      }

      data.isActive =
        body.isActive;
    }

    const result =
      await prisma.$transaction(
        async (tx) => {
          const option =
            await tx.businessOption.findFirst({
              where: {
                id:
                  optionId,

                businessId,
              },

              select: {
                id: true,
                businessId: true,

                name: true,
                slug: true,

                business: {
                  select: {
                    id: true,
                    name: true,
                    isActive:
                      true,
                  },
                },
              },
            });

          if (!option) {
            throw new Error(
              "OPTION_NOT_FOUND",
            );
          }

          if (
            !option.business
              .isActive
          ) {
            throw new Error(
              "BUSINESS_NOT_ACTIVE",
            );
          }

          if (
            data.slug &&
            data.slug !==
              option.slug
          ) {
            const duplicate =
              await tx.businessOption.findFirst({
                where: {
                  businessId,

                  slug:
                    data.slug,

                  NOT: {
                    id:
                      optionId,
                  },
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
          }

          const updated =
            await tx.businessOption.update({
              where: {
                id:
                  optionId,
              },

              data,

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
                  select: {
                    id: true,

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

          return {
            business: {
              id:
                option.business.id,

              name:
                option.business.name,
            },

            updated,
          };
        },
        {
          isolationLevel:
            "Serializable",
        },
      );

    return privateJson({
      success: true,

      business:
        result.business,

      item: {
        id:
          result.updated.id,

        businessId:
          result.updated.businessId,

        name:
          result.updated.name,

        slug:
          result.updated.slug,

        description:
          result.updated.description,

        category:
          result.updated.category,

        isActive:
          result.updated.isActive,

        reservationCount:
          result.updated
            ._count
            .reservations,

        serviceCount:
          result.updated
            .services
            .length,

        activeServiceCount:
          result.updated
            .services
            .filter(
              (
                serviceOption,
              ) =>
                serviceOption.isActive &&
                serviceOption
                  .service
                  .isActive,
            )
            .length,

        createdAt:
          result.updated.createdAt,

        updatedAt:
          result.updated.updatedAt,
      },
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
      "PATCH /api/business-options/[id] error:",
      error,
    );

    if (
      error instanceof Error
    ) {
      switch (
        error.message
      ) {
        case "OPTION_NOT_FOUND":
          return privateJson(
            {
              success: false,
              error:
                "Opción no encontrada para este negocio",
            },
            {
              status: 404,
            },
          );

        case "BUSINESS_NOT_ACTIVE":
          return privateJson(
            {
              success: false,
              error:
                "El negocio está inactivo",
            },
            {
              status: 409,
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
          "No fue posible actualizar la opción del negocio",
      },
      {
        status: 500,
      },
    );
  }
}
