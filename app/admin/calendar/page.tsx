"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

const BUSINESS_ID = "cmsni1uij0000ewvwjzoenugh";

const BUSINESS_TIMEZONE = "America/El_Salvador";

const RESERVATION_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "CANCELLED",
  "NO_SHOW",
  "CHECKED_IN",
  "CHECKED_OUT",
  "COMPLETED",
] as const;

type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

const ACTIVE_INVENTORY_STATUSES: readonly ReservationStatus[] = [
  "PENDING",
  "CONFIRMED",
  "CHECKED_IN",
];

type CalendarMode = "RESERVATIONS" | "OCCUPANCY";

type ReservationItem = {
  id: string;
  confirmationCode: string;
  status: ReservationStatus;
  source: string;

  startAt: string;
  endAt: string;

  guests: number;
  adults: number | null;
  children: number | null;

  total: number;

  customer: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
  };

  services: Array<{
    id: string;
    serviceId: string;
    name: string;
    slug: string;
    quantity: number;
    subtotal: number;

    resources: Array<{
      assignmentId: string;
      resourceId: string;
      name: string;
      code: string | null;
    }>;
  }>;
};

type ReservationsResponse = {
  success: true;

  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
    hasPreviousPage: boolean;
    hasNextPage: boolean;
  };

  items: ReservationItem[];
};

type CalendarDay = {
  date: Date;
  dateKey: string;
  inCurrentMonth: boolean;
};

const DAY_HEADERS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function dateToKey(date: Date) {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-");
}

function addDays(date: Date, amount: number) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  next.setDate(next.getDate() + amount);

  return next;
}

function getDateKeyInTimezone(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,

    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));

  const year = parts.find((part) => part.type === "year")?.value;

  const month = parts.find((part) => part.type === "month")?.value;

  const day = parts.find((part) => part.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

function getTodayKey() {
  return getDateKeyInTimezone(new Date().toISOString());
}

function parseDateKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);

  return new Date(year, month - 1, day);
}

function getReservationDateKeys(reservation: ReservationItem) {
  const startKey = getDateKeyInTimezone(reservation.startAt);

  const endKey = getDateKeyInTimezone(reservation.endAt);

  const startDate = parseDateKey(startKey);

  const endDate = parseDateKey(endKey);

  /*
   * Intervalo [startAt, endAt).
   *
   * Hotel:
   * 28 -> 30
   *
   * ocupa:
   * 28 y 29.
   *
   * Si algún vertical futuro usa
   * una reserva que empieza y termina
   * el mismo día, mostramos al menos
   * el día de inicio.
   */
  if (startKey === endKey) {
    return [startKey];
  }

  const keys: string[] = [];

  let cursor = startDate;

  while (cursor < endDate) {
    keys.push(dateToKey(cursor));

    cursor = addDays(cursor, 1);
  }

  return keys;
}

function getCalendarDays(currentMonth: Date) {
  const firstDay = new Date(
    currentMonth.getFullYear(),
    currentMonth.getMonth(),
    1,
  );

  const lastDay = new Date(
    currentMonth.getFullYear(),
    currentMonth.getMonth() + 1,
    0,
  );

  /*
   * JavaScript:
   * domingo = 0
   *
   * Calendario:
   * lunes = 0
   */
  const startOffset = (firstDay.getDay() + 6) % 7;

  const endOffset = 6 - ((lastDay.getDay() + 6) % 7);

  const gridStart = addDays(firstDay, -startOffset);

  const gridEnd = addDays(lastDay, endOffset);

  const days: CalendarDay[] = [];

  let cursor = gridStart;

  while (cursor <= gridEnd) {
    days.push({
      date: cursor,

      dateKey: dateToKey(cursor),

      inCurrentMonth: cursor.getMonth() === currentMonth.getMonth(),
    });

    cursor = addDays(cursor, 1);
  }

  return days;
}

function getStatusLabel(status: ReservationStatus) {
  switch (status) {
    case "PENDING":
      return "Pendiente";

    case "CONFIRMED":
      return "Confirmada";

    case "CANCELLED":
      return "Cancelada";

    case "NO_SHOW":
      return "No show";

    case "CHECKED_IN":
      return "Check-in";

    case "CHECKED_OUT":
      return "Check-out";

    case "COMPLETED":
      return "Completada";
  }
}

function formatMonth(date: Date) {
  const value = new Intl.DateTimeFormat("es-SV", {
    month: "long",
    year: "numeric",
  }).format(date);

  return value.charAt(0).toUpperCase() + value.slice(1);
}

function isInventoryActive(status: ReservationStatus) {
  return ACTIVE_INVENTORY_STATUSES.includes(status);
}

