import { NextRequest, NextResponse } from "next/server";

import { ACTIVE_RESERVATION_STATUSES } from "@/lib/booking/reservation-state";

import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type CapacityConflict = {
  id: string;

  confirmationCode: string;
  status: string;

  guests: number;
  adults: number | null;
  children: number | null;

  startAt: Date;
  endAt: Date;

  violations: string[];
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;

    const body = await request.json();

    const businessId =
      typeof body.businessId === "string" ? body.businessId.trim() : "";

    const name = typeof body.name === "string" ? body.name.trim() : "";

    const slug = typeof body.slug === "string" ? body.slug.trim() : "";

    const description =
      typeof body.description === "string" ? body.description.trim() : "";

    const durationMinutes =
      body.durationMinutes === null ||
      body.durationMinutes === "" ||
      body.durationMinutes === undefined
        ? null
        : Number(body.durationMinutes);

    const maxPeople = Number(body.maxPeople);

    const maxAdults =
      body.maxAdults === null ||
      body.maxAdults === "" ||
      body.maxAdults === undefined
        ? null
        : Number(body.maxAdults);

    const maxChildren =
      body.maxChildren === null ||
      body.maxChildren === "" ||
      body.maxChildren === undefined
        ? null
        : Number(body.maxChildren);

    const isActive = body.isActive;

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
          error: "El nombre del servicio es obligatorio",
        },
        {
          status: 400,
        },
      );
    }

    if (!slug) {
      return NextResponse.json(
        {
          success: false,
          error: "El slug del servicio es obligatorio",
        },
        {
          status: 400,
        },
      );
    }

    if (
      durationMinutes !== null &&
      (!Number.isInteger(durationMinutes) || durationMinutes < 1)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "La duración debe ser un entero mayor o igual a 1",
        },
        {
          status: 400,
        },
      );
    }

    if (!Number.isInteger(maxPeople) || maxPeople < 1) {
      return NextResponse.json(
        {
          success: false,
          error: "La capacidad máxima debe ser un entero mayor o igual a 1",
        },
        {
          status: 400,
        },
      );
    }

    if (maxAdults !== null && (!Number.isInteger(maxAdults) || maxAdults < 0)) {
      return NextResponse.json(
        {
          success: false,
          error:
            "La cantidad máxima de adultos debe ser un entero mayor o igual a 0",
        },
        {
          status: 400,
        },
      );
    }

    if (
      maxChildren !== null &&
      (!Number.isInteger(maxChildren) || maxChildren < 0)
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "La cantidad máxima de niños debe ser un entero mayor o igual a 0",
        },
        {
          status: 400,
        },
      );
    }

    if (maxAdults !== null && maxAdults > maxPeople) {
      return NextResponse.json(
        {
          success: false,
          error:
            "La cantidad máxima de adultos no puede superar la capacidad total",
        },
        {
          status: 400,
        },
      );
    }

    if (maxChildren !== null && maxChildren > maxPeople) {
      return NextResponse.json(
        {
          success: false,
          error:
            "La cantidad máxima de niños no puede superar la capacidad total",
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

    const result = await prisma.$transaction(
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

        const service = await tx.service.findFirst({
          where: {
            id,
            businessId,
          },

          select: {
            id: true,

            maxPeople: true,
            maxAdults: true,
            maxChildren: true,
          },
        });

        if (!service) {
          throw new Error("SERVICE_NOT_FOUND");
        }

        const duplicateSlug = await tx.service.findFirst({
          where: {
            businessId,
            slug,

            id: {
              not: id,
            },
          },

          select: {
            id: true,
          },
        });

        if (duplicateSlug) {
          throw new Error("SERVICE_SLUG_ALREADY_EXISTS");
        }

        /*
         * Solo necesitamos revisar
         * reservas existentes si alguna
         * capacidad se vuelve más
         * restrictiva.
         */
        const reducingMaxPeople = maxPeople < service.maxPeople;

        const reducingMaxAdults =
          maxAdults !== null &&
          (service.maxAdults === null || maxAdults < service.maxAdults);

        const reducingMaxChildren =
          maxChildren !== null &&
          (service.maxChildren === null || maxChildren < service.maxChildren);

        if (reducingMaxPeople || reducingMaxAdults || reducingMaxChildren) {
          const activeReservationServices =
            await tx.reservationService.findMany({
              where: {
                serviceId: id,

                reservation: {
                  businessId,

                  status: {
                    in: [...ACTIVE_RESERVATION_STATUSES],
                  },
                },
              },

              select: {
                reservation: {
                  select: {
                    id: true,

                    confirmationCode: true,

                    status: true,

                    guests: true,
                    adults: true,
                    children: true,

                    startAt: true,
                    endAt: true,
                  },
                },
              },

              orderBy: {
                reservation: {
                  startAt: "asc",
                },
              },
            });

          const conflicts: CapacityConflict[] = [];

          for (const item of activeReservationServices) {
            const reservation = item.reservation;

            const violations: string[] = [];

            if (reservation.guests > maxPeople) {
              violations.push("MAX_PEOPLE");
            }

            if (
              maxAdults !== null &&
              reservation.adults !== null &&
              reservation.adults > maxAdults
            ) {
              violations.push("MAX_ADULTS");
            }

            if (
              maxChildren !== null &&
              reservation.children !== null &&
              reservation.children > maxChildren
            ) {
              violations.push("MAX_CHILDREN");
            }

            if (violations.length > 0) {
              conflicts.push({
                id: reservation.id,

                confirmationCode: reservation.confirmationCode,

                status: reservation.status,

                guests: reservation.guests,

                adults: reservation.adults,

                children: reservation.children,

                startAt: reservation.startAt,

                endAt: reservation.endAt,

                violations,
              });
            }
          }

          if (conflicts.length > 0) {
            return {
              ok: false as const,

              reason: "CAPACITY_CONFLICT" as const,

              reservations: conflicts,
            };
          }
        }

        /*
         * isActive = false significa:
         *
         * - no vender nuevas reservas
         * - no aparecer en disponibilidad
         *   normal
         *
         * NO significa eliminar ni
         * invalidar reservas existentes.
         */
        const updatedService = await tx.service.update({
          where: {
            id,
          },

          data: {
            name,
            slug,

            description: description || null,

            durationMinutes,

            maxPeople,
            maxAdults,
            maxChildren,

            isActive,
          },

          select: {
            id: true,
            businessId: true,

            name: true,
            slug: true,
            description: true,

            durationMinutes: true,

            maxPeople: true,
            maxAdults: true,
            maxChildren: true,

            isActive: true,

            createdAt: true,
            updatedAt: true,
          },
        });

        return {
          ok: true as const,

          service: updatedService,
        };
      },
      {
        isolationLevel: "Serializable",
      },
    );

    if (!result.ok) {
      return NextResponse.json(
        {
          success: false,

          error:
            "La nueva capacidad es menor que la requerida por una o más reservas activas.",

          code: "SERVICE_CAPACITY_HAS_ACTIVE_RESERVATION_CONFLICTS",

          reservations: result.reservations,
        },
        {
          status: 409,
        },
      );
    }

    return NextResponse.json({
      success: true,

      service: result.service,
    });
  } catch (error) {
    console.error("PATCH /api/services/[id] error:", error);

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

        case "SERVICE_NOT_FOUND":
          return NextResponse.json(
            {
              success: false,
              error: "Servicio no encontrado para este negocio",
            },
            {
              status: 404,
            },
          );

        case "SERVICE_SLUG_ALREADY_EXISTS":
          return NextResponse.json(
            {
              success: false,
              error: "Ya existe otro servicio con ese slug",
            },
            {
              status: 409,
            },
          );
      }
    }

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
          error: "Ya existe otro servicio con ese slug",
        },
        {
          status: 409,
        },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: "No fue posible actualizar el servicio",
      },
      {
        status: 500,
      },
    );
  }
}
