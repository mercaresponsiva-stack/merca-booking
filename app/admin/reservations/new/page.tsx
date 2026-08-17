"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

const BUSINESS_ID = "cmsni1uij0000ewvwjzoenugh";

type PaymentOption = "FULL" | "DEPOSIT_50";

type ReservationSource =
  | "WEBSITE"
  | "WHATSAPP"
  | "PHONE"
  | "WALK_IN"
  | "AIRBNB"
  | "OTHER";

type Service = {
  id: string;
  name: string;
  slug: string;
  description: string | null;

  durationMinutes: number | null;

  maxPeople: number;
  maxAdults: number | null;
  maxChildren: number | null;
};

type ServicesResponse = {
  success: true;

  business: {
    id: string;
    name: string;
  };

  services: Service[];
};

type CreateReservationResponse = {
  success: true;

  reservation: {
    id: string;
    confirmationCode: string;
    status: string;

    businessId: string;

    startAt: string;
    endAt: string;

    checkIn: string;
    checkOut: string;

    guests: number;
    adults: number;
    children: number;

    subtotal: number | string;
    total: number | string;

    paymentOption: PaymentOption;
  };
};

type FormState = {
  firstName: string;
  lastName: string;

  email: string;
  phone: string;

  serviceId: string;

  checkIn: string;
  checkOut: string;

  adults: string;
  children: string;

  paymentOption: PaymentOption;

  source: ReservationSource;

  specialRequests: string;
};

const INITIAL_FORM: FormState = {
  firstName: "",
  lastName: "",

  email: "",
  phone: "",

  serviceId: "",

  checkIn: "",
  checkOut: "",

  adults: "1",
  children: "0",

  paymentOption: "DEPOSIT_50",

  source: "PHONE",

  specialRequests: "",
};

function getSourceLabel(source: ReservationSource) {
  switch (source) {
    case "WEBSITE":
      return "Sitio web";

    case "WHATSAPP":
      return "WhatsApp";

    case "PHONE":
      return "Teléfono";

    case "WALK_IN":
      return "Cliente presencial";

    case "AIRBNB":
      return "Airbnb";

    case "OTHER":
      return "Otro";
  }
}

