"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

const BUSINESS_ID = "cmsni1uij0000ewvwjzoenugh";

const BUSINESS_TIMEZONE = "America/El_Salvador";

const BLOCK_SCOPES = [
  "BUSINESS",
  "SERVICE",
  "RESOURCE_TYPE",
  "RESOURCE",
] as const;

type BlockScope = (typeof BLOCK_SCOPES)[number];

type TemporalStatus = "ACTIVE" | "UPCOMING" | "EXPIRED";

type TemporalFilter = "" | TemporalStatus;

type Service = {
  id: string;
  name: string;
  slug: string;
};

type ResourceType = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  activeResourceCount: number;
};

type Resource = {
  id: string;
  name: string;
  code: string | null;
  resourceTypeId: string | null;
  floor: number | null;
  capacity: number;
  isActive: boolean;

  resourceType: {
    id: string;
    name: string;
    slug: string;
  } | null;
};

type Block = {
  id: string;
  businessId: string;

  serviceId: string | null;
  resourceTypeId: string | null;
  resourceId: string | null;

  startAt: string;
  endAt: string;

  reason: string | null;

  createdAt: string;
  updatedAt: string;

  scope: BlockScope;

  service: {
    id: string;
    name: string;
    slug: string;
  } | null;

  resourceType: {
    id: string;
    name: string;
    slug: string;
  } | null;

  resource: {
    id: string;
    name: string;
    code: string | null;
    resourceTypeId: string | null;
  } | null;
};

type BlocksResponse = {
  success: true;

  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
    hasPreviousPage: boolean;
    hasNextPage: boolean;
  };

  items: Block[];
};

function getScopeLabel(scope: BlockScope) {
  switch (scope) {
    case "BUSINESS":
      return "Negocio completo";

    case "SERVICE":
      return "Servicio";

    case "RESOURCE_TYPE":
      return "Tipo de recurso";

    case "RESOURCE":
      return "Recurso específico";
  }
}

function getTemporalStatus(block: Block): TemporalStatus {
  const now = new Date();

  const startAt = new Date(block.startAt);

  const endAt = new Date(block.endAt);

  if (now >= endAt) {
    return "EXPIRED";
  }

  if (now < startAt) {
    return "UPCOMING";
  }

  return "ACTIVE";
}

function getTemporalStatusLabel(status: TemporalStatus) {
  switch (status) {
    case "ACTIVE":
      return "En curso";

    case "UPCOMING":
      return "Próximo";

    case "EXPIRED":
      return "Vencido";
  }
}

