"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

const BUSINESS_ID = "cmsni1uij0000ewvwjzoenugh";

type ReservationStatus =
  | "PENDING"
  | "CONFIRMED"
  | "CANCELLED"
  | "NO_SHOW"
  | "CHECKED_IN"
  | "CHECKED_OUT"
  | "COMPLETED";

type ReservationSource =
  | "WEBSITE"
  | "WHATSAPP"
  | "PHONE"
  | "WALK_IN"
  | "AIRBNB"
  | "OTHER";

type PaymentOption = "FULL" | "DEPOSIT_50" | null;

type ReservationResource = {
  assignmentId: string;
  resourceId: string;
  name: string;
  code: string | null;
};

type ReservationService = {
  id: string;
  serviceId: string;
  name: string;
  slug: string;
  quantity: number;
  subtotal: number;
  resources: ReservationResource[];
};

type CustomerReservation = {
  id: string;
  confirmationCode: string;

  status: ReservationStatus;
  source: ReservationSource;

  startAt: string;
  endAt: string;

  guests: number;
  adults: number | null;
  children: number | null;

  subtotal: number;
  total: number;

  paymentOption: PaymentOption;

  specialRequests: string | null;

  createdAt: string;
  updatedAt: string;

  services: ReservationService[];
};

type CustomerDetailResponse = {
  success: true;

  business: {
    id: string;
    name: string;
  };

  customer: {
    id: string;

    firstName: string;
    lastName: string;

    email: string | null;
    phone: string | null;

    createdAt: string;
    updatedAt: string;
  };

  summary: {
    reservationCount: number;
    totalReserved: number;
  };

  reservations: CustomerReservation[];
};

function formatMoney(value: number) {
  return new Intl.NumberFormat("es-SV", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-SV", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("es-SV", {
    year: "numeric",
    month: "short",
    day: "numeric",
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
      return "No show";

    case "CHECKED_IN":
      return "Check-in";

    case "CHECKED_OUT":
      return "Check-out";

    case "COMPLETED":
      return "Completada";
  }
}

function getSourceLabel(source: ReservationSource) {
  switch (source) {
    case "WEBSITE":
      return "Sitio web";

    case "WHATSAPP":
      return "WhatsApp";

    case "PHONE":
      return "Teléfono";

    case "WALK_IN":
      return "Presencial";

    case "AIRBNB":
      return "Airbnb";

    case "OTHER":
      return "Otro";
  }
}

function getPaymentOptionLabel(paymentOption: PaymentOption) {
  switch (paymentOption) {
    case "FULL":
      return "Pago completo";

    case "DEPOSIT_50":
      return "Anticipo 50 %";

    default:
      return "Sin modalidad registrada";
  }
}

