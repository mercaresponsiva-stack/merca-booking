"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

const BUSINESS_ID = "cmsni1uij0000ewvwjzoenugh";

type ReservationStatus = "PENDING" | "CONFIRMED" | "CHECKED_IN";

type ActiveReservation = {
  assignmentId: string;

  id: string;
  confirmationCode: string;

  status: ReservationStatus;

  startAt: string;
  endAt: string;

  customer: {
    id: string;

    firstName: string;
    lastName: string;
  };
};

type ResourceType = {
  id: string;

  name: string;
  slug: string;
};

type Resource = {
  id: string;

  name: string;
  code: string | null;

  resourceTypeId: string;

  floor: number | null;
  capacity: number;

  isActive: boolean;

  createdAt: string;
  updatedAt: string;

  resourceType: ResourceType;

  activeReservationCount: number;

  activeReservations: ActiveReservation[];
};

type ResourcesResponse = {
  success: boolean;

  items?: Resource[];

  error?: string;
};

type ResourceTypesResponse = {
  success: boolean;

  items?: Array<
    ResourceType & {
      _count?: {
        resources?: number;
      };
    }
  >;

  error?: string;
};

type ApiConflictReservation = {
  id: string;

  confirmationCode: string;

  status: string;

  startAt: string;
  endAt: string;
};

type ApiErrorResponse = {
  success?: boolean;

  error?: string;
  code?: string;

  reservations?: ApiConflictReservation[];
};

type ResourceForm = {
  name: string;
  code: string;

  resourceTypeId: string;

  floor: string;
  capacity: string;

  isActive: boolean;
};