function getTargetLabel(block: Block) {
  switch (block.scope) {
    case "BUSINESS":
      return "Todo el negocio";

    case "SERVICE":
      return block.service?.name ?? "Servicio no disponible";

    case "RESOURCE_TYPE":
      return block.resourceType?.name ?? "Tipo de recurso no disponible";

    case "RESOURCE":
      return (
        block.resource?.code || block.resource?.name || "Recurso no disponible"
      );
  }
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("es-SV", {
    timeZone: BUSINESS_TIMEZONE,

    year: "numeric",
    month: "short",
    day: "numeric",

    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

/*
 * Hotel Demo está en El Salvador.
 *
 * datetime-local no incluye zona horaria,
 * así que lo convertimos explícitamente
 * desde UTC-06:00 a ISO UTC.
 *
 * Cuando Business deje de estar
 * temporalmente hardcodeado, esta
 * conversión deberá depender del timezone
 * configurado para cada negocio.
 */
function localInputToIso(value: string) {
  if (!value) {
    return "";
  }

  return new Date(`${value}:00-06:00`).toISOString();
}

function isoToLocalFields(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,

    year: "numeric",
    month: "2-digit",
    day: "2-digit",

    hour: "2-digit",
    minute: "2-digit",

    hourCycle: "h23",
  }).formatToParts(new Date(value));

  const getPart = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return {
    date: `${getPart("year")}-${getPart("month")}-${getPart("day")}`,

    time: `${getPart("hour")}:${getPart("minute")}`,
  };
}

export default function BlocksPage() {
  const [services, setServices] = useState<Service[]>([]);

  const [resourceTypes, setResourceTypes] = useState<ResourceType[]>([]);

  const [resources, setResources] = useState<Resource[]>([]);

  const [blocks, setBlocks] = useState<Block[]>([]);

  const [loading, setLoading] = useState(true);

  const [catalogsLoading, setCatalogsLoading] = useState(true);

  const [error, setError] = useState<string | null>(null);

  const [formError, setFormError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [temporalFilter, setTemporalFilter] = useState<TemporalFilter>("");

  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);

  const [scope, setScope] = useState<BlockScope>("RESOURCE");

  const [targetId, setTargetId] = useState("");

  const [startDate, setStartDate] = useState("");

  const [startTime, setStartTime] = useState("");

  const [endDate, setEndDate] = useState("");

  const [endTime, setEndTime] = useState("");

  const [reason, setReason] = useState("");

  const loadBlocks = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        businessId: BUSINESS_ID,

        page: "1",

        pageSize: "100",
      });

      const response = await fetch(`/api/blocks?${params.toString()}`, {
        cache: "no-store",
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof result.error === "string"
            ? result.error
            : "No fue posible obtener los bloqueos",
        );
      }

      const data = result as BlocksResponse;

      setBlocks(data.items);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "No fue posible obtener los bloqueos",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCatalogs = useCallback(async () => {
    setCatalogsLoading(true);

    try {
      const businessParams = new URLSearchParams({
        businessId: BUSINESS_ID,
      });

      const [servicesResponse, resourceTypesResponse, resourcesResponse] =
        await Promise.all([
          fetch(`/api/services?${businessParams.toString()}`, {
            cache: "no-store",
          }),

          fetch(`/api/resource-types?${businessParams.toString()}`, {
            cache: "no-store",
          }),

          fetch(`/api/resources?${businessParams.toString()}`, {
            cache: "no-store",
          }),
        ]);

      const [servicesResult, resourceTypesResult, resourcesResult] =
        await Promise.all([
          servicesResponse.json(),
          resourceTypesResponse.json(),
          resourcesResponse.json(),
        ]);

      if (!servicesResponse.ok) {
        throw new Error(
          servicesResult.error ?? "No fue posible obtener los servicios",
        );
      }

      if (!resourceTypesResponse.ok) {
        throw new Error(
          resourceTypesResult.error ??
            "No fue posible obtener los tipos de recurso",
        );
      }

      if (!resourcesResponse.ok) {
        throw new Error(
          resourcesResult.error ?? "No fue posible obtener los recursos",
        );
      }

      /*
       * /api/services fue creado antes
       * que los otros catálogos y puede
       * exponer "services".
       *
       * Los endpoints nuevos usan "items".
       */
      const serviceItems = Array.isArray(servicesResult.services)
        ? servicesResult.services
        : Array.isArray(servicesResult.items)
          ? servicesResult.items
          : [];

      setServices(serviceItems);

      setResourceTypes(
        Array.isArray(resourceTypesResult.items)
          ? resourceTypesResult.items
          : [],
      );

      setResources(
        Array.isArray(resourcesResult.items) ? resourcesResult.items : [],
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "No fue posible cargar los catálogos",
      );
    } finally {
      setCatalogsLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.all([loadBlocks(), loadCatalogs()]);
  }, [loadBlocks, loadCatalogs]);

  const visibleBlocks = useMemo(() => {
    if (!temporalFilter) {
      return blocks;
    }

    return blocks.filter(
      (block) => getTemporalStatus(block) === temporalFilter,
    );
  }, [blocks, temporalFilter]);

  const summary = useMemo(() => {
    let active = 0;
    let upcoming = 0;
    let expired = 0;

    for (const block of blocks) {
      const status = getTemporalStatus(block);

      if (status === "ACTIVE") {
        active += 1;
      }

      if (status === "UPCOMING") {
        upcoming += 1;
      }

      if (status === "EXPIRED") {
        expired += 1;
      }
    }

    return {
      active,
      upcoming,
      expired,
    };
  }, [blocks]);

  const targets = useMemo(() => {
    if (scope === "SERVICE") {
      return services.map((service) => ({
        id: service.id,
        label: service.name,
      }));
    }

    if (scope === "RESOURCE_TYPE") {
      return resourceTypes.map((resourceType) => ({
        id: resourceType.id,

        label: `${resourceType.name} (${resourceType.activeResourceCount})`,
      }));
    }

    if (scope === "RESOURCE") {
      return resources.map((resource) => {
        const resourceLabel = resource.code || resource.name;

        const typeLabel = resource.resourceType?.name;

        return {
          id: resource.id,

          label: typeLabel ? `${typeLabel} · ${resourceLabel}` : resourceLabel,
        };
      });
    }

    return [];
  }, [scope, services, resourceTypes, resources]);

  function handleScopeChange(nextScope: BlockScope) {
    setScope(nextScope);
    setTargetId("");
    setFormError(null);
  }

  function resetForm() {
    setEditingBlockId(null);

    setScope("RESOURCE");
    setTargetId("");

    setStartDate("");
    setStartTime("");

    setEndDate("");
    setEndTime("");

    setReason("");
    setFormError(null);
  }

  function handleEdit(block: Block) {
    const start = isoToLocalFields(block.startAt);

    const end = isoToLocalFields(block.endAt);

    setEditingBlockId(block.id);

    setScope(block.scope);

    switch (block.scope) {
      case "BUSINESS":
        setTargetId("");
        break;

      case "SERVICE":
        setTargetId(block.serviceId ?? "");
        break;

      case "RESOURCE_TYPE":
        setTargetId(block.resourceTypeId ?? "");
        break;

      case "RESOURCE":
        setTargetId(block.resourceId ?? "");
        break;
    }

    setStartDate(start.date);

    setStartTime(start.time);

    setEndDate(end.date);

    setEndTime(end.time);

    setReason(block.reason ?? "");

    setFormError(null);

    window.requestAnimationFrame(() => {
      document.getElementById("block-form")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setFormError(null);

    if (scope !== "BUSINESS" && !targetId) {
      setFormError("Selecciona qué elemento deseas bloquear.");

      return;
    }

    if (!startDate || !startTime || !endDate || !endTime) {
      setFormError("Completa la fecha y la hora de inicio y finalización.");

      return;
    }

    let startAtIso = "";
    let endAtIso = "";

    try {
      startAtIso = localInputToIso(`${startDate}T${startTime}`);

      endAtIso = localInputToIso(`${endDate}T${endTime}`);
    } catch {
      setFormError("Las fechas ingresadas no son válidas.");

      return;
    }

    if (new Date(startAtIso) >= new Date(endAtIso)) {
      setFormError("La finalización debe ser posterior al inicio.");

      return;
    }

    setSubmitting(true);

    try {
      const isEditing = editingBlockId !== null;

      const response = await fetch(
        isEditing ? `/api/blocks/${editingBlockId}` : "/api/blocks",
        {
          method: isEditing ? "PATCH" : "POST",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            businessId: BUSINESS_ID,

            scope,

            targetId: scope === "BUSINESS" ? "" : targetId,

            startAt: startAtIso,

            endAt: endAtIso,

            reason: reason.trim(),
          }),
        },
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof result.error === "string"
            ? result.error
            : isEditing
              ? "No fue posible actualizar el bloqueo"
              : "No fue posible crear el bloqueo",
        );
      }

      resetForm();

      await loadBlocks();
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "No fue posible crear el bloqueo",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(block: Block) {
    const target = getTargetLabel(block);

    const confirmed = window.confirm(`¿Quitar el bloqueo de "${target}"?`);

    if (!confirmed) {
      return;
    }

    setDeletingId(block.id);

    setError(null);

    try {
      const params = new URLSearchParams({
        businessId: BUSINESS_ID,
      });

      const response = await fetch(
        `/api/blocks/${block.id}?${params.toString()}`,
        {
          method: "DELETE",
        },
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof result.error === "string"
            ? result.error
            : "No fue posible quitar el bloqueo",
        );
      }

      await loadBlocks();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "No fue posible quitar el bloqueo",
      );
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-7xl p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Bloqueos</h1>

        <p className="mt-2 text-sm text-zinc-500">
          Controla períodos en los que el negocio, un servicio, un tipo de
          recurso o un recurso específico no debe aceptar reservas.
        </p>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
        <section
          id="block-form"
          className="h-fit scroll-mt-6 rounded-xl border border-zinc-200 bg-white"
        >
          <div className="border-b border-zinc-200 px-5 py-4">
            <h2 className="font-semibold">
              {editingBlockId ? "Editar bloqueo" : "Nuevo bloqueo"}
            </h2>

            <p className="mt-1 text-sm text-zinc-500">
              {editingBlockId
                ? "Modifica el alcance, período o motivo del bloqueo existente."
                : "Las fechas se interpretan según el horario del negocio."}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5 p-5">
            <label className="flex flex-col gap-2 text-sm">
              <span className="font-medium">Alcance</span>

              <select
                value={scope}
                onChange={(event) =>
                  handleScopeChange(event.target.value as BlockScope)
                }
                disabled={submitting}
                className="h-10 rounded-lg border border-zinc-300 bg-white px-3"
              >
                <option value="BUSINESS">Negocio completo</option>

                <option value="SERVICE">Servicio</option>

                <option value="RESOURCE_TYPE">Tipo de recurso</option>

                <option value="RESOURCE">Recurso específico</option>
              </select>
            </label>

            {scope !== "BUSINESS" && (
              <label className="flex flex-col gap-2 text-sm">
                <span className="font-medium">
                  {scope === "SERVICE"
                    ? "Servicio"
                    : scope === "RESOURCE_TYPE"
                      ? "Tipo de recurso"
                      : "Recurso"}
                </span>

                <select
                  value={targetId}
                  onChange={(event) => setTargetId(event.target.value)}
                  disabled={submitting || catalogsLoading}
                  className="h-10 rounded-lg border border-zinc-300 bg-white px-3"
                >
                  <option value="">
                    {catalogsLoading ? "Cargando..." : "Seleccionar"}
                  </option>

                  {targets.map((target) => (
                    <option key={target.id} value={target.id}>
                      {target.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className="space-y-5">
              <div>
                <p className="mb-2 text-sm font-medium">Inicio</p>

                <div className="grid gap-3 sm:grid-cols-[1fr_130px] xl:grid-cols-[1fr_130px]">
                  <label className="flex flex-col gap-2 text-sm">
                    <span className="text-xs text-zinc-500">Fecha</span>

                    <input
                      type="date"
                      value={startDate}
                      onChange={(event) => setStartDate(event.target.value)}
                      required
                      disabled={submitting}
                      className="h-10 rounded-lg border border-zinc-300 px-3"
                    />
                  </label>

                  <label className="flex flex-col gap-2 text-sm">
                    <span className="text-xs text-zinc-500">Hora</span>

                    <input
                      type="time"
                      value={startTime}
                      onChange={(event) => setStartTime(event.target.value)}
                      required
                      disabled={submitting}
                      className="h-10 rounded-lg border border-zinc-300 px-3"
                    />
                  </label>
                </div>
              </div>

              <div>
                <p className="mb-2 text-sm font-medium">Finalización</p>

                <div className="grid gap-3 sm:grid-cols-[1fr_130px] xl:grid-cols-[1fr_130px]">
                  <label className="flex flex-col gap-2 text-sm">
                    <span className="text-xs text-zinc-500">Fecha</span>

                    <input
                      type="date"
                      value={endDate}
                      onChange={(event) => setEndDate(event.target.value)}
                      required
                      disabled={submitting}
                      className="h-10 rounded-lg border border-zinc-300 px-3"
                    />
                  </label>

                  <label className="flex flex-col gap-2 text-sm">
                    <span className="text-xs text-zinc-500">Hora</span>

                    <input
                      type="time"
                      value={endTime}
                      onChange={(event) => setEndTime(event.target.value)}
                      required
                      disabled={submitting}
                      className="h-10 rounded-lg border border-zinc-300 px-3"
                    />
                  </label>
                </div>
              </div>
            </div>

            <label className="flex flex-col gap-2 text-sm">
              <span className="font-medium">Motivo</span>

              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                disabled={submitting}
                rows={4}
                placeholder="Ej. mantenimiento preventivo"
                className="resize-y rounded-lg border border-zinc-300 px-3 py-2"
              />
            </label>

            {formError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">
                {formError}
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={resetForm}
                disabled={submitting}
                className="h-10 rounded-lg border border-zinc-300 px-4 text-sm font-medium disabled:opacity-50"
              >
                {editingBlockId ? "Cancelar edición" : "Limpiar"}
              </button>

              <button
                type="submit"
                disabled={submitting || catalogsLoading}
                className="h-10 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {submitting
                  ? editingBlockId
                    ? "Guardando..."
                    : "Creando..."
                  : editingBlockId
                    ? "Guardar cambios"
                    : "Crear bloqueo"}
              </button>
            </div>
          </form>
        </section>

        <div className="space-y-6">
          <section className="grid gap-3 sm:grid-cols-3">
            <button
              type="button"
              onClick={() =>
                setTemporalFilter(temporalFilter === "ACTIVE" ? "" : "ACTIVE")
              }
              className="rounded-xl border border-zinc-200 bg-white p-4 text-left"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                En curso
              </p>

              <p className="mt-2 text-2xl font-semibold">{summary.active}</p>
            </button>

            <button
              type="button"
              onClick={() =>
                setTemporalFilter(
                  temporalFilter === "UPCOMING" ? "" : "UPCOMING",
                )
              }
              className="rounded-xl border border-zinc-200 bg-white p-4 text-left"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Próximos
              </p>

              <p className="mt-2 text-2xl font-semibold">{summary.upcoming}</p>
            </button>

            <button
              type="button"
              onClick={() =>
                setTemporalFilter(temporalFilter === "EXPIRED" ? "" : "EXPIRED")
              }
              className="rounded-xl border border-zinc-200 bg-white p-4 text-left"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Vencidos
              </p>

              <p className="mt-2 text-2xl font-semibold">{summary.expired}</p>
            </button>
          </section>

          <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
            <div className="flex flex-col justify-between gap-3 border-b border-zinc-200 px-5 py-4 sm:flex-row sm:items-center">
              <div>
                <h2 className="font-semibold">Bloqueos registrados</h2>

                <p className="mt-1 text-sm text-zinc-500">
                  {loading
                    ? "Cargando..."
                    : `${visibleBlocks.length} bloqueo(s) mostrado(s)`}
                </p>
              </div>

              {temporalFilter && (
                <button
                  type="button"
                  onClick={() => setTemporalFilter("")}
                  className="text-sm font-medium hover:underline"
                >
                  Quitar filtro
                </button>
              )}
            </div>

            {loading ? (
              <div className="flex min-h-64 items-center justify-center p-8">
                <p className="text-sm text-zinc-500">Cargando bloqueos...</p>
              </div>
            ) : visibleBlocks.length === 0 ? (
              <div className="flex min-h-64 items-center justify-center p-8 text-center">
                <p className="text-sm text-zinc-500">
                  No hay bloqueos para mostrar.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-zinc-200">
                {visibleBlocks.map((block) => {
                  const status = getTemporalStatus(block);

                  const canModify = status !== "EXPIRED";

                  return (
                    <article
                      key={block.id}
                      id={`block-${block.id}`}
                      className="scroll-mt-6 p-5"
                    >
                      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-semibold">
                              {getTargetLabel(block)}
                            </h3>

                            <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium">
                              {getTemporalStatusLabel(status)}
                            </span>
                          </div>

                          <p className="mt-2 text-sm text-zinc-500">
                            {getScopeLabel(block.scope)}
                          </p>
                        </div>

                        {canModify && (
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => handleEdit(block)}
                              disabled={deletingId === block.id || submitting}
                              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium disabled:opacity-50"
                            >
                              Editar bloqueo
                            </button>

                            <button
                              type="button"
                              onClick={() => void handleDelete(block)}
                              disabled={deletingId === block.id}
                              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium disabled:opacity-50"
                            >
                              {deletingId === block.id
                                ? "Quitando..."
                                : "Quitar bloqueo"}
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="mt-4 grid gap-4 rounded-lg bg-zinc-50 p-4 text-sm sm:grid-cols-2">
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                            Inicio
                          </p>

                          <p className="mt-1">
                            {formatDateTime(block.startAt)}
                          </p>
                        </div>

                        <div>
                          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                            Finalización
                          </p>

                          <p className="mt-1">{formatDateTime(block.endAt)}</p>
                        </div>
                      </div>

                      <div className="mt-4">
                        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                          Motivo
                        </p>

                        <p className="mt-1 text-sm">
                          {block.reason || "Sin motivo registrado"}
                        </p>
                      </div>

                      <p className="mt-4 break-all text-xs text-zinc-400">
                        ID: {block.id}
                      </p>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
