export function isValidDateOnly(value: string) {
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

export function dateOnlyToUtc(value: string) {
  const [year, month, day] = value.split("-").map(Number);

  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

/*
 * Convierte:
 *
 * fecha YYYY-MM-DD
 * +
 * hora local HH:mm
 * +
 * timezone del Business
 *
 * al instante UTC correspondiente.
 *
 * Ejemplo:
 *
 * America/El_Salvador
 * 2026-08-15
 * 15:00
 *
 * → instante UTC equivalente.
 */
export function zonedDateTimeToUtc(
  date: string,
  time: string,
  timeZone: string,
) {
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

  let utcValue = desiredUtcValue;

  /*
   * Dos pasadas permiten resolver
   * normalmente el offset de la zona
   * y zonas con cambios estacionales.
   */
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
