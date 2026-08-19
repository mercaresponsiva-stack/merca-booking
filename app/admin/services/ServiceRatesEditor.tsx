"use client";

import { FormEvent, useState } from "react";

const BUSINESS_ID = "cmsni1uij0000ewvwjzoenugh";

type MoneyValue = string | number;

type ServiceRate = {
  id: string;

  name: string;

  startDate: string;
  endDate: string;

  weekdayPrice: MoneyValue;
  weekendPrice: MoneyValue;

  isActive: boolean;

  createdAt: string;
  updatedAt: string;
};

type RateForm = {
  name: string;

  startDate: string;
  endDate: string;

  weekdayPrice: string;
  weekendPrice: string;

  isActive: boolean;
};

type ConflictingRate = {
  id: string;

  name: string;

  startDate: string;
  endDate: string;
};

type ApiResponse = {
  success?: boolean;

  error?: string;
  code?: string;

  rate?: ServiceRate;

  conflictingRate?: ConflictingRate;
};

type Props = {
  serviceId: string;

  serviceName: string;

  serviceIsActive: boolean;

  currentRates: ServiceRate[];

  onClose: () => void;

  onSaved: () => Promise<void> | void;
};

function createEmptyForm(): RateForm {
  return {
    name: "",

    startDate: "",
    endDate: "",

    weekdayPrice: "",
    weekendPrice: "",

    isActive: true,
  };
}

function toDateInput(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString().slice(0, 10);
}

function rateToForm(rate: ServiceRate): RateForm {
  return {
    name: rate.name,

    startDate: toDateInput(rate.startDate),

    endDate: toDateInput(rate.endDate),

    weekdayPrice: String(rate.weekdayPrice),

    weekendPrice: String(rate.weekendPrice),

    isActive: rate.isActive,
  };
}

function formatMoney(value: MoneyValue) {
  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    return "—";
  }

  return new Intl.NumberFormat("es-SV", {
    style: "currency",

    currency: "USD",

    minimumFractionDigits: 2,
  }).format(amount);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-SV", {
    dateStyle: "medium",

    timeZone: "UTC",
  }).format(new Date(value));
}