export default function CustomerDetailPage() {
  const params = useParams<{
    id: string;
  }>();

  const customerId = params.id;

  const [data, setData] = useState<CustomerDetailResponse | null>(null);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState<string | null>(null);

  const loadCustomer = useCallback(async () => {
    if (!customerId) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        businessId: BUSINESS_ID,
      });

      const response = await fetch(
        `/api/customers/${customerId}?${params.toString()}`,
        {
          cache: "no-store",
        },
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof result.error === "string"
            ? result.error
            : "No fue posible obtener el cliente",
        );
      }

      setData(result as CustomerDetailResponse);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "No fue posible obtener el cliente",
      );
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    void loadCustomer();
  }, [loadCustomer]);

  if (loading) {
    return (
      <main className="mx-auto w-full max-w-7xl p-4 sm:p-6">
        <div className="flex min-h-80 items-center justify-center">
          <p className="text-sm text-zinc-500">Cargando cliente...</p>
        </div>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="mx-auto w-full max-w-7xl p-4 sm:p-6">
        <Link
          href="/admin/customers"
          className="text-sm font-medium text-zinc-600 hover:text-zinc-900"
        >
          ← Volver a clientes
        </Link>

        <div className="mt-6 flex min-h-64 flex-col items-center justify-center gap-4 rounded-xl border border-zinc-200 bg-white p-8 text-center">
          <p className="text-sm font-medium text-red-700">
            {error || "Cliente no encontrado"}
          </p>

          <button
            type="button"
            onClick={() => void loadCustomer()}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium"
          >
            Reintentar
          </button>
        </div>
      </main>
    );
  }

  const { customer, summary, reservations } = data;

  return (
    <main className="mx-auto w-full max-w-7xl p-4 sm:p-6">
      <div className="mb-6">
        <Link
          href="/admin/customers"
          className="text-sm font-medium text-zinc-600 hover:text-zinc-900"
        >
          ← Volver a clientes
        </Link>

        <div className="mt-4">
          <h1 className="text-2xl font-semibold tracking-tight">
            {customer.firstName} {customer.lastName}
          </h1>

          <p className="mt-2 text-sm text-zinc-500">
            Historial y reservas del cliente.
          </p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <section className="rounded-xl border border-zinc-200 bg-white">
            <div className="border-b border-zinc-200 px-5 py-4">
              <h2 className="font-semibold">Datos del cliente</h2>
            </div>

            <div className="grid gap-5 p-5 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Nombre
                </p>

                <p className="mt-1 text-sm font-medium">
                  {customer.firstName} {customer.lastName}
                </p>
              </div>

              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Correo
                </p>

                <p className="mt-1 text-sm">
                  {customer.email || "Sin correo registrado"}
                </p>
              </div>

              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Teléfono
                </p>

                <p className="mt-1 text-sm">
                  {customer.phone || "Sin teléfono registrado"}
                </p>
              </div>

              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Cliente desde
                </p>

                <p className="mt-1 text-sm">{formatDate(customer.createdAt)}</p>
              </div>
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
            <div className="border-b border-zinc-200 px-5 py-4">
              <h2 className="font-semibold">Reservas</h2>

              <p className="mt-1 text-sm text-zinc-500">
                Historial ordenado de la reserva más reciente a la más antigua.
              </p>
            </div>

            {reservations.length === 0 ? (
              <div className="flex min-h-48 items-center justify-center p-8">
                <p className="text-sm text-zinc-500">
                  Este cliente todavía no tiene reservas.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-zinc-200">
                {reservations.map((reservation) => {
                  const serviceNames = reservation.services
                    .map((service) => service.name)
                    .join(", ");

                  const resourceCodes = reservation.services
                    .flatMap((service) => service.resources)
                    .map((resource) => resource.code || resource.name)
                    .join(", ");

                  return (
                    <article key={reservation.id} className="p-5">
                      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/admin/reservations/${reservation.id}`}
                              className="font-semibold hover:underline"
                            >
                              {reservation.confirmationCode}
                            </Link>

                            <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium">
                              {getStatusLabel(reservation.status)}
                            </span>
                          </div>

                          <p className="mt-2 text-sm text-zinc-600">
                            {serviceNames || "Sin servicio"}
                          </p>

                          <p className="mt-1 text-sm text-zinc-500">
                            {formatDate(reservation.startAt)}
                            {" → "}
                            {formatDate(reservation.endAt)}
                          </p>
                        </div>

                        <div className="lg:text-right">
                          <p className="font-semibold">
                            {formatMoney(reservation.total)}
                          </p>

                          <p className="mt-1 text-xs text-zinc-500">
                            Creada {formatDateTime(reservation.createdAt)}
                          </p>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-4 rounded-lg bg-zinc-50 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                            Origen
                          </p>

                          <p className="mt-1">
                            {getSourceLabel(reservation.source)}
                          </p>
                        </div>

                        <div>
                          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                            Huéspedes
                          </p>

                          <p className="mt-1">{reservation.guests}</p>
                        </div>

                        <div>
                          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                            Pago
                          </p>

                          <p className="mt-1">
                            {getPaymentOptionLabel(reservation.paymentOption)}
                          </p>
                        </div>

                        <div>
                          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                            Recurso
                          </p>

                          <p className="mt-1">
                            {resourceCodes || "Sin asignar"}
                          </p>
                        </div>
                      </div>

                      <div className="mt-4">
                        <Link
                          href={`/admin/reservations/${reservation.id}`}
                          className="text-sm font-medium hover:underline"
                        >
                          Ver reserva →
                        </Link>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-6">
          <section className="rounded-xl border border-zinc-200 bg-white p-5">
            <h2 className="font-semibold">Resumen</h2>

            <dl className="mt-5 space-y-4">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Reservas
                </dt>

                <dd className="mt-1 text-2xl font-semibold">
                  {summary.reservationCount}
                </dd>
              </div>

              <div className="border-t border-zinc-200 pt-4">
                <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Total reservado
                </dt>

                <dd className="mt-1 text-xl font-semibold">
                  {formatMoney(summary.totalReserved)}
                </dd>

                <p className="mt-2 text-xs text-zinc-500">
                  Suma nominal de las reservas registradas.
                </p>
              </div>
            </dl>
          </section>

          <section className="rounded-xl border border-zinc-200 bg-white p-5">
            <h2 className="font-semibold">Identificador</h2>

            <p className="mt-3 break-all text-xs text-zinc-500">
              {customer.id}
            </p>
          </section>
        </aside>
      </div>
    </main>
  );
}
