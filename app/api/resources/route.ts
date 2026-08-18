import { NextRequest, NextResponse } from "next/server";

import { ACTIVE_RESERVATION_STATUSES } from "@/lib/booking/reservation-state";

import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;

    const businessId = searchParams.get("businessId")?.trim() ?? "";

    const resourceTypeId = searchParams.get("resourceTypeId")?.trim() ?? "";

    const includeInactive = searchParams.get("includeInactive") === "true";

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

    const business = await prisma.business.findFirst({
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
      return NextResponse.json(
        {
          success: false,
          error: "Negocio no encontrado o inactivo",
        },
        {
          status: 404,
        },
      );
    }

    if (resourceTypeId) {
      const resourceType = await prisma.resourceType.findFirst({
        where: {
          id: resourceTypeId,
          businessId,
        },

        select: {
          id: true,
        },
      });

      if (!resourceType) {
        return NextResponse.json(
          {
            success: false,
            error: "Tipo de recurso no encontrado para este negocio",
          },
          {
            status: 404,
          },
        );
      }
    }

    const resources = await prisma.resource.findMany({
      where: {
        businessId,

        ...(!includeInactive
          ? {
              isActive: true,
            }
          : {}),

        ...(resourceTypeId
          ? {
              resourceTypeId,
            }
          : {}),
      },

      orderBy: [
        {
          resourceType: {
            name: "asc",
          },
        },
        {
          code: "asc",
        },
        {
          name: "asc",
        },
      ],

      select: {
        id: true,

        name: true,
        code: true,

        resourceTypeId: true,

        floor: true,
        capacity: true,

        isActive: true,

        createdAt: true,
        updatedAt: true,

        resourceType: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },

        /*
         * Solo necesitamos las asignaciones
         * que siguen consumiendo inventario.
         *
         * Las reservas históricas continúan
         * relacionadas en la base, pero no
         * impiden desactivar el Resource.
         */
        reservations: {
          where: {
            reservation: {
              businessId,

              status: {
                in: [...ACTIVE_RESERVATION_STATUSES],
              },
            },
          },

          select: {
            id: true,

            reservation: {
              select: {
                id: true,

                confirmationCode: true,

                status: true,

                startAt: true,
                endAt: true,

                customer: {
                  select: {
                    id: true,

                    firstName: true,

                    lastName: true,
                  },
                },
              },
            },
          },

          orderBy: {
            reservation: {
              startAt: "asc",
            },
          },
        },
      },
    });

    return NextResponse.json({
      success: true,

      business,

      resourceTypeId: resourceTypeId || null,

      includeInactive,

      items: resources.map((resource) => ({
        id: resource.id,

        name: resource.name,
        code: resource.code,

        resourceTypeId: resource.resourceTypeId,

        floor: resource.floor,
        capacity: resource.capacity,

        isActive: resource.isActive,

        createdAt: resource.createdAt,

        updatedAt: resource.updatedAt,

        resourceType: resource.resourceType,

        activeReservationCount: resource.reservations.length,

        activeReservations: resource.reservations.map((assignment) => ({
          assignmentId: assignment.id,

          id: assignment.reservation.id,

          confirmationCode: assignment.reservation.confirmationCode,

          status: assignment.reservation.status,

          startAt: assignment.reservation.startAt,

          endAt: assignment.reservation.endAt,

          customer: assignment.reservation.customer,
        })),
      })),
    });
  } catch (error) {
    console.error("GET /api/resources error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "No fue posible obtener los recursos",
      },
      {
        status: 500,
      },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const businessId =
      typeof body.businessId === "string" ? body.businessId.trim() : "";

    const name = typeof body.name === "string" ? body.name.trim() : "";

    const code = typeof body.code === "string" ? body.code.trim() : "";

    const resourceTypeId =
      typeof body.resourceTypeId === "string" ? body.resourceTypeId.trim() : "";

    const floor =
      body.floor === null || body.floor === "" || body.floor === undefined
        ? null
        : Number(body.floor);

    const capacity = Number(body.capacity);

    const isActive = body.isActive === undefined ? true : body.isActive;

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

    if (!name) {
      return NextResponse.json(
        {
          success: false,
          error: "El nombre del recurso es obligatorio",
        },
        {
          status: 400,
        },
      );
    }

    if (!resourceTypeId) {
      return NextResponse.json(
        {
          success: false,
          error: "resourceTypeId es obligatorio",
        },
        {
          status: 400,
        },
      );
    }

    if (floor !== null && (!Number.isInteger(floor) || floor < 0)) {
      return NextResponse.json(
        {
          success: false,
          error: "El piso debe ser un entero mayor o igual a 0",
        },
        {
          status: 400,
        },
      );
    }

    if (!Number.isInteger(capacity) || capacity < 1) {
      return NextResponse.json(
        {
          success: false,
          error: "La capacidad debe ser un entero mayor o igual a 1",
        },
        {
          status: 400,
        },
      );
    }

    if (typeof isActive !== "boolean") {
      return NextResponse.json(
        {
          success: false,
          error: "isActive debe ser booleano",
        },
        {
          status: 400,
        },
      );
    }

    const createdResource = await prisma.$transaction(
      async (tx) => {
        const business = await tx.business.findFirst({
          where: {
            id: businessId,
            isActive: true,
          },

          select: {
            id: true,
          },
        });

        if (!business) {
          throw new Error("BUSINESS_NOT_FOUND");
        }

        const resourceType = await tx.resourceType.findFirst({
          where: {
            id: resourceTypeId,
            businessId,
          },

          select: {
            id: true,
          },
        });

        if (!resourceType) {
          throw new Error("RESOURCE_TYPE_NOT_FOUND");
        }

        /*
         * El código puede ser null,
         * pero si existe debe ser único
         * dentro del Business.
         */
        if (code) {
          const duplicateCode = await tx.resource.findFirst({
            where: {
              businessId,
              code,
            },

            select: {
              id: true,
            },
          });

          if (duplicateCode) {
            throw new Error("RESOURCE_CODE_ALREADY_EXISTS");
          }
        }

        return tx.resource.create({
          data: {
            businessId,

            name,

            code: code || null,

            resourceTypeId,

            floor,

            capacity,

            isActive,
          },

          select: {
            id: true,
            businessId: true,

            name: true,
            code: true,

            resourceTypeId: true,

            floor: true,
            capacity: true,

            isActive: true,

            createdAt: true,
            updatedAt: true,

            resourceType: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
          },
        });
      },
      {
        isolationLevel: "Serializable",
      },
    );

    return NextResponse.json(
      {
        success: true,

        resource: {
          ...createdResource,

          activeReservationCount: 0,

          activeReservations: [],
        },
      },
      {
        status: 201,
      },
    );
  } catch (error) {
    console.error("POST /api/resources error:", error);

    if (error instanceof Error) {
      switch (error.message) {
        case "BUSINESS_NOT_FOUND":
          return NextResponse.json(
            {
              success: false,
              error: "Negocio no encontrado o inactivo",
            },
            {
              status: 404,
            },
          );

        case "RESOURCE_TYPE_NOT_FOUND":
          return NextResponse.json(
            {
              success: false,
              error: "Tipo de recurso no encontrado para este negocio",
            },
            {
              status: 404,
            },
          );

        case "RESOURCE_CODE_ALREADY_EXISTS":
          return NextResponse.json(
            {
              success: false,
              error: "Ya existe otro recurso con ese código",
            },
            {
              status: 409,
            },
          );
      }
    }

    /*
     * Protección adicional si la base
     * también tiene una restricción
     * UNIQUE para el código.
     */
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (
        error as {
          code?: string;
        }
      ).code === "P2002"
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Ya existe otro recurso con ese código",
        },
        {
          status: 409,
        },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: "No fue posible crear el recurso",
      },
      {
        status: 500,
      },
    );
  }
}
