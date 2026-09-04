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
    serviceId: string;
  }>;
};

type RequirementInput = {
  resourceTypeId: string;
  requiredQuantity: number;
};

const ACTIVE_RESERVATION_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "CHECKED_IN",
] as const;

function parseRequirement(
  value: unknown,
): RequirementInput {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new Error(
      "INVALID_REQUIREMENT",
    );
  }

  const input =
    value as Record<
      string,
      unknown
    >;

  const resourceTypeId =
    typeof input.resourceTypeId ===
    "string"
      ? input.resourceTypeId.trim()
      : "";

  if (!resourceTypeId) {
    throw new Error(
      "RESOURCE_TYPE_ID_REQUIRED",
    );
  }

  const requiredQuantity =
    input.requiredQuantity;

  if (
    typeof requiredQuantity !==
      "number" ||
    !Number.isInteger(
      requiredQuantity,
    ) ||
    requiredQuantity < 1
  ) {
    throw new Error(
      "INVALID_REQUIRED_QUANTITY",
    );
  }

  return {
    resourceTypeId,
    requiredQuantity,
  };
}

function canonicalRequirements(
  requirements: {
    resourceTypeId: string;
    requiredQuantity: number;
  }[],
) {
  return requirements
    .map(
      (requirement) =>
        `${requirement.resourceTypeId}:${requirement.requiredQuantity}`,
    )
    .sort()
    .join("|");
}