export default function NewReservationPage() {
  const router = useRouter();

  const [form, setForm] = useState<FormState>(INITIAL_FORM);

  const [services, setServices] = useState<Service[]>([]);

  const [businessName, setBusinessName] = useState("");

  const [loadingServices, setLoadingServices] = useState(true);

  const [servicesError, setServicesError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);

  const [submitError, setSubmitError] = useState<string | null>(null);

  const loadServices = useCallback(async () => {
    setLoadingServices(true);
    setServicesError(null);

    try {
      const response = await fetch(`/api/services?businessId=${BUSINESS_ID}`, {
        cache: "no-store",
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof result.error === "string"
            ? result.error
            : "No fue posible cargar los servicios",
        );
      }

      const data = result as ServicesResponse;

      setServices(data.services);

      setBusinessName(data.business.name);

      if (data.services.length > 0) {
        setForm((current) => ({
          ...current,

          serviceId: current.serviceId || data.services[0].id,
        }));
      }
    } catch (error) {
      setServicesError(
        error instanceof Error
          ? error.message
          : "No fue posible cargar los servicios",
      );
    } finally {
      setLoadingServices(false);
    }
  }, []);

  useEffect(() => {
    void loadServices();
  }, [loadServices]);

  const selectedService = useMemo(
    () => services.find((service) => service.id === form.serviceId) ?? null,
    [services, form.serviceId],
  );

  const adults = Number(form.adults);

  const children = Number(form.children);

  const guests =
    Number.isFinite(adults) && Number.isFinite(children)
      ? adults + children
      : 0;

  const localValidationError = useMemo(() => {
    if (!form.firstName.trim() || !form.lastName.trim()) {
      return null;
    }

    if (!form.serviceId) {
      return null;
    }

    if (!form.checkIn || !form.checkOut) {
      return null;
    }

    if (form.checkOut <= form.checkIn) {
      return "La fecha de salida debe ser posterior a la fecha de entrada.";
    }

    if (!Number.isInteger(adults) || adults < 1) {
      return "Debe haber al menos 1 adulto.";
    }

    if (!Number.isInteger(children) || children < 0) {
      return "La cantidad de niños no es válida.";
    }

    if (selectedService) {
      if (guests > selectedService.maxPeople) {
        return `La capacidad máxima de ${selectedService.name} es de ${selectedService.maxPeople} huésped(es).`;
      }

      if (
        selectedService.maxAdults !== null &&
        adults > selectedService.maxAdults
      ) {
        return `El máximo de adultos para ${selectedService.name} es ${selectedService.maxAdults}.`;
      }

      if (
        selectedService.maxChildren !== null &&
        children > selectedService.maxChildren
      ) {
        return `El máximo de niños para ${selectedService.name} es ${selectedService.maxChildren}.`;
      }
    }

    return null;
  }, [
    adults,
    children,
    form.checkIn,
    form.checkOut,
    form.firstName,
    form.lastName,
    form.serviceId,
    guests,
    selectedService,
  ]);

  const canSubmit =
    !loadingServices &&
    !submitting &&
    !!form.firstName.trim() &&
    !!form.lastName.trim() &&
    !!form.serviceId &&
    !!form.checkIn &&
    !!form.checkOut &&
    !localValidationError;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSubmit) {
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      const response = await fetch("/api/reservations", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          businessId: BUSINESS_ID,

          serviceId: form.serviceId,

          firstName: form.firstName.trim(),

          lastName: form.lastName.trim(),

          email: form.email.trim() || undefined,

          phone: form.phone.trim() || undefined,

          checkIn: form.checkIn,

          checkOut: form.checkOut,

          adults,

          children,

          paymentOption: form.paymentOption,

          source: form.source,

          specialRequests: form.specialRequests.trim() || undefined,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof result.error === "string"
            ? result.error
            : "No fue posible crear la reserva",
        );
      }

      const data = result as CreateReservationResponse;

      router.push(`/admin/reservations/${data.reservation.id}`);

      router.refresh();
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : "No fue posible crear la reserva",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl p-4 sm:p-6">
      <div className="mb-6">
        <Link
          href="/admin/reservations"
          className="text-sm font-medium text-zinc-600 hover:text-zinc-900"
        >
          ← Volver a reservas
        </Link>

        <div className="mt-4">
          <h1 className="text-2xl font-semibold tracking-tight">
            Nueva reserva
          </h1>

          <p className="mt-2 text-sm text-zinc-500">
            {businessName
              ? `Crear una reserva para ${businessName}.`
              : "Crear una nueva reserva."}
          </p>
        </div>
      </div>

      {servicesError && (
        <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p className="font-medium">{servicesError}</p>

          <button
            type="button"
            onClick={() => void loadServices()}
            className="mt-3 rounded-lg border border-red-300 px-3 py-2 text-xs font-medium"
          >
            Reintentar
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <section className="rounded-xl border border-zinc-200 bg-white">
          <div className="border-b border-zinc-200 px-5 py-4">
            <h2 className="font-semibold">Datos del huésped</h2>

            <p className="mt-1 text-sm text-zinc-500">
              Información de contacto de la persona responsable de la reserva.
            </p>
          </div>

          <div className="grid gap-5 p-5 md:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm">
              <span className="font-medium">Nombre *</span>

              <input
                type="text"
                required
                value={form.firstName}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    firstName: event.target.value,
                  }))
                }
                className="h-10 rounded-lg border border-zinc-300 px-3"
              />
            </label>

            <label className="flex flex-col gap-2 text-sm">
              <span className="font-medium">Apellido *</span>

              <input
                type="text"
                required
                value={form.lastName}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    lastName: event.target.value,
                  }))
                }
                className="h-10 rounded-lg border border-zinc-300 px-3"
              />
            </label>

            <label className="flex flex-col gap-2 text-sm">
              <span className="font-medium">Correo electrónico</span>

              <input
                type="email"
                value={form.email}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
                className="h-10 rounded-lg border border-zinc-300 px-3"
              />
            </label>

            <label className="flex flex-col gap-2 text-sm">
              <span className="font-medium">Teléfono</span>

              <input
                type="tel"
                value={form.phone}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    phone: event.target.value,
                  }))
                }
                className="h-10 rounded-lg border border-zinc-300 px-3"
              />
            </label>
          </div>
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white">
          <div className="border-b border-zinc-200 px-5 py-4">
            <h2 className="font-semibold">Estancia</h2>

            <p className="mt-1 text-sm text-zinc-500">
              El sistema validará tarifa, capacidad e inventario al crear la
              reserva.
            </p>
          </div>

          <div className="grid gap-5 p-5 md:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm md:col-span-2">
              <span className="font-medium">Tipo de habitación *</span>

              <select
                required
                disabled={loadingServices}
                value={form.serviceId}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    serviceId: event.target.value,
                  }))
                }
                className="h-10 rounded-lg border border-zinc-300 bg-white px-3 disabled:opacity-50"
              >
                {services.length === 0 && (
                  <option value="">No hay servicios disponibles</option>
                )}

                {services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name}
                  </option>
                ))}
              </select>

              {selectedService && (
                <p className="text-xs text-zinc-500">
                  Capacidad total: {selectedService.maxPeople}
                  {selectedService.maxAdults !== null &&
                    ` · Adultos: ${selectedService.maxAdults}`}
                  {selectedService.maxChildren !== null &&
                    ` · Niños: ${selectedService.maxChildren}`}
                </p>
              )}
            </label>

            <label className="flex flex-col gap-2 text-sm">
              <span className="font-medium">Check-in *</span>

              <input
                type="date"
                required
                value={form.checkIn}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    checkIn: event.target.value,
                  }))
                }
                className="h-10 rounded-lg border border-zinc-300 px-3"
              />
            </label>

            <label className="flex flex-col gap-2 text-sm">
              <span className="font-medium">Check-out *</span>

              <input
                type="date"
                required
                min={form.checkIn || undefined}
                value={form.checkOut}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    checkOut: event.target.value,
                  }))
                }
                className="h-10 rounded-lg border border-zinc-300 px-3"
              />
            </label>

            <label className="flex flex-col gap-2 text-sm">
              <span className="font-medium">Adultos *</span>

              <input
                type="number"
                required
                min={1}
                step={1}
                value={form.adults}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    adults: event.target.value,
                  }))
                }
                className="h-10 rounded-lg border border-zinc-300 px-3"
              />
            </label>

            <label className="flex flex-col gap-2 text-sm">
              <span className="font-medium">Niños</span>

              <input
                type="number"
                min={0}
                step={1}
                value={form.children}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    children: event.target.value,
                  }))
                }
                className="h-10 rounded-lg border border-zinc-300 px-3"
              />
            </label>
          </div>
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white">
          <div className="border-b border-zinc-200 px-5 py-4">
            <h2 className="font-semibold">Reserva y pago</h2>
          </div>

          <div className="grid gap-5 p-5 md:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm">
              <span className="font-medium">Modalidad de pago *</span>

              <select
                value={form.paymentOption}
                onChange={(event) => {
                  const value = event.target.value;

                  if (value === "FULL" || value === "DEPOSIT_50") {
                    setForm((current) => ({
                      ...current,
                      paymentOption: value,
                    }));
                  }
                }}
                className="h-10 rounded-lg border border-zinc-300 bg-white px-3"
              >
                <option value="DEPOSIT_50">Anticipo 50 %</option>

                <option value="FULL">Pago completo</option>
              </select>
            </label>

            <label className="flex flex-col gap-2 text-sm">
              <span className="font-medium">Origen de la reserva *</span>

              <select
                value={form.source}
                onChange={(event) => {
                  const value = event.target.value as ReservationSource;

                  setForm((current) => ({
                    ...current,
                    source: value,
                  }));
                }}
                className="h-10 rounded-lg border border-zinc-300 bg-white px-3"
              >
                {(
                  [
                    "PHONE",
                    "WHATSAPP",
                    "WALK_IN",
                    "WEBSITE",
                    "AIRBNB",
                    "OTHER",
                  ] as ReservationSource[]
                ).map((source) => (
                  <option key={source} value={source}>
                    {getSourceLabel(source)}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-2 text-sm md:col-span-2">
              <span className="font-medium">Solicitudes especiales</span>

              <textarea
                rows={4}
                value={form.specialRequests}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    specialRequests: event.target.value,
                  }))
                }
                placeholder="Ej. llegada tarde, solicitud del huésped, observaciones..."
                className="rounded-lg border border-zinc-300 px-3 py-2"
              />
            </label>
          </div>
        </section>

        {localValidationError && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-800">
            {localValidationError}
          </div>
        )}

        {submitError && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
            {submitError}
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-3">
          <Link
            href="/admin/reservations"
            className="flex h-10 items-center rounded-lg border border-zinc-300 px-5 text-sm font-medium"
          >
            Cancelar
          </Link>

          <button
            type="submit"
            disabled={!canSubmit}
            className="h-10 rounded-lg bg-zinc-900 px-5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? "Creando reserva..." : "Crear reserva"}
          </button>
        </div>
      </form>
    </main>
  );
}
