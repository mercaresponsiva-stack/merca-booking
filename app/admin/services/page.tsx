"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import ResourceRequirementsEditor from "./ResourceRequirementsEditor";
import ServiceRatesEditor from "./ServiceRatesEditor";

import { DEV_BUSINESS_ID as BUSINESS_ID } from "@/lib/config/dev-context";

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

type ServiceResourceRequirement = {
  id: string;

  resourceTypeId: string;

  requiredQuantity: number;

  createdAt: string;

  resourceType: {
    id: string;

    name: string;
    slug: string;

    description: string | null;

    totalResourceCount: number;
    activeResourceCount: number;
  };
};

type Service = {
  id: string;
  businessId: string;

  name: string;
  slug: string;

  description: string | null;

  durationMinutes: number | null;

  maxPeople: number;

  maxAdults: number | null;
  maxChildren: number | null;

  isActive: boolean;

  createdAt: string;
  updatedAt: string;

  activeReservationCount: number;

  resourceTypes: ServiceResourceRequirement[];

  rates: ServiceRate[];
};

type ServicesResponse = {
  success: boolean;

  business?: {
    id: string;
    name: string;
  };

  services?: Service[];

  error?: string;
};

type StateFilter = "ALL" | "ACTIVE" | "INACTIVE";

type ServiceForm = {
  name: string;
  slug: string;

  description: string;

  durationMinutes: string;

  maxPeople: string;

  maxAdults: string;
  maxChildren: string;
};

type ApiConflictReservation = {
  id: string;

  confirmationCode: string;

  status: string;

  guests: number;

  adults: number | null;
  children: number | null;

  startAt: string;
  endAt: string;

  violations?: string[];
};

type ApiErrorResponse = {
  success?: boolean;

  error?: string;
  code?: string;

  reservations?: ApiConflictReservation[];
};

function createEmptyForm(): ServiceForm {
  return {
    name: "",
    slug: "",

    description: "",

    durationMinutes: "",

    maxPeople: "1",

    maxAdults: "",
    maxChildren: "",
  };
}

function serviceToForm(service: Service): ServiceForm {
  return {
    name: service.name,

    slug: service.slug,

    description: service.description ?? "",

    durationMinutes:
      service.durationMinutes === null ? "" : String(service.durationMinutes),

    maxPeople: String(service.maxPeople),

    maxAdults: service.maxAdults === null ? "" : String(service.maxAdults),

    maxChildren:
      service.maxChildren === null ? "" : String(service.maxChildren),
  };
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("es-SV", {
    dateStyle: "medium",
    timeStyle: "short",

    timeZone: "America/El_Salvador",
  }).format(new Date(value));
}

function formatStatus(status: string) {
  switch (status) {
    case "PENDING":
      return "Pendiente";

    case "CONFIRMED":
      return "Confirmada";

    case "CHECKED_IN":
      return "Check-in";

    default:
      return status;
  }
}

function formatViolation(violation: string) {
  switch (violation) {
    case "MAX_PEOPLE":
      return "capacidad total";

    case "MAX_ADULTS":
      return "adultos";

    case "MAX_CHILDREN":
      return "niños";

    default:
      return violation;
  }
}

