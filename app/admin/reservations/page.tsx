"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { isReservationCheckoutDue } from "@/lib/booking/reservation-checkout-timing";
import { DEV_BUSINESS_ID as BUSINESS_ID } from "@/lib/config/dev-context";

const RESERVATION_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "CANCELLED",
  "NO_SHOW",
  "CHECKED_IN",
  "CHECKED_OUT",
  "COMPLETED",
  "EXPIRED",
] as const;

type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

type ReservationListItem = {
  id: string;
  confirmationCode: string;
  status: ReservationStatus;
  source: string | null;
  startAt: string;
  endAt: string;
  expiresAt: string | null;
  guests: number;
  adults: number | null;
  children: number | null;
  total: number;
  paymentOption: "FULL" | "DEPOSIT_50" | null;

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

  financial: {
    grossPaid: number;
    refunded: number;
    refundPending: number;
    netPaid: number;
    contractualBalance: number;
    amountDue: number;
    canAcceptPayment: boolean;
    hasRefundPending: boolean;
  };

  createdAt: string;
  updatedAt: string;
};

type ReservationListResponse = {
  success: true;

  business: {
    id: string;
    name: string;
    slug: string;
    timezone: string;
    currency: string;
  };

  filters: {
    status: ReservationStatus | null;
    from: string | null;
    to: string | null;
    confirmationCode: string | null;
    customer: string | null;
  };

  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
    hasPreviousPage: boolean;
    hasNextPage: boolean;
  };

  items: ReservationListItem[];
};

type Filters = {
  status: string;
  from: string;
  to: string;
  confirmationCode: string;
  customer: string;
};

const EMPTY_FILTERS: Filters = {
  status: "",
  from: "",
  to: "",
  confirmationCode: "",
  customer: "",
};

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("es-SV", {
    style: "currency",
    currency,
  }).format(amount);
}

