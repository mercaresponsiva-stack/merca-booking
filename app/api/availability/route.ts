import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAvailability } from "@/lib/booking/availability";

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

    const availability = await getAvailability({
      businessId: business.id,
      checkIn: checkInDate,
      checkOut: checkOutDate,
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

// ─────────────────────────────────────────────
// YYYY-MM-DD VALIDATION
// ─────────────────────────────────────────────

function isValidDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);

  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

// ─────────────────────────────────────────────
// BUSINESS LOCAL DATETIME → UTC
//
// No dependemos de la zona horaria de Windows,
// Node o Docker.
//
// Ejemplo:
//
// Business timezone:
// America/El_Salvador
//
// 2026-08-15 15:00 local
//
// se convierte al instante UTC correspondiente.
// ─────────────────────────────────────────────

function zonedDateTimeToUtc(date: string, time: string, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number);

  const [hour, minute] = time.split(":").map(Number);

  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    throw new Error(`Horario inválido para el negocio: ${time}`);
  }

  const desiredUtcValue = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  /*
   * Partimos de una aproximación UTC y preguntamos
   * a Intl cómo se representa ese instante dentro
   * de la zona horaria del Business.
   *
   * Ajustamos la diferencia dos veces para cubrir
   * también zonas con cambios de horario.
   */
  let utcValue = desiredUtcValue;

  for (let attempt = 0; attempt < 2; attempt++) {
    const parts = getDateTimeParts(new Date(utcValue), timeZone);

    const representedAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      0,
      0,
    );

    const difference = desiredUtcValue - representedAsUtc;

    utcValue += difference;

    if (difference === 0) {
      break;
    }
  }

  return new Date(utcValue);
}

// ─────────────────────────────────────────────
// DATE PARTS IN BUSINESS TIMEZONE
// ─────────────────────────────────────────────

function getDateTimeParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date);

  const values: Record<string, number> = {};

  for (const part of parts) {
    if (
      part.type === "year" ||
      part.type === "month" ||
      part.type === "day" ||
      part.type === "hour" ||
      part.type === "minute"
    ) {
      values[part.type] = Number(part.value);
    }
  }

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
  };
}