export default function CalendarPage() {
  const initialToday = parseDateKey(getTodayKey());

  const [currentMonth, setCurrentMonth] = useState(
    () => new Date(initialToday.getFullYear(), initialToday.getMonth(), 1),
  );

  const [calendarMode, setCalendarMode] =
    useState<CalendarMode>("RESERVATIONS");

  const [reservations, setReservations] = useState<ReservationItem[]>([]);

  const [statusFilter, setStatusFilter] = useState<ReservationStatus | "">("");

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState<string | null>(null);

  const calendarDays = useMemo(
    () => getCalendarDays(currentMonth),
    [currentMonth],
  );

  const rangeStart = calendarDays[0]?.dateKey;

  const rangeEnd = calendarDays[calendarDays.length - 1]?.dateKey;

  const loadReservations = useCallback(async () => {
    if (!rangeStart || !rangeEnd) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const allItems: ReservationItem[] = [];

      let page = 1;
      let totalPages = 1;

      do {
        const params = new URLSearchParams({
          businessId: BUSINESS_ID,

          from: rangeStart,

          to: rangeEnd,

          page: String(page),

          pageSize: "100",
        });

        const response = await fetch(`/api/reservations?${params.toString()}`, {
          cache: "no-store",
        });

        const result = await response.json();

        if (!response.ok) {
          throw new Error(
            typeof result.error === "string"
              ? result.error
              : "No fue posible cargar el calendario",
          );
        }

        const data = result as ReservationsResponse;

        allItems.push(...data.items);

        totalPages = data.pagination.totalPages;

        page += 1;
      } while (page <= totalPages);

      setReservations(allItems);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "No fue posible cargar el calendario",
      );
    } finally {
      setLoading(false);
    }
  }, [rangeStart, rangeEnd]);

  useEffect(() => {
    void loadReservations();
  }, [loadReservations]);

  const availableStatuses = useMemo<readonly ReservationStatus[]>(
    () =>
      calendarMode === "OCCUPANCY"
        ? ACTIVE_INVENTORY_STATUSES
        : RESERVATION_STATUSES,
    [calendarMode],
  );

  const visibleReservations = useMemo(() => {
    let result = reservations;

    if (calendarMode === "OCCUPANCY") {
      result = result.filter((reservation) =>
        isInventoryActive(reservation.status),
      );
    }

    if (statusFilter) {
      result = result.filter(
        (reservation) => reservation.status === statusFilter,
      );
    }

    return result;
  }, [reservations, calendarMode, statusFilter]);

  const reservationsByDate = useMemo(() => {
    const result = new Map<string, ReservationItem[]>();

    for (const reservation of visibleReservations) {
      const dateKeys = getReservationDateKeys(reservation);

      for (const dateKey of dateKeys) {
        const existing = result.get(dateKey) ?? [];

        existing.push(reservation);

        result.set(dateKey, existing);
      }
    }

    for (const entries of result.values()) {
      entries.sort(
        (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
      );
    }

    return result;
  }, [visibleReservations]);

  const todayKey = getTodayKey();

  function changeCalendarMode(nextMode: CalendarMode) {
    setCalendarMode(nextMode);

    /*
     * Si el usuario tenía seleccionado
     * un estado que no consume inventario,
     * lo limpiamos al entrar en Ocupación.
     */
    if (
      nextMode === "OCCUPANCY" &&
      statusFilter &&
      !isInventoryActive(statusFilter)
    ) {
      setStatusFilter("");
    }
  }

  function goPreviousMonth() {
    setCurrentMonth(
      (current) => new Date(current.getFullYear(), current.getMonth() - 1, 1),
    );
  }

  function goNextMonth() {
    setCurrentMonth(
      (current) => new Date(current.getFullYear(), current.getMonth() + 1, 1),
    );
  }

  function goToday() {
    const today = parseDateKey(getTodayKey());

    setCurrentMonth(new Date(today.getFullYear(), today.getMonth(), 1));
  }

  return (
    <main className="mx-auto w-full max-w-[1600px] p-4 sm:p-6">
      <div className="mb-6 flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Calendario</h1>

          <p className="mt-2 text-sm text-zinc-500">
            Consulta las reservas y la ocupación por fecha.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Estado</span>

            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as ReservationStatus | "")
              }
              className="h-10 rounded-lg border border-zinc-300 bg-white px-3"
            >
              <option value="">
                {calendarMode === "OCCUPANCY" ? "Todos los activos" : "Todos"}
              </option>

              {availableStatuses.map((status) => (
                <option key={status} value={status}>
                  {getStatusLabel(status)}
                </option>
              ))}
            </select>
          </label>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={goPreviousMonth}
              className="h-10 rounded-lg border border-zinc-300 px-4 text-sm font-medium"
              aria-label="Mes anterior"
            >
              ←
            </button>

            <button
              type="button"
              onClick={goToday}
              className="h-10 rounded-lg border border-zinc-300 px-4 text-sm font-medium"
            >
              Hoy
            </button>

            <button
              type="button"
              onClick={goNextMonth}
              className="h-10 rounded-lg border border-zinc-300 px-4 text-sm font-medium"
              aria-label="Mes siguiente"
            >
              →
            </button>
          </div>
        </div>
      </div>

      <div className="mb-4 inline-flex rounded-lg border border-zinc-300 bg-white p-1">
        <button
          type="button"
          onClick={() => changeCalendarMode("RESERVATIONS")}
          className={`rounded-md px-4 py-2 text-sm font-medium transition ${
            calendarMode === "RESERVATIONS"
              ? "bg-zinc-900 text-white"
              : "text-zinc-600 hover:bg-zinc-100"
          }`}
        >
          Reservas
        </button>

        <button
          type="button"
          onClick={() => changeCalendarMode("OCCUPANCY")}
          className={`rounded-md px-4 py-2 text-sm font-medium transition ${
            calendarMode === "OCCUPANCY"
              ? "bg-zinc-900 text-white"
              : "text-zinc-600 hover:bg-zinc-100"
          }`}
        >
          Ocupación
        </button>
      </div>

      {calendarMode === "OCCUPANCY" && (
        <div className="mb-4 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3">
          <p className="text-sm text-zinc-600">
            La vista de ocupación muestra únicamente reservas pendientes,
            confirmadas o con check-in realizado, porque son las que actualmente
            consumen inventario.
          </p>
        </div>
      )}

      <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
        <div className="flex flex-col justify-between gap-3 border-b border-zinc-200 px-5 py-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-lg font-semibold">
              {formatMonth(currentMonth)}
            </h2>

            <p className="mt-1 text-sm text-zinc-500">
              {loading
                ? "Cargando reservas..."
                : calendarMode === "OCCUPANCY"
                  ? `${visibleReservations.length} reserva(s) consumiendo inventario en el rango visible`
                  : `${visibleReservations.length} reserva(s) en el rango visible`}
            </p>
          </div>

          {statusFilter && (
            <button
              type="button"
              onClick={() => setStatusFilter("")}
              className="text-sm font-medium hover:underline"
            >
              Quitar filtro
            </button>
          )}
        </div>

        {error ? (
          <div className="flex min-h-80 flex-col items-center justify-center gap-4 p-8 text-center">
            <p className="text-sm font-medium text-red-700">{error}</p>

            <button
              type="button"
              onClick={() => void loadReservations()}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium"
            >
              Reintentar
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[1050px]">
              <div className="grid grid-cols-7 border-b border-zinc-200 bg-zinc-50">
                {DAY_HEADERS.map((day) => (
                  <div
                    key={day}
                    className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wide text-zinc-500"
                  >
                    {day}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7">
                {calendarDays.map((day) => {
                  const dayReservations =
                    reservationsByDate.get(day.dateKey) ?? [];

                  const isToday = day.dateKey === todayKey;

                  return (
                    <div
                      key={day.dateKey}
                      className={`min-h-40 border-b border-r border-zinc-200 p-2 ${
                        day.inCurrentMonth ? "bg-white" : "bg-zinc-50"
                      }`}
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <span
                          className={`flex h-7 min-w-7 items-center justify-center rounded-full px-1 text-xs font-medium ${
                            isToday
                              ? "bg-zinc-900 text-white"
                              : day.inCurrentMonth
                                ? "text-zinc-900"
                                : "text-zinc-400"
                          }`}
                        >
                          {day.date.getDate()}
                        </span>

                        {dayReservations.length > 0 && (
                          <span className="text-[11px] text-zinc-400">
                            {dayReservations.length}
                          </span>
                        )}
                      </div>

                      <div className="space-y-2">
                        {dayReservations.map((reservation) => {
                          const serviceName =
                            reservation.services[0]?.name ?? "Sin servicio";

                          const resources = reservation.services.flatMap(
                            (service) => service.resources,
                          );

                          const resourceText =
                            resources.length > 0
                              ? resources
                                  .map(
                                    (resource) =>
                                      resource.code || resource.name,
                                  )
                                  .join(", ")
                              : null;

                          return (
                            <Link
                              key={`${day.dateKey}-${reservation.id}`}
                              href={`/admin/reservations/${reservation.id}`}
                              className="block rounded-lg border border-zinc-200 bg-white p-2 text-xs transition hover:border-zinc-400"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <span className="font-semibold">
                                  {reservation.confirmationCode}
                                </span>

                                <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium">
                                  {getStatusLabel(reservation.status)}
                                </span>
                              </div>

                              <p className="mt-1 truncate font-medium">
                                {reservation.customer.firstName}{" "}
                                {reservation.customer.lastName}
                              </p>

                              <p className="mt-1 truncate text-zinc-500">
                                {serviceName}
                              </p>

                              <p className="mt-1 truncate text-zinc-400">
                                {resourceText
                                  ? `Recurso: ${resourceText}`
                                  : calendarMode === "OCCUPANCY"
                                    ? "Recurso pendiente de asignar"
                                    : "Sin recurso asignado"}
                              </p>
                            </Link>
                          );
                        })}

                        {!loading &&
                          dayReservations.length === 0 &&
                          day.inCurrentMonth && (
                            <span className="text-[11px] text-zinc-300">—</span>
                          )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
