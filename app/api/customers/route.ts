import { NextRequest, NextResponse } from "next/server";

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

type CustomerSearchRow = {
  id: string;

  firstName: string;
  lastName: string;

  email: string | null;
  phone: string | null;

  reservationCount: number;

  createdAt: Date;
  updatedAt: Date;
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;

    const businessId = searchParams.get("businessId")?.trim() ?? "";

    const query = searchParams.get("query")?.trim() ?? "";

    const rawLimit = Number(searchParams.get("limit") ?? 10);

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

    if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 50) {
      return privateJson(
        {
          success: false,
          error: "limit debe ser un entero entre 1 y 50",
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

    /*
     * Búsqueda tolerante para recepción.
     *
     * - No distingue mayúsculas/minúsculas.
     * - No distingue tildes/diacríticos.
     * - Permite buscar por nombre, apellido,
     *   correo o teléfono.
     * - Cuando hay varios términos, TODOS
     *   deben aparecer en algún campo del cliente.
     *
     * Ejemplos:
     *
     * Liberacion
     * -> Liberación
     *
     * JOSE GOMEZ
     * -> José Gómez
     *
     * Prueba Liberacion
     * -> exige "Prueba" Y "Liberación".
     *
     * Usamos $queryRaw parametrizado para no
     * concatenar directamente texto ingresado
     * por el usuario dentro del SQL.
     */
    const customers = await prisma.$queryRaw<CustomerSearchRow[]>`
        WITH search_terms AS (
          SELECT term
          FROM regexp_split_to_table(
            trim(${query}::text),
            '[[:space:]]+'
          ) AS search_term(term)
          WHERE term <> ''
        )

        SELECT
          customer.id,
          customer."firstName",
          customer."lastName",
          customer.email,
          customer.phone,

          (
            SELECT COUNT(*)::int
            FROM "Reservation" reservation
            WHERE reservation."customerId" = customer.id
              AND reservation."businessId" = ${business.id}
          ) AS "reservationCount",

          customer."createdAt",
          customer."updatedAt"

        FROM "Customer" customer

        WHERE
          customer."businessId" = ${business.id}

          AND NOT EXISTS (
            SELECT 1
            FROM search_terms

            WHERE
              lower(
                extensions.unaccent(
                  concat_ws(
                    ' ',
                    customer."firstName",
                    customer."lastName",
                    COALESCE(customer.email, ''),
                    COALESCE(customer.phone, '')
                  )
                )
              )
              NOT LIKE
              (
                '%' ||
                lower(
                  extensions.unaccent(
                    search_terms.term
                  )
                ) ||
                '%'
              )
          )

        ORDER BY
          customer."updatedAt" DESC,
          customer."createdAt" DESC

        LIMIT ${rawLimit}
      `;

    return privateJson({
      success: true,

      business,

      query: query || null,

      customers: customers.map((customer) => ({
        id: customer.id,

        firstName: customer.firstName,

        lastName: customer.lastName,

        email: customer.email,

        phone: customer.phone,

        reservationCount: customer.reservationCount,

        createdAt: customer.createdAt,

        updatedAt: customer.updatedAt,
      })),
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

    console.error("GET /api/customers error:", error);

    return privateJson(
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
