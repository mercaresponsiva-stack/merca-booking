import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

const PRICING_BASES = new Set(["RESERVATION", "QUANTITY", "PERSON"]);

const PRICING_FREQUENCIES = new Set([
  "ONCE",
  "PER_NIGHT",
  "PER_DAY",
  "PER_HOUR",
]);

type PricingBase = "RESERVATION" | "QUANTITY" | "PERSON";

type PricingFrequency = "ONCE" | "PER_NIGHT" | "PER_DAY" | "PER_HOUR";

type ParsedServiceOption = {
  serviceId: string;

  isIncluded: boolean;
  isOptional: boolean;

  includedQuantity: number | null;

  minOptionalQuantity: number;

  maxOptionalQuantity: number | null;

  price: number;

  pricingBase: PricingBase;

  pricingFrequency: PricingFrequency;

  availableDuringBooking: boolean;

  availableAfterBooking: boolean;

  isActive: boolean;
};

function parseOptionalPositiveInteger(value: unknown, fieldName: string) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`INVALID_${fieldName}`);
  }

  return value;
}

function parseServiceOption(value: unknown): ParsedServiceOption {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("INVALID_SERVICE_CONFIGURATION");
  }

  const input = value as Record<string, unknown>;

  const serviceId =
    typeof input.serviceId === "string" ? input.serviceId.trim() : "";

  if (!serviceId) {
    throw new Error("SERVICE_ID_REQUIRED");
  }

  if (
    typeof input.isIncluded !== "boolean" ||
    typeof input.isOptional !== "boolean"
  ) {
    throw new Error("INCLUDED_OPTIONAL_BOOLEAN_REQUIRED");
  }

  const isIncluded = input.isIncluded;

  const isOptional = input.isOptional;

  if (!isIncluded && !isOptional) {
    throw new Error("SERVICE_OPTION_NOT_OFFERED");
  }

  const pricingBase =
    typeof input.pricingBase === "string" &&
    PRICING_BASES.has(input.pricingBase)
      ? (input.pricingBase as PricingBase)
      : null;

  if (!pricingBase) {
    throw new Error("INVALID_PRICING_BASE");
  }

  const pricingFrequency =
    typeof input.pricingFrequency === "string" &&
    PRICING_FREQUENCIES.has(input.pricingFrequency)
      ? (input.pricingFrequency as PricingFrequency)
      : null;

  if (!pricingFrequency) {
    throw new Error("INVALID_PRICING_FREQUENCY");
  }

  let includedQuantity = parseOptionalPositiveInteger(
    input.includedQuantity,
    "INCLUDED_QUANTITY",
  );

  if (!isIncluded) {
    includedQuantity = null;
  }

  /*
   * RESERVATION + incluido + null
   * → se podrá derivar como 1.
   *
   * PERSON + incluido + null
   * → se podrá derivar desde
   *   Reservation.guests.
   *
   * QUANTITY no tiene una cantidad
   * natural que podamos inferir.
   */
  if (isIncluded && pricingBase === "QUANTITY" && includedQuantity === null) {
    throw new Error("INCLUDED_QUANTITY_REQUIRED");
  }

  let minOptionalQuantity = 1;

  let maxOptionalQuantity: number | null = null;

  let price = 0;

  if (isOptional) {
    if (
      input.minOptionalQuantity !== undefined &&
      input.minOptionalQuantity !== null
    ) {
      if (
        typeof input.minOptionalQuantity !== "number" ||
        !Number.isInteger(input.minOptionalQuantity) ||
        input.minOptionalQuantity < 1
      ) {
        throw new Error("INVALID_MIN_OPTIONAL_QUANTITY");
      }

      minOptionalQuantity = input.minOptionalQuantity;
    }

    maxOptionalQuantity = parseOptionalPositiveInteger(
      input.maxOptionalQuantity,
      "MAX_OPTIONAL_QUANTITY",
    );

    if (
      maxOptionalQuantity !== null &&
      maxOptionalQuantity < minOptionalQuantity
    ) {
      throw new Error("INVALID_OPTIONAL_QUANTITY_RANGE");
    }

    if (input.price !== undefined && input.price !== null) {
      if (
        typeof input.price !== "number" ||
        !Number.isFinite(input.price) ||
        input.price < 0
      ) {
        throw new Error("INVALID_PRICE");
      }

      price = input.price;
    }
  }

  const availableDuringBooking =
    input.availableDuringBooking === undefined
      ? true
      : input.availableDuringBooking;

  if (typeof availableDuringBooking !== "boolean") {
    throw new Error("INVALID_AVAILABLE_DURING_BOOKING");
  }

  const availableAfterBooking =
    input.availableAfterBooking === undefined
      ? true
      : input.availableAfterBooking;

  if (typeof availableAfterBooking !== "boolean") {
    throw new Error("INVALID_AVAILABLE_AFTER_BOOKING");
  }

  const isActive = input.isActive === undefined ? true : input.isActive;

  if (typeof isActive !== "boolean") {
    throw new Error("INVALID_IS_ACTIVE");
  }

  return {
    serviceId,

    isIncluded,
    isOptional,

    includedQuantity,

    minOptionalQuantity,
    maxOptionalQuantity,

    price,

    pricingBase,
    pricingFrequency,

    availableDuringBooking,
    availableAfterBooking,

    isActive,
  };
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;

    const optionId = id.trim();

    if (!optionId) {
      return NextResponse.json(
        {
          success: false,
          error: "El id de la opción es obligatorio",
        },
        {
          status: 400,
        },
      );
    }

    const body = await request.json();

    const businessId =
      typeof body.businessId === "string" ? body.businessId.trim() : "";

    if (!businessId) {
      return NextResponse.json(
        {
          success: false,
          error: "businessId es obligatorio",
        },
        {
          status: 400,
        },
      );
    }

    if (!Array.isArray(body.services)) {
      return NextResponse.json(
        {
          success: false,
          error: "services debe ser un arreglo",
        },
        {
          status: 400,
        },
      );
    }

    let configurations: ParsedServiceOption[];

    try {
      configurations = body.services.map(parseServiceOption);
    } catch (error) {
      if (error instanceof Error) {
        const messages: Record<string, string> = {
          INVALID_SERVICE_CONFIGURATION:
            "Cada configuración de servicio debe ser un objeto válido.",

          SERVICE_ID_REQUIRED: "Cada configuración debe incluir serviceId.",

          INCLUDED_OPTIONAL_BOOLEAN_REQUIRED:
            "isIncluded e isOptional deben ser booleanos.",

          SERVICE_OPTION_NOT_OFFERED:
            "Una configuración debe ser incluida, opcional o ambas. Si no se ofrece en un servicio, omítelo del arreglo.",

          INVALID_PRICING_BASE: "pricingBase no es válido.",

          INVALID_PRICING_FREQUENCY: "pricingFrequency no es válido.",

          INVALID_INCLUDED_QUANTITY:
            "includedQuantity debe ser un entero mayor o igual a 1.",

          INCLUDED_QUANTITY_REQUIRED:
            "Las opciones incluidas con pricingBase QUANTITY requieren includedQuantity.",

          INVALID_MIN_OPTIONAL_QUANTITY:
            "minOptionalQuantity debe ser un entero mayor o igual a 1.",

          INVALID_MAX_OPTIONAL_QUANTITY:
            "maxOptionalQuantity debe ser un entero mayor o igual a 1.",

          INVALID_OPTIONAL_QUANTITY_RANGE:
            "maxOptionalQuantity no puede ser menor que minOptionalQuantity.",

          INVALID_PRICE: "price debe ser un número mayor o igual a 0.",

          INVALID_AVAILABLE_DURING_BOOKING:
            "availableDuringBooking debe ser booleano.",

          INVALID_AVAILABLE_AFTER_BOOKING:
            "availableAfterBooking debe ser booleano.",

          INVALID_IS_ACTIVE: "isActive debe ser booleano.",
        };

        return NextResponse.json(
          {
            success: false,
            error:
              messages[error.message] ??
              "La configuración de servicios no es válida.",
          },
          {
            status: 400,
          },
        );
      }

      throw error;
    }

    const serviceIds = configurations.map(
      (configuration) => configuration.serviceId,
    );

    if (new Set(serviceIds).size !== serviceIds.length) {
      return NextResponse.json(
        {
          success: false,
          error: "No puedes enviar el mismo servicio más de una vez.",
        },
        {
          status: 400,
        },
      );
    }

    const result = await prisma.$transaction(
      async (tx) => {
        const option = await tx.businessOption.findFirst({
          where: {
            id: optionId,

            businessId,
          },

          select: {
            id: true,
            name: true,
            isActive: true,

            business: {
              select: {
                id: true,
                name: true,
                isActive: true,
              },
            },
          },
        });

        if (!option) {
          throw new Error("OPTION_NOT_FOUND");
        }

        if (!option.business.isActive) {
          throw new Error("BUSINESS_NOT_ACTIVE");
        }

        if (serviceIds.length > 0) {
          const validServices = await tx.service.findMany({
            where: {
              id: {
                in: serviceIds,
              },

              businessId,
            },

            select: {
              id: true,
            },
          });

          if (validServices.length !== serviceIds.length) {
            throw new Error("SERVICE_NOT_FOUND");
          }
        }

        /*
         * El arreglo representa el estado
         * completo de servicios en los que
         * esta opción se ofrece.
         *
         * Lo que ya no venga en el arreglo
         * deja de ofrecerse.
         */
        const serviceOptionsToRemove = await tx.serviceOption.findMany({
          where: {
            optionId,

            ...(serviceIds.length > 0
              ? {
                  serviceId: {
                    notIn: serviceIds,
                  },
                }
              : {}),
          },

          select: {
            id: true,
            serviceId: true,

            service: {
              select: {
                name: true,
              },
            },
          },
        });

        if (serviceOptionsToRemove.length > 0) {
          const serviceOptionIdsToRemove = serviceOptionsToRemove.map(
            (serviceOption) => serviceOption.id,
          );

          const activeUsage = await tx.reservationOption.findFirst({
            where: {
              serviceOptionId: {
                in: serviceOptionIdsToRemove,
              },

              reservation: {
                status: {
                  in: ["PENDING", "CONFIRMED", "CHECKED_IN"],
                },
              },
            },

            select: {
              id: true,
              serviceOptionId: true,

              reservation: {
                select: {
                  id: true,
                  confirmationCode: true,
                  status: true,
                },
              },
            },
          });

          if (activeUsage) {
            throw new Error("ACTIVE_RESERVATION_OPTIONS_EXIST");
          }

          await tx.serviceOption.deleteMany({
            where: {
              id: {
                in: serviceOptionIdsToRemove,
              },
            },
          });
        }

        for (const configuration of configurations) {
          await tx.serviceOption.upsert({
            where: {
              serviceId_optionId: {
                serviceId: configuration.serviceId,

                optionId,
              },
            },

            create: {
              serviceId: configuration.serviceId,

              optionId,

              isIncluded: configuration.isIncluded,

              isOptional: configuration.isOptional,

              includedQuantity: configuration.includedQuantity,

              minOptionalQuantity: configuration.minOptionalQuantity,

              maxOptionalQuantity: configuration.maxOptionalQuantity,

              price: configuration.price,

              pricingBase: configuration.pricingBase,

              pricingFrequency: configuration.pricingFrequency,

              availableDuringBooking: configuration.availableDuringBooking,

              availableAfterBooking: configuration.availableAfterBooking,

              isActive: configuration.isActive,
            },

            update: {
              isIncluded: configuration.isIncluded,

              isOptional: configuration.isOptional,

              includedQuantity: configuration.includedQuantity,

              minOptionalQuantity: configuration.minOptionalQuantity,

              maxOptionalQuantity: configuration.maxOptionalQuantity,

              price: configuration.price,

              pricingBase: configuration.pricingBase,

              pricingFrequency: configuration.pricingFrequency,

              availableDuringBooking: configuration.availableDuringBooking,

              availableAfterBooking: configuration.availableAfterBooking,

              isActive: configuration.isActive,
            },
          });
        }

        const updated = await tx.businessOption.findUniqueOrThrow({
          where: {
            id: optionId,
          },

          select: {
            id: true,
            businessId: true,
            name: true,
            slug: true,
            description: true,
            category: true,
            isActive: true,

            services: {
              orderBy: {
                service: {
                  name: "asc",
                },
              },

              select: {
                id: true,

                isIncluded: true,

                isOptional: true,

                includedQuantity: true,

                minOptionalQuantity: true,

                maxOptionalQuantity: true,

                price: true,

                pricingBase: true,

                pricingFrequency: true,

                availableDuringBooking: true,

                availableAfterBooking: true,

                isActive: true,

                service: {
                  select: {
                    id: true,
                    name: true,
                    slug: true,
                    isActive: true,
                  },
                },

                resourceTypes: {
                  select: {
                    id: true,

                    requiredQuantity: true,

                    resourceType: {
                      select: {
                        id: true,
                        name: true,
                        slug: true,
                      },
                    },
                  },
                },
              },
            },

            _count: {
              select: {
                reservations: true,
              },
            },
          },
        });

        return {
          business: {
            id: option.business.id,

            name: option.business.name,
          },

          updated,
        };
      },
      {
        isolationLevel: "Serializable",
      },
    );

    return NextResponse.json({
      success: true,

      business: result.business,

      item: {
        id: result.updated.id,

        businessId: result.updated.businessId,

        name: result.updated.name,

        slug: result.updated.slug,

        description: result.updated.description,

        category: result.updated.category,

        isActive: result.updated.isActive,

        reservationCount: result.updated._count.reservations,

        serviceCount: result.updated.services.length,

        activeServiceCount: result.updated.services.filter(
          (serviceOption) =>
            serviceOption.isActive && serviceOption.service.isActive,
        ).length,

        services: result.updated.services.map((serviceOption) => ({
          id: serviceOption.id,

          service: serviceOption.service,

          isIncluded: serviceOption.isIncluded,

          isOptional: serviceOption.isOptional,

          includedQuantity: serviceOption.includedQuantity,

          minOptionalQuantity: serviceOption.minOptionalQuantity,

          maxOptionalQuantity: serviceOption.maxOptionalQuantity,

          price: Number(serviceOption.price),

          pricingBase: serviceOption.pricingBase,

          pricingFrequency: serviceOption.pricingFrequency,

          availableDuringBooking: serviceOption.availableDuringBooking,

          availableAfterBooking: serviceOption.availableAfterBooking,

          isActive: serviceOption.isActive,

          resourceTypes: serviceOption.resourceTypes,
        })),
      },
    });
  } catch (error) {
    console.error("PUT /api/business-options/[id]/services error:", error);

    if (error instanceof Error) {
      switch (error.message) {
        case "OPTION_NOT_FOUND":
          return NextResponse.json(
            {
              success: false,
              error: "Opción no encontrada para este negocio.",
            },
            {
              status: 404,
            },
          );

        case "BUSINESS_NOT_ACTIVE":
          return NextResponse.json(
            {
              success: false,
              error: "El negocio está inactivo.",
            },
            {
              status: 409,
            },
          );

        case "SERVICE_NOT_FOUND":
          return NextResponse.json(
            {
              success: false,
              error:
                "Uno o más servicios no existen o pertenecen a otro negocio.",
            },
            {
              status: 400,
            },
          );

        case "ACTIVE_RESERVATION_OPTIONS_EXIST":
          return NextResponse.json(
            {
              success: false,
              error:
                "No puedes retirar la opción de uno o más servicios mientras existan reservas activas usándola.",
            },
            {
              status: 409,
            },
          );
      }
    }

    return NextResponse.json(
      {
        success: false,
        error: "No fue posible configurar la opción en los servicios.",
      },
      {
        status: 500,
      },
    );
  }
}
