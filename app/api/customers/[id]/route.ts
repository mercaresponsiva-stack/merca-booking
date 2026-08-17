import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  context: {
    params: Promise<{
      id: string;
    }>;
  },
) {
  try {
    const { id } = await context.params;

    const businessId =
      request.nextUrl.searchParams.get("businessId")?.trim() ?? "";

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

    const customer = await prisma.customer.findFirst({
      where: {
        id,
        businessId,
      },

      include: {
        reservations: {
          orderBy: [
            {
              createdAt: "desc",
            },
            {
              startAt: "desc",
            },
          ],

          include: {
            services: {
              include: {
                service: {
                  select: {
                    id: true,
                    name: true,
                    slug: true,
                  },
                },

                resources: {
                  include: {
                    resource: {
                      select: {
                        id: true,
                        name: true,
                        code: true,
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

    if (!customer) {
      return NextResponse.json(
        {
          success: false,
          error: "Cliente no encontrado para este negocio",
        },
        {
          status: 404,
        },
      );
    }

    const reservations = customer.reservations.map((reservation) => ({
      id: reservation.id,

      confirmationCode: reservation.confirmationCode,

      status: reservation.status,

      source: reservation.source,

      startAt: reservation.startAt,
      endAt: reservation.endAt,

      guests: reservation.guests,
      adults: reservation.adults,
      children: reservation.children,

      subtotal: Number(reservation.subtotal),
      total: Number(reservation.total),

      paymentOption: reservation.paymentOption,

      specialRequests: reservation.specialRequests,

      createdAt: reservation.createdAt,

      updatedAt: reservation.updatedAt,

      services: reservation.services.map((item) => ({
        id: item.id,

        serviceId: item.serviceId,

        name: item.service.name,

        slug: item.service.slug,

        quantity: item.quantity,

        subtotal: Number(item.subtotal),

        resources: item.resources.map((assignment) => ({
          assignmentId: assignment.id,

          resourceId: assignment.resourceId,

          name: assignment.resource.name,

          code: assignment.resource.code,
        })),
      })),
    }));

    const totalReserved = reservations.reduce(
      (sum, reservation) => sum + reservation.total,
      0,
    );

    return NextResponse.json({
      success: true,

      business,

      customer: {
        id: customer.id,

        firstName: customer.firstName,

        lastName: customer.lastName,

        email: customer.email,

        phone: customer.phone,

        createdAt: customer.createdAt,

        updatedAt: customer.updatedAt,
      },

      summary: {
        reservationCount: reservations.length,

        totalReserved,
      },

      reservations,
    });
  } catch (error) {
    console.error("GET /api/customers/[id] error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "No fue posible obtener el cliente",
      },
      {
        status: 500,
      },
    );
  }
}