function createEmptyForm(resourceTypeId = ""): ResourceForm {
  return {
    name: "",
    code: "",

    resourceTypeId,

    floor: "",
    capacity: "1",

    isActive: true,
  };
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

function getResourceLabel(resource: Resource) {
  if (resource.code && resource.code !== resource.name) {
    return `${resource.name} · ${resource.code}`;
  }

  return resource.code || resource.name;
}

export default function ResourcesPage() {
  const [resources, setResources] = useState<Resource[]>([]);

  const [resourceTypes, setResourceTypes] = useState<ResourceType[]>([]);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState<string | null>(null);

  const [typeFilter, setTypeFilter] = useState("ALL");

  const [stateFilter, setStateFilter] = useState("ALL");

  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);

  const [form, setForm] = useState<ResourceForm>(createEmptyForm());

  const [saving, setSaving] = useState(false);

  const [changingStateId, setChangingStateId] = useState<string | null>(null);

  const [formError, setFormError] = useState<string | null>(null);

  const [conflictReservations, setConflictReservations] = useState<
    ApiConflictReservation[]
  >([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [resourcesResponse, resourceTypesResponse] = await Promise.all([
        fetch(`/api/resources?businessId=${BUSINESS_ID}&includeInactive=true`, {
          cache: "no-store",
        }),

        fetch(`/api/resource-types?businessId=${BUSINESS_ID}`, {
          cache: "no-store",
        }),
      ]);

      const resourcesData =
        (await resourcesResponse.json()) as ResourcesResponse;

      const resourceTypesData =
        (await resourceTypesResponse.json()) as ResourceTypesResponse;

      if (!resourcesResponse.ok || !resourcesData.success) {
        throw new Error(
          resourcesData.error || "No fue posible cargar el inventario",
        );
      }

      if (!resourceTypesResponse.ok || !resourceTypesData.success) {
        throw new Error(
          resourceTypesData.error ||
            "No fue posible cargar los tipos de recurso",
        );
      }

      setResources(resourcesData.items ?? []);

      setResourceTypes(resourceTypesData.items ?? []);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No fue posible cargar el inventario",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const summary = useMemo(() => {
    const total = resources.length;

    const active = resources.filter((resource) => resource.isActive).length;

    const inactive = total - active;

    const assigned = resources.filter(
      (resource) => resource.activeReservationCount > 0,
    ).length;

    return {
      total,
      active,
      inactive,
      assigned,
    };
  }, [resources]);

  const filteredResources = useMemo(() => {
    return resources.filter((resource) => {
      if (typeFilter !== "ALL" && resource.resourceTypeId !== typeFilter) {
        return false;
      }

      if (stateFilter === "ACTIVE" && !resource.isActive) {
        return false;
      }

      if (stateFilter === "INACTIVE" && resource.isActive) {
        return false;
      }

      return true;
    });
  }, [resources, typeFilter, stateFilter]);

  function scrollToForm() {
    window.requestAnimationFrame(() => {
      document.getElementById("resource-form")?.scrollIntoView({
        behavior: "smooth",

        block: "start",
      });
    });
  }

  function startCreating() {
    setCreating(true);
    setEditingId(null);

    setForm(createEmptyForm(resourceTypes[0]?.id ?? ""));

    setFormError(null);

    setConflictReservations([]);

    scrollToForm();
  }

  function startEditing(resource: Resource) {
    setCreating(false);

    setEditingId(resource.id);

    setForm({
      name: resource.name,

      code: resource.code ?? "",

      resourceTypeId: resource.resourceTypeId,

      floor: resource.floor === null ? "" : String(resource.floor),

      capacity: String(resource.capacity),

      isActive: resource.isActive,
    });

    setFormError(null);

    setConflictReservations([]);

    scrollToForm();
  }

  function closeForm() {
    setCreating(false);

    setEditingId(null);

    setForm(createEmptyForm());

    setFormError(null);

    setConflictReservations([]);
  }

  async function patchResource(resource: Resource, data: ResourceForm) {
    const response = await fetch(`/api/resources/${resource.id}`, {
      method: "PATCH",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        businessId: BUSINESS_ID,

        name: data.name.trim(),

        code: data.code.trim(),

        resourceTypeId: data.resourceTypeId,

        floor: data.floor.trim() === "" ? null : Number(data.floor),

        capacity: Number(data.capacity),

        isActive: data.isActive,
      }),
    });

    const result = (await response.json()) as ApiErrorResponse & {
      resource?: Resource;
    };

    if (!response.ok || !result.success) {
      const apiError = new Error(
        result.error || "No fue posible actualizar el recurso",
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

  async function createResource(data: ResourceForm) {
    const response = await fetch("/api/resources", {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        businessId: BUSINESS_ID,

        name: data.name.trim(),

        code: data.code.trim(),

        resourceTypeId: data.resourceTypeId,

        floor: data.floor.trim() === "" ? null : Number(data.floor),

        capacity: Number(data.capacity),

        isActive: data.isActive,
      }),
    });

    const result = (await response.json()) as ApiErrorResponse & {
      resource?: Resource;
    };

    if (!response.ok || !result.success) {
      throw new Error(result.error || "No fue posible crear el recurso");
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
        await createResource(form);
      } else {
        if (!editingId) {
          return;
        }

        const resource = resources.find((item) => item.id === editingId);

        if (!resource) {
          throw new Error("Recurso no encontrado");
        }

        await patchResource(resource, form);
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

  async function handleToggleActive(resource: Resource) {
    const nextActive = !resource.isActive;

    if (
      !nextActive &&
      !window.confirm(`¿Desactivar ${getResourceLabel(resource)}?`)
    ) {
      return;
    }

    setChangingStateId(resource.id);

    setError(null);

    setFormError(null);

    setConflictReservations([]);

    try {
      await patchResource(resource, {
        name: resource.name,

        code: resource.code ?? "",

        resourceTypeId: resource.resourceTypeId,

        floor: resource.floor === null ? "" : String(resource.floor),

        capacity: String(resource.capacity),

        isActive: nextActive,
      });

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

  const editingResource = editingId
    ? (resources.find((resource) => resource.id === editingId) ?? null)
    : null;

  const formVisible = creating || editingResource !== null;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">
            Inventario
          </h1>

          <p className="text-sm text-zinc-500">
            Administra los recursos físicos disponibles para las reservas.
          </p>
        </div>

        <button
          type="button"
          onClick={startCreating}
          disabled={loading || resourceTypes.length === 0 || saving}
          className="h-10 rounded-lg bg-zinc-950 px-4 text-sm font-medium text-white disabled:opacity-50"
        >
          Nuevo recurso
        </button>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-zinc-200 bg-white p-4">
          <p className="text-sm text-zinc-500">Recursos</p>

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
            {summary.assigned}
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
          id="resource-form"
          className="scroll-mt-6 rounded-xl border border-zinc-200 bg-white"
        >
          <div className="border-b border-zinc-200 px-5 py-4">
            <h2 className="font-semibold text-zinc-950">
              {creating ? "Nuevo recurso" : "Editar recurso"}
            </h2>

            <p className="mt-1 text-sm text-zinc-500">
              {creating
                ? "Agrega una nueva unidad física al inventario."
                : editingResource
                  ? getResourceLabel(editingResource)
                  : ""}
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
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,

                      name: event.target.value,
                    }))
                  }
                  placeholder="Ej. 302"
                  className="h-10 w-full rounded-lg border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-500"
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-sm font-medium text-zinc-700">
                  Código
                </span>

                <input
                  value={form.code}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,

                      code: event.target.value,
                    }))
                  }
                  placeholder="Ej. 302"
                  className="h-10 w-full rounded-lg border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-500"
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-sm font-medium text-zinc-700">
                  Tipo de recurso
                </span>

                <select
                  required
                  value={form.resourceTypeId}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,

                      resourceTypeId: event.target.value,
                    }))
                  }
                  className="h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-zinc-500"
                >
                  <option value="">Selecciona un tipo</option>

                  {resourceTypes.map((resourceType) => (
                    <option key={resourceType.id} value={resourceType.id}>
                      {resourceType.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1.5">
                <span className="text-sm font-medium text-zinc-700">Piso</span>

                <input
                  type="number"
                  min="0"
                  step="1"
                  value={form.floor}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,

                      floor: event.target.value,
                    }))
                  }
                  placeholder="Ej. 3"
                  className="h-10 w-full rounded-lg border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-500"
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-sm font-medium text-zinc-700">
                  Capacidad
                </span>

                <input
                  required
                  type="number"
                  min="1"
                  step="1"
                  value={form.capacity}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,

                      capacity: event.target.value,
                    }))
                  }
                  className="h-10 w-full rounded-lg border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-500"
                />
              </label>
            </div>

            {creating && (
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
                    Crear como recurso activo
                  </p>

                  <p className="text-xs text-zinc-500">
                    Los recursos activos pueden formar parte de la
                    disponibilidad.
                  </p>
                </div>
              </label>
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
                        <span className="font-medium text-zinc-950">
                          {reservation.confirmationCode}
                        </span>

                        <span className="ml-2 text-zinc-500">
                          {formatStatus(reservation.status)}
                        </span>
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
                    ? "Crear recurso"
                    : "Guardar cambios"}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="rounded-xl border border-zinc-200 bg-white">
        <div className="flex flex-col gap-4 border-b border-zinc-200 p-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="font-semibold text-zinc-950">Recursos</h2>

            <p className="mt-1 text-sm text-zinc-500">
              {filteredResources.length} de {resources.length}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-medium text-zinc-500">Tipo</span>

              <select
                value={typeFilter}
                onChange={(event) => setTypeFilter(event.target.value)}
                className="h-10 min-w-52 rounded-lg border border-zinc-300 bg-white px-3 text-sm"
              >
                <option value="ALL">Todos</option>

                {resourceTypes.map((resourceType) => (
                  <option key={resourceType.id} value={resourceType.id}>
                    {resourceType.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-xs font-medium text-zinc-500">Estado</span>

              <select
                value={stateFilter}
                onChange={(event) => setStateFilter(event.target.value)}
                className="h-10 min-w-44 rounded-lg border border-zinc-300 bg-white px-3 text-sm"
              >
                <option value="ALL">Todos</option>

                <option value="ACTIVE">Activos</option>

                <option value="INACTIVE">Inactivos</option>
              </select>
            </label>
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-zinc-500">
            Cargando inventario...
          </div>
        ) : filteredResources.length === 0 ? (
          <div className="p-8 text-center text-sm text-zinc-500">
            No hay recursos para los filtros seleccionados.
          </div>
        ) : (
          <div className="divide-y divide-zinc-200">
            {filteredResources.map((resource) => (
              <article key={resource.id} className="p-5">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-zinc-950">
                        {getResourceLabel(resource)}
                      </h3>

                      <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-600">
                        {resource.resourceType.name}
                      </span>

                      <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-600">
                        {resource.isActive ? "Activo" : "Inactivo"}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-zinc-500">
                      <span>Piso: {resource.floor ?? "—"}</span>

                      <span>Capacidad: {resource.capacity}</span>

                      <span>
                        Reservas activas: {resource.activeReservationCount}
                      </span>
                    </div>

                    {resource.activeReservations.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                          Asignaciones activas
                        </p>

                        <div className="flex flex-wrap gap-2">
                          {resource.activeReservations.map((reservation) => (
                            <a
                              key={reservation.assignmentId}
                              href={`/admin/reservations/${reservation.id}`}
                              className="rounded-lg border border-zinc-200 px-3 py-2 text-sm hover:bg-zinc-50"
                            >
                              <span className="font-medium text-zinc-900">
                                {reservation.confirmationCode}
                              </span>

                              <span className="ml-2 text-zinc-500">
                                {formatStatus(reservation.status)}
                              </span>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => startEditing(resource)}
                      disabled={saving || changingStateId === resource.id}
                      className="h-9 rounded-lg border border-zinc-300 px-3 text-sm font-medium text-zinc-700 disabled:opacity-50"
                    >
                      Editar
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleToggleActive(resource)}
                      disabled={changingStateId === resource.id || saving}
                      className="h-9 rounded-lg border border-zinc-300 px-3 text-sm font-medium text-zinc-700 disabled:opacity-50"
                    >
                      {changingStateId === resource.id
                        ? "Procesando..."
                        : resource.isActive
                          ? "Desactivar"
                          : "Reactivar"}
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