export default function ServicesPage() {
  const [services, setServices] = useState<Service[]>([]);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState<string | null>(null);

  const [stateFilter, setStateFilter] = useState<StateFilter>("ALL");

  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);

  const [form, setForm] = useState<ServiceForm>(createEmptyForm());

  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);

  const [saving, setSaving] = useState(false);

  const [changingStateId, setChangingStateId] = useState<string | null>(null);

  const [formError, setFormError] = useState<string | null>(null);

  const [conflictReservations, setConflictReservations] = useState<
    ApiConflictReservation[]
  >([]);
  const [resourceEditorId, setResourceEditorId] = useState<string | null>(null);

  const [rateEditorId, setRateEditorId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);

    setError(null);

    try {
      const response = await fetch(
        `/api/services?businessId=${BUSINESS_ID}&includeInactive=true`,
        {
          cache: "no-store",
        },
      );

      const data = (await response.json()) as ServicesResponse;

      if (!response.ok || !data.success) {
        throw new Error(data.error || "No fue posible cargar los servicios");
      }

      setServices(data.services ?? []);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No fue posible cargar los servicios",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const summary = useMemo(() => {
    const total = services.length;

    const active = services.filter((service) => service.isActive).length;

    const inactive = total - active;

    const withActiveReservations = services.filter(
      (service) => service.activeReservationCount > 0,
    ).length;

    return {
      total,

      active,

      inactive,

      withActiveReservations,
    };
  }, [services]);

  const filteredServices = useMemo(() => {
    return services.filter((service) => {
      if (stateFilter === "ACTIVE" && !service.isActive) {
        return false;
      }

      if (stateFilter === "INACTIVE" && service.isActive) {
        return false;
      }

      return true;
    });
  }, [services, stateFilter]);

  const editingService = editingId
    ? (services.find((service) => service.id === editingId) ?? null)
    : null;

  const resourceEditorService = resourceEditorId
    ? (services.find((service) => service.id === resourceEditorId) ?? null)
    : null;

  const rateEditorService = rateEditorId
    ? (services.find((service) => service.id === rateEditorId) ?? null)
    : null;

  const formVisible = creating || editingService !== null;

  function scrollToForm() {
    window.requestAnimationFrame(() => {
      document.getElementById("service-form")?.scrollIntoView({
        behavior: "smooth",

        block: "start",
      });
    });
  }

  function startCreating() {
    setCreating(true);

    setEditingId(null);

    setResourceEditorId(null);

    setRateEditorId(null);

    setForm(createEmptyForm());

    setSlugManuallyEdited(false);

    setFormError(null);

    setConflictReservations([]);

    scrollToForm();
  }

  function startEditing(service: Service) {
    setCreating(false);

    setEditingId(service.id);

    setResourceEditorId(null);

    setRateEditorId(null);

    setForm(serviceToForm(service));

    setSlugManuallyEdited(true);

    setFormError(null);

    setConflictReservations([]);

    scrollToForm();
  }

  function startEditingResources(service: Service) {
    setCreating(false);

    setEditingId(null);

    setResourceEditorId(service.id);

    setRateEditorId(null);

    setFormError(null);

    setConflictReservations([]);

    window.requestAnimationFrame(() => {
      document.getElementById("service-resource-form")?.scrollIntoView({
        behavior: "smooth",

        block: "start",
      });
    });
  }

  function startEditingRates(service: Service) {
    setCreating(false);

    setEditingId(null);

    setResourceEditorId(null);

    setRateEditorId(service.id);

    setFormError(null);

    setConflictReservations([]);

    window.requestAnimationFrame(() => {
      document.getElementById("service-rates-editor")?.scrollIntoView({
        behavior: "smooth",

        block: "start",
      });
    });
  }

  function closeForm() {
    setCreating(false);

    setEditingId(null);

    setForm(createEmptyForm());

    setSlugManuallyEdited(false);

    setFormError(null);

    setConflictReservations([]);
  }

  function updateName(value: string) {
    setForm((current) => ({
      ...current,

      name: value,

      slug: creating && !slugManuallyEdited ? slugify(value) : current.slug,
    }));
  }

  async function createService(data: ServiceForm) {
    const response = await fetch("/api/services", {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        businessId: BUSINESS_ID,

        name: data.name.trim(),

        slug: data.slug.trim(),

        description: data.description.trim(),

        durationMinutes:
          data.durationMinutes.trim() === ""
            ? null
            : Number(data.durationMinutes),

        maxPeople: Number(data.maxPeople),

        maxAdults: data.maxAdults.trim() === "" ? null : Number(data.maxAdults),

        maxChildren:
          data.maxChildren.trim() === "" ? null : Number(data.maxChildren),

        /*
         * Los Services nuevos
         * nacen inactivos.
         *
         * Primero configuramos
         * recursos y tarifas.
         */
        isActive: false,
      }),
    });

    const result = (await response.json()) as ApiErrorResponse;

    if (!response.ok || !result.success) {
      throw new Error(result.error || "No fue posible crear el servicio");
    }

    return result;
  }

  async function patchService(
    service: Service,

    data: ServiceForm,

    isActive = service.isActive,
  ) {
    const response = await fetch(`/api/services/${service.id}`, {
      method: "PATCH",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        businessId: BUSINESS_ID,

        name: data.name.trim(),

        slug: data.slug.trim(),

        description: data.description.trim(),

        durationMinutes:
          data.durationMinutes.trim() === ""
            ? null
            : Number(data.durationMinutes),

        maxPeople: Number(data.maxPeople),

        maxAdults: data.maxAdults.trim() === "" ? null : Number(data.maxAdults),

        maxChildren:
          data.maxChildren.trim() === "" ? null : Number(data.maxChildren),

        isActive,
      }),
    });

    const result = (await response.json()) as ApiErrorResponse;

    if (!response.ok || !result.success) {
      const apiError = new Error(
        result.error || "No fue posible actualizar el servicio",
      ) as Error & {
        code?: string;

        reservations?: ApiConflictReservation[];
      };

      apiError.code = result.code;

      apiError.reservations = result.reservations;

      throw apiError;
    }

    return result;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setSaving(true);

    setFormError(null);

    setConflictReservations([]);

    try {
      if (creating) {
        await createService(form);
      } else {
        if (!editingService) {
          throw new Error("Servicio no encontrado");
        }

        await patchService(
          editingService,

          form,
        );
      }

      closeForm();

      await loadData();
    } catch (saveError) {
      const apiError = saveError as Error & {
        reservations?: ApiConflictReservation[];
      };

      setFormError(apiError.message);

      setConflictReservations(apiError.reservations ?? []);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(service: Service) {
    const nextActive = !service.isActive;

    /*
     * Esta pantalla administra
     * actualmente Hotel V1.
     *
     * Evitamos activar desde la UI
     * un servicio todavía incompleto.
     *
     * Más adelante esta validación
     * puede moverse a una política
     * específica de cada vertical.
     */
    if (nextActive) {
      const hasResourceRequirements = service.resourceTypes.length > 0;

      const hasActiveRate = service.rates.some((rate) => rate.isActive);

      if (!hasResourceRequirements || !hasActiveRate) {
        setError(
          "Antes de activar el servicio debes configurar al menos un requisito de recurso y una tarifa activa.",
        );

        return;
      }
    }

    if (
      !nextActive &&
      !window.confirm(
        `¿Desactivar ${service.name}? Dejará de ofrecerse para nuevas reservas.`,
      )
    ) {
      return;
    }

    setChangingStateId(service.id);

    setError(null);

    setFormError(null);

    setConflictReservations([]);

    try {
      await patchService(
        service,

        serviceToForm(service),

        nextActive,
      );

      await loadData();
    } catch (toggleError) {
      const apiError = toggleError as Error & {
        reservations?: ApiConflictReservation[];
      };

      setError(apiError.message);

      setConflictReservations(apiError.reservations ?? []);
    } finally {
      setChangingStateId(null);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">
            Servicios
          </h1>

          <p className="text-sm text-zinc-500">
            Administra los servicios que el negocio puede ofrecer y su
            configuración de capacidad, inventario y tarifas.
          </p>
        </div>

        <button
          type="button"
          onClick={startCreating}
          disabled={loading || saving}
          className="h-10 rounded-lg bg-zinc-950 px-4 text-sm font-medium text-white disabled:opacity-50"
        >
          Nuevo servicio
        </button>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-zinc-200 bg-white p-4">
          <p className="text-sm text-zinc-500">Servicios</p>

          <p className="mt-1 text-2xl font-semibold text-zinc-950">
            {summary.total}
          </p>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-4">
          <p className="text-sm text-zinc-500">Activos</p>

          <p className="mt-1 text-2xl font-semibold text-zinc-950">
            {summary.active}
          </p>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-4">
          <p className="text-sm text-zinc-500">Inactivos</p>

          <p className="mt-1 text-2xl font-semibold text-zinc-950">
            {summary.inactive}
          </p>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-4">
          <p className="text-sm text-zinc-500">Con reservas activas</p>

          <p className="mt-1 text-2xl font-semibold text-zinc-950">
            {summary.withActiveReservations}
          </p>
        </div>
      </section>

      {error && (
        <section className="rounded-xl border border-zinc-300 bg-white p-4">
          <p className="font-medium text-zinc-950">
            No fue posible completar la operación
          </p>

          <p className="mt-1 text-sm text-zinc-600">{error}</p>

          {conflictReservations.length > 0 && (
            <div className="mt-4 space-y-2">
              {conflictReservations.map((reservation) => (
                <a
                  key={reservation.id}
                  href={`/admin/reservations/${reservation.id}`}
                  className="block rounded-lg border border-zinc-200 p-3 text-sm hover:bg-zinc-50"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-zinc-950">
                      {reservation.confirmationCode}
                    </span>

                    <span className="text-zinc-500">
                      {formatStatus(reservation.status)}
                    </span>
                  </div>

                  <p className="mt-1 text-zinc-500">
                    {formatDateTime(reservation.startAt)} →{" "}
                    {formatDateTime(reservation.endAt)}
                  </p>
                </a>
              ))}
            </div>
          )}
        </section>
      )}

      {formVisible && (
        <section
          id="service-form"
          className="scroll-mt-6 rounded-xl border border-zinc-200 bg-white"
        >
          <div className="border-b border-zinc-200 px-5 py-4">
            <h2 className="font-semibold text-zinc-950">
              {creating ? "Nuevo servicio" : "Editar servicio"}
            </h2>

            <p className="mt-1 text-sm text-zinc-500">
              {creating
                ? "El servicio se creará inactivo. Después podrás configurar sus recursos y tarifas antes de activarlo."
                : editingService?.name}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5 p-5">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-sm font-medium text-zinc-700">
                  Nombre
                </span>

                <input
                  required
                  value={form.name}
                  onChange={(event) => updateName(event.target.value)}
                  placeholder="Ej. Habitación Premium"
                  className="h-10 w-full rounded-lg border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-500"
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-sm font-medium text-zinc-700">Slug</span>

                <input
                  required
                  value={form.slug}
                  onChange={(event) => {
                    setSlugManuallyEdited(true);

                    setForm((current) => ({
                      ...current,

                      slug: slugify(event.target.value),
                    }));
                  }}
                  placeholder="habitacion-premium"
                  className="h-10 w-full rounded-lg border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-500"
                />
              </label>
            </div>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-zinc-700">
                Descripción
              </span>

              <textarea
                value={form.description}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,

                    description: event.target.value,
                  }))
                }
                rows={3}
                placeholder="Describe brevemente el servicio."
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <label className="space-y-1.5">
                <span className="text-sm font-medium text-zinc-700">
                  Capacidad total
                </span>

                <input
                  required
                  type="number"
                  min="1"
                  step="1"
                  value={form.maxPeople}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,

                      maxPeople: event.target.value,
                    }))
                  }
                  className="h-10 w-full rounded-lg border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-500"
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-sm font-medium text-zinc-700">
                  Adultos máximos
                </span>

                <input
                  type="number"
                  min="0"
                  step="1"
                  value={form.maxAdults}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,

                      maxAdults: event.target.value,
                    }))
                  }
                  placeholder="Opcional"
                  className="h-10 w-full rounded-lg border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-500"
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-sm font-medium text-zinc-700">
                  Niños máximos
                </span>

                <input
                  type="number"
                  min="0"
                  step="1"
                  value={form.maxChildren}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,

                      maxChildren: event.target.value,
                    }))
                  }
                  placeholder="Opcional"
                  className="h-10 w-full rounded-lg border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-500"
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-sm font-medium text-zinc-700">
                  Duración
                </span>

                <input
                  type="number"
                  min="1"
                  step="1"
                  value={form.durationMinutes}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,

                      durationMinutes: event.target.value,
                    }))
                  }
                  placeholder="Minutos"
                  className="h-10 w-full rounded-lg border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-500"
                />

                <p className="text-xs text-zinc-500">
                  Opcional. Se utilizará en servicios reservados por tiempo.
                </p>
              </label>
            </div>

            {creating && (
              <div className="rounded-lg border border-zinc-200 p-4">
                <p className="text-sm font-medium text-zinc-900">
                  El servicio se creará inactivo
                </p>

                <p className="mt-1 text-xs leading-5 text-zinc-500">
                  Esto evita publicarlo antes de configurar sus recursos
                  requeridos y tarifas.
                </p>
              </div>
            )}

            {formError && (
              <div className="rounded-lg border border-zinc-300 p-4">
                <p className="text-sm font-medium text-zinc-950">{formError}</p>

                {conflictReservations.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {conflictReservations.map((reservation) => (
                      <a
                        key={reservation.id}
                        href={`/admin/reservations/${reservation.id}`}
                        className="block rounded-lg border border-zinc-200 p-3 text-sm hover:bg-zinc-50"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium text-zinc-950">
                            {reservation.confirmationCode}
                          </span>

                          <span className="text-zinc-500">
                            {formatStatus(reservation.status)}
                          </span>
                        </div>

                        <p className="mt-1 text-zinc-500">
                          Huéspedes: {reservation.guests}
                          {reservation.adults !== null &&
                            ` · Adultos: ${reservation.adults}`}
                          {reservation.children !== null &&
                            ` · Niños: ${reservation.children}`}
                        </p>

                        {reservation.violations &&
                          reservation.violations.length > 0 && (
                            <p className="mt-1 text-xs text-zinc-500">
                              Conflicto:{" "}
                              {reservation.violations
                                .map(formatViolation)
                                .join(", ")}
                            </p>
                          )}
                      </a>
                    ))}
                  </div>
                )}
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
                {saving
                  ? creating
                    ? "Creando..."
                    : "Guardando..."
                  : creating
                    ? "Crear servicio"
                    : "Guardar cambios"}
              </button>
            </div>
          </form>
        </section>
      )}

      {resourceEditorService && (
        <ResourceRequirementsEditor
          key={resourceEditorService.id}
          serviceId={resourceEditorService.id}
          serviceName={resourceEditorService.name}
          activeReservationCount={resourceEditorService.activeReservationCount}
          currentRequirements={resourceEditorService.resourceTypes}
          onClose={() => setResourceEditorId(null)}
          onSaved={loadData}
        />
      )}

      {rateEditorService && (
        <ServiceRatesEditor
          key={rateEditorService.id}
          serviceId={rateEditorService.id}
          serviceName={rateEditorService.name}
          serviceIsActive={rateEditorService.isActive}
          currentRates={rateEditorService.rates}
          onClose={() => setRateEditorId(null)}
          onSaved={loadData}
        />
      )}

      <section className="rounded-xl border border-zinc-200 bg-white">
        <div className="flex flex-col gap-4 border-b border-zinc-200 p-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-semibold text-zinc-950">Catálogo</h2>

            <p className="mt-1 text-sm text-zinc-500">
              {filteredServices.length} de {services.length}
            </p>
          </div>

          <label className="space-y-1">
            <span className="text-xs font-medium text-zinc-500">Estado</span>

            <select
              value={stateFilter}
              onChange={(event) =>
                setStateFilter(event.target.value as StateFilter)
              }
              className="h-10 min-w-44 rounded-lg border border-zinc-300 bg-white px-3 text-sm"
            >
              <option value="ALL">Todos</option>

              <option value="ACTIVE">Activos</option>

              <option value="INACTIVE">Inactivos</option>
            </select>
          </label>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-zinc-500">
            Cargando servicios...
          </div>
        ) : filteredServices.length === 0 ? (
          <div className="p-8 text-center text-sm text-zinc-500">
            No hay servicios para los filtros seleccionados.
          </div>
        ) : (
          <div className="divide-y divide-zinc-200">
            {filteredServices.map((service) => {
              const activeRateCount = service.rates.filter(
                (rate) => rate.isActive,
              ).length;

              const readyToActivate =
                service.resourceTypes.length > 0 && activeRateCount > 0;

              return (
                <article key={service.id} className="p-5">
                  <div className="space-y-5">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                      <div className="min-w-0 space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-zinc-950">
                            {service.name}
                          </h3>

                          <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-600">
                            {service.slug}
                          </span>

                          <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-600">
                            {service.isActive ? "Activo" : "Inactivo"}
                          </span>

                          {!service.isActive && !readyToActivate && (
                            <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-500">
                              Configuración incompleta
                            </span>
                          )}
                        </div>

                        {service.description && (
                          <p className="max-w-3xl text-sm leading-6 text-zinc-600">
                            {service.description}
                          </p>
                        )}

                        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-zinc-500">
                          <span>Capacidad: {service.maxPeople}</span>

                          <span>Adultos: {service.maxAdults ?? "—"}</span>

                          <span>Niños: {service.maxChildren ?? "—"}</span>

                          {service.durationMinutes !== null && (
                            <span>Duración: {service.durationMinutes} min</span>
                          )}

                          <span>
                            Reservas activas: {service.activeReservationCount}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => startEditing(service)}
                          disabled={saving || changingStateId === service.id}
                          className="h-9 rounded-lg border border-zinc-300 px-3 text-sm font-medium text-zinc-700 disabled:opacity-50"
                        >
                          Editar
                        </button>

                        <button
                          type="button"
                          onClick={() => startEditingResources(service)}
                          disabled={saving || changingStateId === service.id}
                          className="h-9 rounded-lg border border-zinc-300 px-3 text-sm font-medium text-zinc-700 disabled:opacity-50"
                        >
                          Inventario requerido
                        </button>

                        <button
                          type="button"
                          onClick={() => startEditingRates(service)}
                          disabled={saving || changingStateId === service.id}
                          className="h-9 rounded-lg border border-zinc-300 px-3 text-sm font-medium text-zinc-700 disabled:opacity-50"
                        >
                          Configurar tarifas
                        </button>

                        <button
                          type="button"
                          onClick={() => void handleToggleActive(service)}
                          disabled={saving || changingStateId === service.id}
                          className="h-9 rounded-lg border border-zinc-300 px-3 text-sm font-medium text-zinc-700 disabled:opacity-50"
                        >
                          {changingStateId === service.id
                            ? "Procesando..."
                            : service.isActive
                              ? "Desactivar"
                              : "Reactivar"}
                        </button>
                      </div>
                    </div>

                    <div className="grid gap-4 xl:grid-cols-2">
                      <section className="rounded-xl border border-zinc-200">
                        <div className="border-b border-zinc-200 px-4 py-3">
                          <h4 className="text-sm font-semibold text-zinc-900">
                            Inventario requerido por reserva
                          </h4>

                          <p className="mt-1 text-xs text-zinc-500">
                            Tipos de inventario y unidades físicas necesarias
                            para atender una reserva de este servicio.
                          </p>
                        </div>

                        {service.resourceTypes.length === 0 ? (
                          <div className="p-4 text-sm text-zinc-500">
                            Este servicio no tiene requisitos de recursos
                            configurados.
                          </div>
                        ) : (
                          <div className="divide-y divide-zinc-200">
                            {service.resourceTypes.map((requirement) => (
                              <div key={requirement.id} className="p-4">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div>
                                    <p className="text-sm font-medium text-zinc-950">
                                      {requirement.resourceType.name}
                                    </p>

                                    <p className="mt-1 text-xs text-zinc-500">
                                      Unidades necesarias por reserva:{" "}
                                      {requirement.requiredQuantity}
                                    </p>
                                  </div>

                                  <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-600">
                                    {
                                      requirement.resourceType
                                        .activeResourceCount
                                    }{" "}
                                    activos
                                  </span>
                                </div>

                                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                                  <span>
                                    Unidades físicas activas:{" "}
                                    {
                                      requirement.resourceType
                                        .activeResourceCount
                                    }
                                  </span>

                                  <span>
                                    Unidades físicas totales:{" "}
                                    {
                                      requirement.resourceType
                                        .totalResourceCount
                                    }
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </section>

                      <section className="rounded-xl border border-zinc-200">
                        <div className="border-b border-zinc-200 px-4 py-3">
                          <h4 className="text-sm font-semibold text-zinc-900">
                            Tarifas
                          </h4>

                          <p className="mt-1 text-xs text-zinc-500">
                            Precios configurados para el servicio.
                          </p>
                        </div>

                        {service.rates.length === 0 ? (
                          <div className="p-4 text-sm text-zinc-500">
                            Este servicio no tiene tarifas configuradas.
                          </div>
                        ) : (
                          <div className="divide-y divide-zinc-200">
                            {service.rates.map((rate) => (
                              <div key={rate.id} className="p-4">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div>
                                    <p className="text-sm font-medium text-zinc-950">
                                      {rate.name}
                                    </p>

                                    <p className="mt-1 text-xs text-zinc-500">
                                      {formatDate(rate.startDate)} →{" "}
                                      {formatDate(rate.endDate)}
                                    </p>
                                  </div>

                                  <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-600">
                                    {rate.isActive ? "Activa" : "Inactiva"}
                                  </span>
                                </div>

                                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                  <div className="rounded-lg bg-zinc-50 p-3">
                                    <p className="text-xs text-zinc-500">
                                      Entre semana
                                    </p>

                                    <p className="mt-1 text-sm font-semibold text-zinc-950">
                                      {formatMoney(rate.weekdayPrice)}
                                    </p>
                                  </div>

                                  <div className="rounded-lg bg-zinc-50 p-3">
                                    <p className="text-xs text-zinc-500">
                                      Fin de semana
                                    </p>

                                    <p className="mt-1 text-sm font-semibold text-zinc-950">
                                      {formatMoney(rate.weekendPrice)}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </section>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
