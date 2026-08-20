"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { DEV_BUSINESS_ID as BUSINESS_ID } from "@/lib/config/dev-context";

type RefundPolicy = {
  id: string;
  businessId: string;

  name: string;

  fullRefundDays: number;
  annualAdministrativeRate: number;

  effectiveFrom: string;
  effectiveTo: string | null;

  isActive: boolean;
  isCurrent: boolean;

  refundCount: number;

  createdAt: string;
  updatedAt: string;
};

type RefundPoliciesResponse = {
  success: boolean;

  business?: {
    id: string;
    name: string;
  };

  items?: RefundPolicy[];

  error?: string;
};

type ApiResponse = {
  success?: boolean;

  item?: RefundPolicy;

  error?: string;
};

type PolicyForm = {
  name: string;

  fullRefundDays: string;

  annualAdministrativeRatePercent: string;

  scheduleFuture: boolean;

  effectiveFrom: string;
};

function createEmptyForm(): PolicyForm {
  return {
    name: "",

    fullRefundDays: "8",

    annualAdministrativeRatePercent: "12",

    scheduleFuture: false,

    effectiveFrom: "",
  };
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("es-SV", {
    dateStyle: "medium",
    timeStyle: "short",

    timeZone: "America/El_Salvador",
  }).format(new Date(value));
}