function formatDate(value: string, timezone: string) {
  return new Intl.DateTimeFormat("es-SV", {
    timeZone: timezone,
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(new Date(value));
}

function formatReservationExpiration(value: string, timezone: string) {
  return new Intl.DateTimeFormat("es-SV", {
    timeZone: timezone,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
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
      return "No se presentó";

    case "CHECKED_IN":
      return "Check-in";

    case "CHECKED_OUT":
      return "Check-out";

    case "COMPLETED":
      return "Completada";

    case "EXPIRED":
      return "Vencida";
  }
}

export default function ReservationsPage() {
  const [operationalNow, setOperationalNow] = useState(() => Date.now());

  useEffect(() => {
    const intervalId = window.setInterval(
      () => setOperationalNow(Date.now()),
      60_000,
    );

    return () => window.clearInterval(intervalId);
  }, []);

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

  const [appliedFilters, setAppliedFilters] = useState<Filters>(EMPTY_FILTERS);

  const [page, setPage] = useState(1);

  const [pageSize, setPageSize] = useState(10);

  const [data, setData] = useState<ReservationListResponse | null>(null);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState<string | null>(null);

  const loadReservations = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        businessId: BUSINESS_ID,
        page: String(page),
        pageSize: String(pageSize),
      });

      if (appliedFilters.status) {
        params.set("status", appliedFilters.status);
      }

      if (appliedFilters.from) {
        params.set("from", appliedFilters.from);
      }

      if (appliedFilters.to) {
        params.set("to", appliedFilters.to);
      }

      if (appliedFilters.confirmationCode) {
        params.set("confirmationCode", appliedFilters.confirmationCode);
      }

      if (appliedFilters.customer) {
        params.set("customer", appliedFilters.customer);
      }

      const response = await fetch(`/api/reservations?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof result.error === "string"
            ? result.error
            : "No fue posible cargar las reservas",
        );
      }

      setData(result as ReservationListResponse);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "No fue posible cargar las reservas",
      );
    } finally {
      setLoading(false);
    }
  }, [appliedFilters, page, pageSize]);

  useEffect(() => {
    const timeoutId = window.setTimeout(
      () => {
        void loadReservations();
      },
      0,
    );

    return () => {
      window.clearTimeout(
        timeoutId,
      );
    };
  }, [loadReservations]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setPage(1);
    setAppliedFilters(filters);
  }

  function handleReset() {
    setFilters(EMPTY_FILTERS);
    setAppliedFilters(EMPTY_FILTERS);
    setPage(1);
  }

  return (
    <div className="mx-auto w-full max-w-[1600px]">
      <div className="flex flex-col gap-6">
        <div>
          <p className="text-sm font-medium text-zinc-500">Operación</p>

          <div className="mt-1 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-zinc-950">
                Reservas
              </h1>

              <p className="mt-2 text-sm text-zinc-500">
                Consulta y administra las reservas del negocio.
              </p>
            </div>

            <Link
              href="/admin/reservations/new"
              className="flex h-10 items-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white"
            >
              Nueva reserva
            </Link>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-xl border border-zinc-200 bg-white p-5"
        >
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Cliente</span>

              <input
                value={filters.customer}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    customer: event.target.value,
                  }))
                }
                placeholder="Nombre, email o teléfono"
                className="h-10 rounded-lg border border-zinc-300 px-3 outline-none focus:border-zinc-500"
              />
            </label>

            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Confirmación</span>

              <input
                value={filters.confirmationCode}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    confirmationCode: event.target.value,
                  }))
                }
                placeholder="MB-..."
                className="h-10 rounded-lg border border-zinc-300 px-3 outline-none focus:border-zinc-500"
              />
            </label>

            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Estado</span>

              <select
                value={filters.status}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    status: event.target.value,
                  }))
                }
                className="h-10 rounded-lg border border-zinc-300 bg-white px-3 outline-none focus:border-zinc-500"
              >
                <option value="">Todos</option>

                {RESERVATION_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {getStatusLabel(status)}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Desde</span>

              <input
                type="date"
                value={filters.from}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    from: event.target.value,
                  }))
                }
                className="h-10 rounded-lg border border-zinc-300 px-3 outline-none focus:border-zinc-500"
              />
            </label>

            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Hasta</span>

              <input
                type="date"
                value={filters.to}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    to: event.target.value,
                  }))
                }
                className="h-10 rounded-lg border border-zinc-300 px-3 outline-none focus:border-zinc-500"
              />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="submit"
              className="h-10 rounded-lg bg-zinc-900 px-5 text-sm font-medium text-white"
            >
              Aplicar filtros
            </button>

            <button
              type="button"
              onClick={handleReset}
              className="h-10 rounded-lg border border-zinc-300 px-5 text-sm font-medium"
            >
              Limpiar
            </button>
          </div>
        </form>

        <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
          <div className="flex flex-col justify-between gap-4 border-b border-zinc-200 px-5 py-4 sm:flex-row sm:items-center">
            <div>
              <h2 className="font-semibold">Listado de reservas</h2>

              <p className="mt-1 text-sm text-zinc-500">
                {data
                  ? `${data.pagination.totalItems} reserva(s)`
                  : "Cargando información..."}
              </p>
            </div>

            <label className="flex items-center gap-2 text-sm">
              Mostrar
              <select
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value));

                  setPage(1);
                }}
                className="h-9 rounded-lg border border-zinc-300 bg-white px-2"
              >
                <option value={5}>5</option>

                <option value={10}>10</option>

                <option value={20}>20</option>

                <option value={50}>50</option>
              </select>
            </label>
          </div>

          {loading ? (
            <div className="flex min-h-64 items-center justify-center p-8 text-sm text-zinc-500">
              Cargando reservas...
            </div>
          ) : error ? (
            <div className="flex min-h-64 flex-col items-center justify-center gap-4 p-8 text-center">
              <p className="text-sm font-medium text-red-700">{error}</p>

              <button
                type="button"
                onClick={() => void loadReservations()}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm"
              >
                Reintentar
              </button>
            </div>
          ) : !data || data.items.length === 0 ? (
            <div className="flex min-h-64 items-center justify-center p-8 text-sm text-zinc-500">
              No se encontraron reservas.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1150px] text-left text-sm">
                <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-5 py-3">Reserva</th>

                    <th className="px-5 py-3">Cliente</th>

                    <th className="px-5 py-3">Servicio</th>

                    <th className="px-5 py-3">Estancia</th>

                    <th className="px-5 py-3">Estado</th>

                    <th className="px-5 py-3">Total</th>

                    <th className="px-5 py-3">Pagado neto</th>

                    <th className="px-5 py-3">Pendiente</th>

                    <th className="px-5 py-3">Recurso</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-zinc-100">
                  {data.items.map((reservation) => (
                    <tr key={reservation.id} className="hover:bg-zinc-50">
                      <td className="px-5 py-4">
                        <Link
                          href={`/admin/reservations/${reservation.id}`}
                          className="font-medium hover:underline"
                        >
                          {reservation.confirmationCode}
                        </Link>

                        <p className="mt-1 text-xs text-zinc-500">
                          {reservation.paymentOption}
                        </p>
                      </td>

                      <td className="px-5 py-4">
                        <p className="font-medium">
                          {reservation.customer.firstName}{" "}
                          {reservation.customer.lastName}
                        </p>

                        <p className="mt-1 text-xs text-zinc-500">
                          {reservation.customer.email ?? "Sin email"}
                        </p>
                      </td>

                      <td className="px-5 py-4">
                        {reservation.services.map((service) => (
                          <div key={service.id}>{service.name}</div>
                        ))}
                      </td>

                      <td className="px-5 py-4 whitespace-nowrap">
                        <p>
                          {formatDate(
                            reservation.startAt,
                            data.business.timezone,
                          )}
                        </p>

                        <p className="text-xs text-zinc-500">
                          hasta{" "}
                          {formatDate(
                            reservation.endAt,
                            data.business.timezone,
                          )}
                        </p>
                      </td>

                      <td className="px-5 py-4">
                        <span className="inline-flex rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium">
                          {getStatusLabel(reservation.status)}
                        </span>

                        {reservation.expiresAt &&
                          (reservation.status === "PENDING" ||
                            reservation.status === "EXPIRED") && (
                            <p
                              className={`mt-1 text-xs font-medium ${
                                reservation.status === "EXPIRED" ||
                                operationalNow >=
                                  Date.parse(reservation.expiresAt)
                                  ? "text-red-700"
                                  : "text-amber-700"
                              }`}
                            >
                              {reservation.status === "EXPIRED"
                                ? "Venció "
                                : operationalNow >=
                                    Date.parse(reservation.expiresAt)
                                  ? "Plazo vencido "
                                  : "Vence "}
                              {formatReservationExpiration(
                                reservation.expiresAt,
                                data.business.timezone,
                              )}
                            </p>
                          )}

                        {isReservationCheckoutDue({
                          status: reservation.status,
                          endAt: reservation.endAt,
                          now: operationalNow,
                        }) && (
                          <p className="mt-1 text-xs font-medium text-amber-700">
                            Salida pendiente
                          </p>
                        )}
                      </td>

                      <td className="px-5 py-4 font-medium whitespace-nowrap">
                        {formatMoney(reservation.total, data.business.currency)}
                      </td>

                      <td className="px-5 py-4 whitespace-nowrap">
                        {formatMoney(
                          reservation.financial.netPaid,
                          data.business.currency,
                        )}
                      </td>

                      <td className="px-5 py-4 whitespace-nowrap">
                        {formatMoney(
                          reservation.financial.amountDue,
                          data.business.currency,
                        )}

                        {reservation.financial.hasRefundPending && (
                          <p className="mt-1 text-xs font-medium text-amber-700">
                            Devolución pendiente
                          </p>
                        )}
                      </td>

                      <td className="px-5 py-4">
                        {reservation.services.flatMap((service) =>
                          service.resources.map((resource) => resource.name),
                        ).length > 0
                          ? reservation.services
                              .flatMap((service) =>
                                service.resources.map(
                                  (resource) => resource.name,
                                ),
                              )
                              .join(", ")
                          : "Sin asignar"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data && (
            <div className="flex flex-col justify-between gap-4 border-t border-zinc-200 px-5 py-4 sm:flex-row sm:items-center">
              <p className="text-sm text-zinc-500">
                Página {data.pagination.page} de{" "}
                {Math.max(data.pagination.totalPages, 1)}
              </p>

              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!data.pagination.hasPreviousPage || loading}
                  onClick={() => setPage((current) => current - 1)}
                  className="h-9 rounded-lg border border-zinc-300 px-4 text-sm disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Anterior
                </button>

                <button
                  type="button"
                  disabled={!data.pagination.hasNextPage || loading}
                  onClick={() => setPage((current) => current + 1)}
                  className="h-9 rounded-lg border border-zinc-300 px-4 text-sm disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
