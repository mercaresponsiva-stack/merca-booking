import { NextRequest, NextResponse } from "next/server";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

import {
  AuthorizationError,
  requireBusinessAccess,
} from "@/lib/auth/business-access";

export const dynamic = "force-dynamic";

function privateJson(body: unknown, init: ResponseInit = {}) {
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
      return privateJson(
        {
          success: false,
          error: "businessId es obligatorio",
        },
        {
          status: 400,
        },
      );
    }

    const { business } = await requireBusinessAccess(businessId, [
      "OWNER",
      "ADMIN",
      "RECEPTIONIST",
    ]);

    const customer = await prisma.customer.findFirst({
      where: {
        id,
        businessId: business.id,
      },

      include: {
        reservations: {
          where: {
            businessId: business.id,
          },

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
              where: {
                service: {
                  is: {
                    businessId: business.id,
                  },
                },
              },

              include: {
                service: {
                  select: {
                    id: true,
                    name: true,
                    slug: true,
                  },
                },

                resources: {
                  where: {
                    resource: {
                      is: {
                        businessId: business.id,
                      },
                    },
                  },

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
      return privateJson(
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

    return privateJson({
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

    console.error("GET /api/customers/[id] error:", error);

    return privateJson(
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

export async function PATCH(
  request: NextRequest,
  context: {
    params: Promise<{
      id: string;
    }>;
  },
) {
  try {
    const { id } = await context.params;

    const body = await request.json();

    const businessId =
      typeof body.businessId === "string" ? body.businessId.trim() : "";

    const firstName =
      typeof body.firstName === "string" ? body.firstName.trim() : "";

    const lastName =
      typeof body.lastName === "string" ? body.lastName.trim() : "";

    const email = typeof body.email === "string" ? body.email.trim() : "";

    const phone = typeof body.phone === "string" ? body.phone.trim() : "";

    if (!businessId) {
      return privateJson(
        {
          success: false,
          error: "businessId es obligatorio",
        },
        {
          status: 400,
        },
      );
    }

    if (!firstName || !lastName) {
      return privateJson(
        {
          success: false,
          error: "Nombre y apellido son obligatorios",
        },
        {
          status: 400,
        },
      );
    }

    const { business } = await requireBusinessAccess(businessId, [
      "OWNER",
      "ADMIN",
      "RECEPTIONIST",
    ]);

    const existingCustomer = await prisma.customer.findFirst({
      where: {
        id,
        businessId: business.id,
      },

      select: {
        id: true,
      },
    });

    if (!existingCustomer) {
      return privateJson(
        {
          success: false,
          error: "Cliente no encontrado para este negocio",
        },
        {
          status: 404,
        },
      );
    }

    const customer = await prisma.customer.update({
      where: {
        id,
        businessId: business.id,
      },

      data: {
        firstName,
        lastName,

        email: email || null,
        phone: phone || null,
      },

      select: {
        id: true,

        firstName: true,
        lastName: true,

        email: true,
        phone: true,

        createdAt: true,
        updatedAt: true,
      },
    });

    return privateJson({
      success: true,

      customer,
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

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return privateJson(
        {
          success: false,
          error: "Cliente no encontrado para este negocio",
        },
        {
          status: 404,
        },
      );
    }

    console.error("PATCH /api/customers/[id] error:", error);

    return privateJson(
      {
        success: false,
        error: "No fue posible actualizar el cliente",
      },
      {
        status: 500,
      },
    );
  }
}