export async function PUT(
  request: NextRequest,
  context: RouteContext,
) {
  try {
    await requireAuthenticatedUser();

    const {
      id,
      serviceId,
    } =
      await context.params;

    const optionId =
      id.trim();

    const normalizedServiceId =
      serviceId.trim();

    if (!optionId) {
      return privateJson(
        {
          success: false,
          error:
            "El id de la opción es obligatorio.",
        },
        {
          status: 400,
        },
      );
    }

    if (
      !normalizedServiceId
    ) {
      return privateJson(
        {
          success: false,
          error:
            "El id del servicio es obligatorio.",
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
          code: "INVALID_BUSINESS_OPTION_RESOURCE_TYPES_BODY",
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
            "businessId es obligatorio.",
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

    if (
      !Array.isArray(
        body.resourceTypes,
      )
    ) {
      return privateJson(
        {
          success: false,
          error:
            "resourceTypes debe ser un arreglo.",
        },
        {
          status: 400,
        },
      );
    }

    let requirements:
      RequirementInput[];

    try {
      requirements =
        body.resourceTypes.map(
          parseRequirement,
        );
    } catch (error) {
      if (
        error instanceof Error
      ) {
        const messages:
          Record<
            string,
            string
          > = {
            INVALID_REQUIREMENT:
              "Cada requisito debe ser un objeto válido.",

            RESOURCE_TYPE_ID_REQUIRED:
              "Cada requisito debe incluir resourceTypeId.",

            INVALID_REQUIRED_QUANTITY:
              "requiredQuantity debe ser un entero mayor o igual a 1.",
          };

        return privateJson(
          {
            success: false,
            error:
              messages[
                error.message
              ] ??
              "Los requisitos de inventario no son válidos.",
          },
          {
            status: 400,
          },
        );
      }

      throw error;
    }

    const resourceTypeIds =
      requirements.map(
        (requirement) =>
          requirement.resourceTypeId,
      );

    if (
      new Set(
        resourceTypeIds,
      ).size !==
      resourceTypeIds.length
    ) {
      return privateJson(
        {
          success: false,
          error:
            "No puedes enviar el mismo ResourceType más de una vez.",
        },
        {
          status: 400,
        },
      );
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
                name: true,

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

          const service =
            await tx.service.findFirst({
              where: {
                id:
                  normalizedServiceId,

                businessId,
              },

              select: {
                id: true,
                name: true,
                slug: true,
                isActive:
                  true,
              },
            });

          if (!service) {
            throw new Error(
              "SERVICE_NOT_FOUND",
            );
          }

          const serviceOption =
            await tx.serviceOption.findUnique({
              where: {
                serviceId_optionId: {
                  serviceId:
                    normalizedServiceId,

                  optionId,
                },
              },

              select: {
                id: true,

                resourceTypes: {
                  select: {
                    resourceTypeId:
                      true,

                    requiredQuantity:
                      true,
                  },
                },
              },
            });

          if (!serviceOption) {
            throw new Error(
              "SERVICE_OPTION_NOT_FOUND",
            );
          }

          if (
            resourceTypeIds.length >
            0
          ) {
            const validResourceTypes =
              await tx.resourceType.findMany({
                where: {
                  id: {
                    in:
                      resourceTypeIds,
                  },

                  businessId,
                },

                select: {
                  id: true,
                },
              });

            if (
              validResourceTypes.length !==
              resourceTypeIds.length
            ) {
              throw new Error(
                "RESOURCE_TYPE_NOT_FOUND",
              );
            }
          }

          const currentCanonical =
            canonicalRequirements(
              serviceOption.resourceTypes,
            );

          const requestedCanonical =
            canonicalRequirements(
              requirements,
            );

          const requirementsChanged =
            currentCanonical !==
            requestedCanonical;

          if (
            requirementsChanged
          ) {
            const activeReservationOptions =
              await tx.reservationOption.count({
                where: {
                  serviceOptionId:
                    serviceOption.id,

                  reservation: {
                    status: {
                      in: [
                        ...ACTIVE_RESERVATION_STATUSES,
                      ],
                    },
                  },
                },
              });

            if (
              activeReservationOptions >
              0
            ) {
              throw new Error(
                "ACTIVE_RESERVATION_OPTIONS_EXIST",
              );
            }
          }

          if (
            requirementsChanged
          ) {
            await tx.serviceOptionResourceType.deleteMany({
              where: {
                serviceOptionId:
                  serviceOption.id,
              },
            });

            if (
              requirements.length >
              0
            ) {
              await tx.serviceOptionResourceType.createMany({
                data:
                  requirements.map(
                    (
                      requirement,
                    ) => ({
                      serviceOptionId:
                        serviceOption.id,

                      resourceTypeId:
                        requirement.resourceTypeId,

                      requiredQuantity:
                        requirement.requiredQuantity,
                    }),
                  ),
              });
            }
          }

          const updated =
            await tx.serviceOption.findUniqueOrThrow({
              where: {
                id:
                  serviceOption.id,
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

                option: {
                  select: {
                    id: true,
                    name: true,
                    slug: true,
                    isActive:
                      true,
                  },
                },

                resourceTypes: {
                  orderBy: {
                    resourceType: {
                      name:
                        "asc",
                    },
                  },

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
            });

          return {
            business: {
              id:
                option.business.id,

              name:
                option.business.name,
            },

            item: {
              id:
                updated.id,

              service:
                updated.service,

              option:
                updated.option,

              isIncluded:
                updated.isIncluded,

              isOptional:
                updated.isOptional,

              includedQuantity:
                updated.includedQuantity,

              minOptionalQuantity:
                updated.minOptionalQuantity,

              maxOptionalQuantity:
                updated.maxOptionalQuantity,

              price:
                Number(
                  updated.price,
                ),

              pricingBase:
                updated.pricingBase,

              pricingFrequency:
                updated.pricingFrequency,

              isActive:
                updated.isActive,

              resourceTypes:
                updated.resourceTypes.map(
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
            },
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

      item:
        result.item,
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
      "PUT /api/business-options/[id]/services/[serviceId]/resource-types error:",
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
                "Opción no encontrada para este negocio.",
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
                "El negocio está inactivo.",
            },
            {
              status: 409,
            },
          );

        case "SERVICE_NOT_FOUND":
          return privateJson(
            {
              success: false,
              error:
                "Servicio no encontrado para este negocio.",
            },
            {
              status: 404,
            },
          );

        case "SERVICE_OPTION_NOT_FOUND":
          return privateJson(
            {
              success: false,
              error:
                "La opción no está configurada para este servicio.",
            },
            {
              status: 404,
            },
          );

        case "RESOURCE_TYPE_NOT_FOUND":
          return privateJson(
            {
              success: false,
              error:
                "Uno o más ResourceType no existen o pertenecen a otro negocio.",
            },
            {
              status: 400,
            },
          );

        case "ACTIVE_RESERVATION_OPTIONS_EXIST":
          return privateJson(
            {
              success: false,
              error:
                "No puedes cambiar los requisitos físicos mientras existan reservas activas usando esta opción.",
            },
            {
              status: 409,
            },
          );
      }
    }

    return privateJson(
      {
        success: false,
        error:
          "No fue posible actualizar los requisitos físicos de la opción.",
      },
      {
        status: 500,
      },
    );
  }
}
