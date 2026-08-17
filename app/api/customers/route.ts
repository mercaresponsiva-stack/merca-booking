import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;

    const businessId = searchParams.get("businessId")?.trim() ?? "";

    const query = searchParams.get("query")?.trim() ?? "";

    const rawLimit = Number(searchParams.get("limit") ?? 10);

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

    if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 50) {
      return NextResponse.json(
        {
          success: false,
          error: "limit debe ser un entero entre 1 y 50",
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

    /*
     * Dividimos la búsqueda en términos.
     *
     * Ejemplo:
     * "Juan Pérez"
     *
     * requiere que "Juan" aparezca en alguno
     * de los campos Y que "Pérez" también
     * aparezca en alguno de ellos.
     */
    const terms = query
      .split(/\s+/)
      .map((term) => term.trim())
      .filter(Boolean);

    const customerSelect = {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      createdAt: true,
      updatedAt: true,

      _count: {
        select: {
          reservations: true,
        },
      },
    } as const;

    const strictWhere =
      terms.length > 0
        ? {
            businessId,

            AND: terms.map((term) => ({
              OR: [
                {
                  firstName: {
                    contains: term,
                    mode: "insensitive" as const,
                  },
                },
                {
                  lastName: {
                    contains: term,
                    mode: "insensitive" as const,
                  },
                },
                {
                  email: {
                    contains: term,
                    mode: "insensitive" as const,
                  },
                },
                {
                  phone: {
                    contains: term,
                    mode: "insensitive" as const,
                  },
                },
              ],
            })),
          }
        : {
            businessId,
          };

    let customers = await prisma.customer.findMany({
      where: strictWhere,

      select: customerSelect,

      orderBy: [
        {
          updatedAt: "desc",
        },
        {
          createdAt: "desc",
        },
      ],

      take: rawLimit,
    });

    /*
     * Fallback flexible.
     *
     * Si una búsqueda con varios términos no encuentra
     * coincidencias exactas —por ejemplo por diferencias
     * de tildes— buscamos por cualquiera de los términos.
     *
     * Así:
     * "Prueba Liberacion"
     *
     * todavía puede encontrar:
     * "Prueba Liberación"
     */
    if (customers.length === 0 && terms.length > 1) {
      customers = await prisma.customer.findMany({
        where: {
          businessId,

          OR: terms.flatMap((term) => [
            {
              firstName: {
                contains: term,
                mode: "insensitive" as const,
              },
            },
            {
              lastName: {
                contains: term,
                mode: "insensitive" as const,
              },
            },
            {
              email: {
                contains: term,
                mode: "insensitive" as const,
              },
            },
            {
              phone: {
                contains: term,
                mode: "insensitive" as const,
              },
            },
          ]),
        },

        select: customerSelect,

        orderBy: [
          {
            updatedAt: "desc",
          },
          {
            createdAt: "desc",
          },
        ],

        take: rawLimit,
      });
    }

    return NextResponse.json({
      success: true,

      business,

      query: query || null,

      customers: customers.map((customer) => ({
        id: customer.id,

        firstName: customer.firstName,

        lastName: customer.lastName,

        email: customer.email,
        phone: customer.phone,

        reservationCount: customer._count.reservations,

        createdAt: customer.createdAt,

        updatedAt: customer.updatedAt,
      })),
    });
  } catch (error) {
    console.error("GET /api/customers error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "No fue posible obtener los clientes",
      },
      {
        status: 500,
      },
    );
  }
}