export default function ServiceRatesEditor({
  serviceId,

  serviceName,

  serviceIsActive,

  currentRates,

  onClose,

  onSaved,
}: Props) {
  const [creating, setCreating] = useState(false);

  const [editingRateId, setEditingRateId] = useState<string | null>(null);

  const [form, setForm] = useState<RateForm>(createEmptyForm());

  const [saving, setSaving] = useState(false);

  const [changingStateId, setChangingStateId] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);

  const [conflictingRate, setConflictingRate] =
    useState<ConflictingRate | null>(null);

  const editingRate = editingRateId
    ? (currentRates.find((rate) => rate.id === editingRateId) ?? null)
    : null;

  const formVisible = creating || editingRate !== null;

  function scrollToRateForm() {
    window.requestAnimationFrame(() => {
      document.getElementById("service-rate-form")?.scrollIntoView({
        behavior: "smooth",

        block: "start",
      });
    });
  }

  function startCreating() {
    setCreating(true);

    setEditingRateId(null);

    setForm(createEmptyForm());

    setError(null);

    setConflictingRate(null);

    scrollToRateForm();
  }

  function startEditing(rate: ServiceRate) {
    setCreating(false);

    setEditingRateId(rate.id);

    setForm(rateToForm(rate));

    setError(null);

    setConflictingRate(null);

    scrollToRateForm();
  }

  function closeRateForm() {
    setCreating(false);

    setEditingRateId(null);

    setForm(createEmptyForm());

    setError(null);

    setConflictingRate(null);
  }

  async function createRate(data: RateForm) {
    const response = await fetch("/api/rates", {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        businessId: BUSINESS_ID,

        serviceId,

        name: data.name.trim(),

        startDate: data.startDate,

        endDate: data.endDate,

        weekdayPrice: Number(data.weekdayPrice),

        weekendPrice: Number(data.weekendPrice),

        isActive: data.isActive,
      }),
    });

    const result = (await response.json()) as ApiResponse;

    if (!response.ok || !result.success) {
      const apiError = new Error(
        result.error || "No fue posible crear la tarifa",
      ) as Error & {
        conflictingRate?: ConflictingRate;
      };

      apiError.conflictingRate = result.conflictingRate;

      throw apiError;
    }

    return result;
  }

  async function patchRate(
    rate: ServiceRate,

    data: RateForm,

    isActive = data.isActive,
  ) {
    const response = await fetch(`/api/rates/${rate.id}`, {
      method: "PATCH",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        businessId: BUSINESS_ID,

        name: data.name.trim(),

        startDate: data.startDate,

        endDate: data.endDate,

        weekdayPrice: Number(data.weekdayPrice),

        weekendPrice: Number(data.weekendPrice),

        isActive,
      }),
    });

    const result = (await response.json()) as ApiResponse;

    if (!response.ok || !result.success) {
      const apiError = new Error(
        result.error || "No fue posible actualizar la tarifa",
      ) as Error & {
        conflictingRate?: ConflictingRate;
      };

      apiError.conflictingRate = result.conflictingRate;

      throw apiError;
    }

    return result;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setSaving(true);

    setError(null);

    setConflictingRate(null);

    try {
      if (creating) {
        await createRate(form);
      } else {
        if (!editingRate) {
          throw new Error("Tarifa no encontrada");
        }

        await patchRate(
          editingRate,

          form,
        );
      }

      closeRateForm();

      await onSaved();
    } catch (saveError) {
      const apiError = saveError as Error & {
        conflictingRate?: ConflictingRate;
      };

      setError(apiError.message);

      setConflictingRate(apiError.conflictingRate ?? null);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(rate: ServiceRate) {
    const nextActive = !rate.isActive;

    if (
      !nextActive &&
      !window.confirm(
        `¿Desactivar ${rate.name}? Esta tarifa dejará de utilizarse en nuevas cotizaciones.`,
      )
    ) {
      return;
    }

    setChangingStateId(rate.id);

    setError(null);

    setConflictingRate(null);

    try {
      await patchRate(
        rate,

        rateToForm(rate),

        nextActive,
      );

      await onSaved();
    } catch (toggleError) {
      const apiError = toggleError as Error & {
        conflictingRate?: ConflictingRate;
      };

      setError(apiError.message);

      setConflictingRate(apiError.conflictingRate ?? null);
    } finally {
      setChangingStateId(null);
    }
  }

  return (
    <section
      id="service-rates-editor"
      className="scroll-mt-6 rounded-xl border border-zinc-200 bg-white"
    >
      <div className="flex flex-col gap-4 border-b border-zinc-200 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="font-semibold text-zinc-950">Tarifas</h2>

          <p className="mt-1 text-sm text-zinc-500">{serviceName}</p>
        </div>

        <button
          type="button"
          onClick={startCreating}
          disabled={saving}
          className="h-9 rounded-lg bg-zinc-950 px-3 text-sm font-medium text-white disabled:opacity-50"
        >
          Nueva tarifa
        </button>
      </div>

      <div className="space-y-5 p-5">
        <div className="rounded-lg border border-zinc-200 p-4">
          <p className="text-sm font-medium text-zinc-900">
            Períodos de tarifas
          </p>

          <p className="mt-1 text-sm leading-6 text-zinc-500">
            Dos tarifas activas del mismo servicio no pueden cubrir las mismas
            fechas. Las tarifas inactivas se conservan, pero no participan en
            nuevas cotizaciones.
          </p>
        </div>

        {serviceIsActive &&
          currentRates.filter((rate) => rate.isActive).length === 0 && (
            <div className="rounded-lg border border-zinc-300 p-4">
              <p className="text-sm font-medium text-zinc-950">
                Servicio activo sin tarifa activa
              </p>

              <p className="mt-1 text-sm text-zinc-500">
                Configura o reactiva una tarifa para que este servicio pueda
                cotizar las fechas correspondientes.
              </p>
            </div>
          )}

        {formVisible && (
          <form
            id="service-rate-form"
            onSubmit={handleSubmit}
            className="scroll-mt-6 space-y-5 rounded-xl border border-zinc-200 p-4"
          >
            <div>
              <h3 className="text-sm font-semibold text-zinc-950">
                {creating ? "Nueva tarifa" : "Editar tarifa"}
              </h3>

              <p className="mt-1 text-xs text-zinc-500">
                {creating
                  ? "Agrega un nuevo período de precios."
                  : editingRate?.name}
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1.5 md:col-span-2">
                <span className="text-sm font-medium text-zinc-700">
                  Nombre
                </span>

                <input
                  required
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,

                      name: event.target.value,
                    }))
                  }
                  placeholder="Ej. Tarifa 2027"
                  className="h-10 w-full rounded-lg border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-500"
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-sm font-medium text-zinc-700">Desde</span>

                <input
                  required
                  type="date"
                  value={form.startDate}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,

                      startDate: event.target.value,
                    }))
                  }
                  className="h-10 w-full rounded-lg border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-500"
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-sm font-medium text-zinc-700">Hasta</span>

                <input
                  required
                  type="date"
                  value={form.endDate}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,

                      endDate: event.target.value,
                    }))
                  }
                  className="h-10 w-full rounded-lg border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-500"
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-sm font-medium text-zinc-700">
                  Entre semana
                </span>

                <input
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.weekdayPrice}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,

                      weekdayPrice: event.target.value,
                    }))
                  }
                  placeholder="0.00"
                  className="h-10 w-full rounded-lg border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-500"
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-sm font-medium text-zinc-700">
                  Fin de semana
                </span>

                <input
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.weekendPrice}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,

                      weekendPrice: event.target.value,
                    }))
                  }
                  placeholder="0.00"
                  className="h-10 w-full rounded-lg border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-500"
                />
              </label>
            </div>

            <label className="flex items-center gap-3 rounded-lg border border-zinc-200 p-4">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,

                    isActive: event.target.checked,
                  }))
                }
              />

              <div>
                <p className="text-sm font-medium text-zinc-900">
                  Tarifa activa
                </p>

                <p className="text-xs text-zinc-500">
                  Las tarifas activas pueden utilizarse para nuevas
                  cotizaciones.
                </p>
              </div>
            </label>

            {error && (
              <div className="rounded-lg border border-zinc-300 p-4">
                <p className="text-sm font-medium text-zinc-950">{error}</p>

                {conflictingRate && (
                  <div className="mt-3 rounded-lg border border-zinc-200 p-3">
                    <p className="text-sm font-medium text-zinc-900">
                      {conflictingRate.name}
                    </p>

                    <p className="mt-1 text-xs text-zinc-500">
                      {formatDate(conflictingRate.startDate)} →{" "}
                      {formatDate(conflictingRate.endDate)}
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={closeRateForm}
                disabled={saving}
                className="h-10 rounded-lg border border-zinc-300 px-4 text-sm font-medium text-zinc-700 disabled:opacity-50"
              >
                Cancelar
              </button>

              <button
                type="submit"
                disabled={saving}
                className="h-10 rounded-lg bg-zinc-950 px-4 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving
                  ? "Guardando..."
                  : creating
                    ? "Crear tarifa"
                    : "Guardar cambios"}
              </button>
            </div>
          </form>
        )}

        {currentRates.length === 0 ? (
          <div className="rounded-lg border border-zinc-200 p-6 text-center text-sm text-zinc-500">
            Este servicio todavía no tiene tarifas configuradas.
          </div>
        ) : (
          <div className="divide-y divide-zinc-200 rounded-xl border border-zinc-200">
            {currentRates.map((rate) => (
              <article key={rate.id} className="p-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-zinc-950">
                        {rate.name}
                      </h3>

                      <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-600">
                        {rate.isActive ? "Activa" : "Inactiva"}
                      </span>
                    </div>

                    <p className="text-sm text-zinc-500">
                      {formatDate(rate.startDate)} → {formatDate(rate.endDate)}
                    </p>

                    <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-zinc-500">
                      <span>
                        Entre semana: {formatMoney(rate.weekdayPrice)}
                      </span>

                      <span>
                        Fin de semana: {formatMoney(rate.weekendPrice)}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => startEditing(rate)}
                      disabled={saving || changingStateId === rate.id}
                      className="h-9 rounded-lg border border-zinc-300 px-3 text-sm font-medium text-zinc-700 disabled:opacity-50"
                    >
                      Editar
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleToggleActive(rate)}
                      disabled={saving || changingStateId === rate.id}
                      className="h-9 rounded-lg border border-zinc-300 px-3 text-sm font-medium text-zinc-700 disabled:opacity-50"
                    >
                      {changingStateId === rate.id
                        ? "Procesando..."
                        : rate.isActive
                          ? "Desactivar"
                          : "Reactivar"}
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}

        <div className="flex">
          <button
            type="button"
            onClick={onClose}
            disabled={saving || changingStateId !== null}
            className="h-10 rounded-lg border border-zinc-300 px-4 text-sm font-medium text-zinc-700 disabled:opacity-50"
          >
            Cerrar
          </button>
        </div>
      </div>
    </section>
  );
}