function formatPercent(value: number) {
  return new Intl.NumberFormat("es-SV", {
    style: "percent",

    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

function getPolicyState(policy: RefundPolicy) {
  if (policy.isCurrent) {
    return "CURRENT";
  }

  const now = new Date();

  const effectiveFrom = new Date(policy.effectiveFrom);

  if (policy.isActive && effectiveFrom > now) {
    return "UPCOMING";
  }

  return "HISTORICAL";
}

export default function RefundPoliciesPage() {
  const [policies, setPolicies] = useState<RefundPolicy[]>([]);

  const [businessName, setBusinessName] = useState("");

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);

  const [form, setForm] = useState<PolicyForm>(createEmptyForm());

  const [formError, setFormError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);

  const loadPolicies = useCallback(async () => {
    setLoading(true);

    setError(null);

    try {
      const response = await fetch(
        `/api/refund-policies?businessId=${BUSINESS_ID}`,
        {
          cache: "no-store",
        },
      );

      const result = (await response.json()) as RefundPoliciesResponse;

      if (!response.ok || !result.success) {
        throw new Error(
          result.error || "No fue posible cargar las políticas de reembolso",
        );
      }

      setPolicies(result.items ?? []);

      setBusinessName(result.business?.name ?? "");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No fue posible cargar las políticas de reembolso",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPolicies();
  }, [loadPolicies]);

  const currentPolicy = useMemo(
    () => policies.find((policy) => policy.isCurrent) ?? null,
    [policies],
  );

  const upcomingPolicies = useMemo(
    () =>
      policies
        .filter((policy) => getPolicyState(policy) === "UPCOMING")
        .sort(
          (first, second) =>
            new Date(first.effectiveFrom).getTime() -
            new Date(second.effectiveFrom).getTime(),
        ),
    [policies],
  );

  const historicalPolicies = useMemo(
    () => policies.filter((policy) => getPolicyState(policy) === "HISTORICAL"),
    [policies],
  );

  function startCreating() {
    setCreating(true);

    setForm(createEmptyForm());

    setFormError(null);

    window.requestAnimationFrame(() => {
      document.getElementById("refund-policy-form")?.scrollIntoView({
        behavior: "smooth",

        block: "start",
      });
    });
  }

  function closeForm() {
    setCreating(false);

    setForm(createEmptyForm());

    setFormError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setSaving(true);

    setFormError(null);

    try {
      const fullRefundDays = Number(form.fullRefundDays);

      const ratePercent = Number(form.annualAdministrativeRatePercent);

      if (!Number.isInteger(fullRefundDays) || fullRefundDays < 0) {
        throw new Error(
          "Los días de devolución completa deben ser un entero mayor o igual a 0.",
        );
      }

      if (
        !Number.isFinite(ratePercent) ||
        ratePercent < 0 ||
        ratePercent > 100
      ) {
        throw new Error(
          "La tasa administrativa anual debe estar entre 0 % y 100 %.",
        );
      }

      if (form.scheduleFuture && !form.effectiveFrom) {
        throw new Error(
          "Selecciona la fecha y hora de inicio de la nueva versión.",
        );
      }

      const body: {
        businessId: string;

        name: string;

        fullRefundDays: number;

        annualAdministrativeRate: number;

        effectiveFrom?: string;
      } = {
        businessId: BUSINESS_ID,

        name: form.name.trim(),

        fullRefundDays,

        annualAdministrativeRate: ratePercent / 100,
      };

      /*
       * Si no se programa una fecha,
       * omitimos effectiveFrom.
       *
       * El servidor utilizará el
       * momento exacto de creación.
       */
      if (form.scheduleFuture) {
        const scheduledDate = new Date(form.effectiveFrom);

        if (Number.isNaN(scheduledDate.getTime())) {
          throw new Error("La fecha de vigencia no es válida.");
        }

        if (scheduledDate <= new Date()) {
          throw new Error("La fecha programada debe estar en el futuro.");
        }

        body.effectiveFrom = scheduledDate.toISOString();
      }

      const response = await fetch("/api/refund-policies", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify(body),
      });

      const result = (await response.json()) as ApiResponse;

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ||
            "No fue posible crear la nueva versión de la política",
        );
      }

      closeForm();

      await loadPolicies();
    } catch (saveError) {
      setFormError(
        saveError instanceof Error
          ? saveError.message
          : "No fue posible crear la política",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">
            Políticas de reembolso
          </h1>

          <p className="text-sm text-zinc-500">
            Administra las reglas utilizadas al calcular cancelaciones y
            reembolsos
            {businessName ? ` de ${businessName}` : ""}.
          </p>
        </div>

        <button
          type="button"
          onClick={startCreating}
          disabled={loading || saving}
          className="h-10 rounded-lg bg-zinc-950 px-4 text-sm font-medium text-white disabled:opacity-50"
        >
          Crear nueva versión
        </button>
      </header>

      {error && (
        <section className="rounded-xl border border-zinc-300 bg-white p-4">
          <p className="font-medium text-zinc-950">
            No fue posible completar la operación
          </p>

          <p className="mt-1 text-sm text-zinc-600">{error}</p>
        </section>
      )}

      <section className="rounded-xl border border-zinc-200 bg-white p-5">
        <h2 className="font-semibold text-zinc-950">
          Cómo funciona el versionado
        </h2>

        <p className="mt-2 max-w-4xl text-sm leading-6 text-zinc-600">
          Las condiciones de una política vigente no se sobrescriben. Cuando
          cambian los días de devolución o la tasa administrativa se crea una
          nueva versión. La versión anterior conserva su período de vigencia y
          los reembolsos históricos mantienen los valores con los que fueron
          calculados.
        </p>
      </section>

      {creating && (
        <section
          id="refund-policy-form"
          className="scroll-mt-6 rounded-xl border border-zinc-200 bg-white"
        >
          <div className="border-b border-zinc-200 px-5 py-4">
            <h2 className="font-semibold text-zinc-950">
              Nueva versión de política
            </h2>

            <p className="mt-1 text-sm text-zinc-500">
              La versión vigente se cerrará automáticamente justo antes del
              inicio de esta nueva política.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5 p-5">
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
                  placeholder="Ej. Política general 2027"
                  className="h-10 w-full rounded-lg border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-500"
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-sm font-medium text-zinc-700">
                  Días de devolución completa
                </span>

                <input
                  required
                  type="number"
                  min="0"
                  step="1"
                  value={form.fullRefundDays}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,

                      fullRefundDays: event.target.value,
                    }))
                  }
                  className="h-10 w-full rounded-lg border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-500"
                />

                <p className="text-xs text-zinc-500">
                  Período utilizado por el motor para determinar la devolución
                  completa cuando corresponda.
                </p>
              </label>

              <label className="space-y-1.5">
                <span className="text-sm font-medium text-zinc-700">
                  Tasa administrativa anual
                </span>

                <div className="relative">
                  <input
                    required
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={form.annualAdministrativeRatePercent}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,

                        annualAdministrativeRatePercent: event.target.value,
                      }))
                    }
                    className="h-10 w-full rounded-lg border border-zinc-300 px-3 pr-9 text-sm outline-none focus:border-zinc-500"
                  />

                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-zinc-500">
                    %
                  </span>
                </div>

                <p className="text-xs text-zinc-500">
                  Ejemplo: escribe 12 para una tasa anual de 12 %.
                </p>
              </label>
            </div>

            <label className="flex items-start gap-3 rounded-lg border border-zinc-200 p-4">
              <input
                type="checkbox"
                checked={form.scheduleFuture}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,

                    scheduleFuture: event.target.checked,

                    effectiveFrom: event.target.checked
                      ? current.effectiveFrom
                      : "",
                  }))
                }
                className="mt-1"
              />

              <div>
                <p className="text-sm font-medium text-zinc-900">
                  Programar para una fecha futura
                </p>

                <p className="mt-1 text-xs text-zinc-500">
                  Si no se marca, la nueva política entra en vigencia en el
                  momento de guardarla.
                </p>
              </div>
            </label>

            {form.scheduleFuture && (
              <label className="block max-w-md space-y-1.5">
                <span className="text-sm font-medium text-zinc-700">
                  Inicio de vigencia
                </span>

                <input
                  required
                  type="datetime-local"
                  value={form.effectiveFrom}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,

                      effectiveFrom: event.target.value,
                    }))
                  }
                  className="h-10 w-full rounded-lg border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-500"
                />

                <p className="text-xs text-zinc-500">
                  La política actual seguirá vigente hasta un milisegundo antes
                  de este momento.
                </p>
              </label>
            )}

            {currentPolicy && (
              <div className="rounded-lg border border-zinc-200 p-4">
                <p className="text-sm font-medium text-zinc-900">
                  Política que será reemplazada
                </p>

                <p className="mt-2 text-sm text-zinc-600">
                  {currentPolicy.name}
                </p>

                <p className="mt-1 text-xs text-zinc-500">
                  {currentPolicy.fullRefundDays} días ·{" "}
                  {formatPercent(currentPolicy.annualAdministrativeRate)} anual
                </p>
              </div>
            )}

            {formError && (
              <div className="rounded-lg border border-zinc-300 p-4">
                <p className="text-sm font-medium text-zinc-950">{formError}</p>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={closeForm}
                className="h-10 rounded-lg border border-zinc-300 px-4 text-sm font-medium text-zinc-700 disabled:opacity-50"
              >
                Cancelar
              </button>

              <button
                type="submit"
                disabled={saving}
                className="h-10 rounded-lg bg-zinc-950 px-4 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving ? "Creando versión..." : "Crear nueva versión"}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="rounded-xl border border-zinc-200 bg-white">
        <div className="border-b border-zinc-200 p-5">
          <h2 className="font-semibold text-zinc-950">Política vigente</h2>

          <p className="mt-1 text-sm text-zinc-500">
            Política utilizada por las cancelaciones realizadas actualmente.
          </p>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-zinc-500">
            Cargando política...
          </div>
        ) : !currentPolicy ? (
          <div className="p-8">
            <p className="font-medium text-zinc-950">
              No existe una política vigente
            </p>

            <p className="mt-1 text-sm text-zinc-500">
              Las cancelaciones que requieran una política de reembolso no
              podrán calcularse hasta configurar una versión vigente.
            </p>
          </div>
        ) : (
          <article className="p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-zinc-950">
                {currentPolicy.name}
              </h3>

              <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-600">
                Vigente
              </span>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Devolución completa
                </p>

                <p className="mt-1 text-sm font-medium text-zinc-900">
                  {currentPolicy.fullRefundDays} días
                </p>
              </div>

              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Tasa anual
                </p>

                <p className="mt-1 text-sm font-medium text-zinc-900">
                  {formatPercent(currentPolicy.annualAdministrativeRate)}
                </p>
              </div>

              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Vigente desde
                </p>

                <p className="mt-1 text-sm font-medium text-zinc-900">
                  {formatDateTime(currentPolicy.effectiveFrom)}
                </p>
              </div>

              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Reembolsos vinculados
                </p>

                <p className="mt-1 text-sm font-medium text-zinc-900">
                  {currentPolicy.refundCount}
                </p>
              </div>
            </div>
          </article>
        )}
      </section>

      {upcomingPolicies.length > 0 && (
        <section className="rounded-xl border border-zinc-200 bg-white">
          <div className="border-b border-zinc-200 p-5">
            <h2 className="font-semibold text-zinc-950">Próximas versiones</h2>

            <p className="mt-1 text-sm text-zinc-500">
              Políticas programadas para entrar en vigencia posteriormente.
            </p>
          </div>

          <div className="divide-y divide-zinc-200">
            {upcomingPolicies.map((policy) => (
              <article key={policy.id} className="p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-zinc-950">{policy.name}</h3>

                  <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-600">
                    Programada
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm text-zinc-600">
                  <span>{policy.fullRefundDays} días</span>

                  <span>
                    {formatPercent(policy.annualAdministrativeRate)} anual
                  </span>

                  <span>Desde {formatDateTime(policy.effectiveFrom)}</span>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-xl border border-zinc-200 bg-white">
        <div className="border-b border-zinc-200 p-5">
          <h2 className="font-semibold text-zinc-950">Historial</h2>

          <p className="mt-1 text-sm text-zinc-500">
            Versiones anteriores conservadas para auditoría y trazabilidad.
          </p>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-zinc-500">
            Cargando historial...
          </div>
        ) : historicalPolicies.length === 0 ? (
          <div className="p-8 text-center text-sm text-zinc-500">
            Todavía no existen versiones anteriores.
          </div>
        ) : (
          <div className="divide-y divide-zinc-200">
            {historicalPolicies.map((policy) => (
              <article key={policy.id} className="p-5">
                <h3 className="font-semibold text-zinc-950">{policy.name}</h3>

                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm text-zinc-600">
                  <span>{policy.fullRefundDays} días</span>

                  <span>
                    {formatPercent(policy.annualAdministrativeRate)} anual
                  </span>

                  <span>Desde {formatDateTime(policy.effectiveFrom)}</span>

                  <span>
                    Hasta{" "}
                    {policy.effectiveTo
                      ? formatDateTime(policy.effectiveTo)
                      : "—"}
                  </span>

                  <span>Reembolsos: {policy.refundCount}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
