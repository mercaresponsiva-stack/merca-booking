import { isValidDateOnly, zonedDateTimeToUtc } from "@/lib/booking/datetime";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getHotelAvailability } from "@/lib/booking/verticals/hotel/availability";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const checkIn = searchParams.get("checkIn");
    const checkOut = searchParams.get("checkOut");

    const adults = Number(searchParams.get("adults") ?? "1");
    const children = Number(searchParams.get("children") ?? "0");

    /*
     * Por ahora el hotel piloto sigue siendo hotel-demo.
     *
     * Ya dejamos businessSlug como parámetro opcional para
     * que el mismo endpoint pueda utilizarse con otros
     * negocios posteriormente.
     */
    const businessSlug = searchParams.get("businessSlug") ?? "hotel-demo";

    // ─────────────────────────────────────────────
    // VALIDACIÓN DE ENTRADA
    // ─────────────────────────────────────────────

    if (!checkIn || !checkOut) {
      return NextResponse.json(
        {
          success: false,
          error: "checkIn y checkOut son requeridos",
        },
        {
          status: 400,
        },
      );
    }

    if (!isValidDateOnly(checkIn) || !isValidDateOnly(checkOut)) {
      return NextResponse.json(
        {
          success: false,
          error: "Formato de fecha inválido. Usa YYYY-MM-DD.",
        },
        {
          status: 400,
        },
      );
    }

    if (
      !Number.isInteger(adults) ||
      !Number.isInteger(children) ||
      adults < 1 ||
      children < 0
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Cantidad de huéspedes inválida",
        },
        {
          status: 400,
        },
      );
    }

    // ─────────────────────────────────────────────
    // BUSINESS
    // ─────────────────────────────────────────────

    const business = await prisma.business.findUnique({
      where: {
        slug: businessSlug,
      },
      select: {
        id: true,
        slug: true,
        name: true,
        timezone: true,
        checkInTime: true,
        checkOutTime: true,
        isActive: true,
      },
    });

    if (!business || !business.isActive) {
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

    // ─────────────────────────────────────────────
    // HOTEL DATE → UNIVERSAL DATETIME
    //
    // La API recibe:
    //
    // checkIn = 2026-08-15
    // checkOut = 2026-08-17
    //
    // Y los convierte usando:
    //
    // checkInTime  = 15:00
    // checkOutTime = 12:00
    //
    // en la zona horaria del Business.
    // ─────────────────────────────────────────────

    const checkInDate = zonedDateTimeToUtc(
      checkIn,
      business.checkInTime ?? "00:00",
      business.timezone,
    );

    const checkOutDate = zonedDateTimeToUtc(
      checkOut,
      business.checkOutTime ?? "00:00",
      business.timezone,
    );

    if (checkOutDate <= checkInDate) {
      return NextResponse.json(
        {
          success: false,
          error: "checkOut debe ser posterior a checkIn",
        },
        {
          status: 400,
        },
      );
    }

    // ─────────────────────────────────────────────
    // CORE AVAILABILITY
    // ─────────────────────────────────────────────

    const availability = await getHotelAvailability({
      businessId: business.id,

      startAt: checkInDate,

      endAt: checkOutDate,

      checkIn,
      checkOut,

      adults,
      children,
    });

    // ─────────────────────────────────────────────
    // RESPONSE
    //
    // Conservamos `results` para no romper de golpe
    // consumidores del endpoint antiguo.
    //
    // Ahora cada elemento es un Service, no un RoomType.
    // ─────────────────────────────────────────────

    return NextResponse.json({
      success: true,

      business: {
        id: business.id,
        slug: business.slug,
        name: business.name,
        timezone: business.timezone,
      },

      search: {
        checkIn,
        checkOut,
        adults,
        children,
      },

      interval: {
        startAt: checkInDate,
        endAt: checkOutDate,
      },

      nights: availability.nights,

      results: availability.services,
    });
  } catch (error) {
    console.error("GET /api/availability error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Error al consultar disponibilidad",
      },
      {
        status: 500,
      },
    );
  }
}
