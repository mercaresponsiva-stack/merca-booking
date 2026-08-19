"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

const BUSINESS_ID = "cmsni1uij0000ewvwjzoenugh";

type InventoryView = "RESOURCES" | "RESOURCE_TYPES";

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

  description: string | null;

  activeResourceCount: number;
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

  resourceType: {
    id: string;
    name: string;
    slug: string;
  };

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

  items?: ResourceType[];

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

type ResourceTypeForm = {
  name: string;
  slug: string;
  description: string;
};

function createEmptyResourceForm(resourceTypeId = ""): ResourceForm {
  return {
    name: "",
    code: "",

    resourceTypeId,

    floor: "",
    capacity: "1",

    isActive: true,
  };
}

function createEmptyResourceTypeForm(): ResourceTypeForm {
  return {
    name: "",
    slug: "",
    description: "",
  };
}

function createSlug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
  const [inventoryView, setInventoryView] =
    useState<InventoryView>("RESOURCES");

  const [resources, setResources] = useState<Resource[]>([]);

  const [resourceTypes, setResourceTypes] = useState<ResourceType[]>([]);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState<string | null>(null);

  const [typeFilter, setTypeFilter] = useState("ALL");

  const [stateFilter, setStateFilter] = useState("ALL");

  /*
   * RESOURCE FORM
   */

  const [creatingResource, setCreatingResource] = useState(false);

  const [editingResourceId, setEditingResourceId] = useState<string | null>(
    null,
  );

  const [resourceForm, setResourceForm] = useState<ResourceForm>(
    createEmptyResourceForm(),
  );

  const [savingResource, setSavingResource] = useState(false);

  const [changingStateId, setChangingStateId] = useState<string | null>(null);

  const [resourceFormError, setResourceFormError] = useState<string | null>(
    null,
  );

  const [conflictReservations, setConflictReservations] = useState<
    ApiConflictReservation[]
  >([]);

  /*
   * RESOURCE TYPE FORM
   */

  const [creatingResourceType, setCreatingResourceType] = useState(false);

  const [editingResourceTypeId, setEditingResourceTypeId] = useState<
    string | null
  >(null);

  const [resourceTypeForm, setResourceTypeForm] = useState<ResourceTypeForm>(
    createEmptyResourceTypeForm(),
  );

  const [resourceTypeSlugTouched, setResourceTypeSlugTouched] = useState(false);

  const [savingResourceType, setSavingResourceType] = useState(false);

  const [resourceTypeFormError, setResourceTypeFormError] = useState<
    string | null
  >(null);

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
            "No fue posible cargar los tipos de inventario",
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

  const resourceSummary = useMemo(() => {
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

  const resourceTypeSummary = useMemo(() => {
    const total = resourceTypes.length;

    const activeUnits = resourceTypes.reduce(
      (accumulator, resourceType) =>
        accumulator + resourceType.activeResourceCount,
      0,
    );

    const withoutResources = resourceTypes.filter(
      (resourceType) => resourceType.activeResourceCount === 0,
    ).length;

    return {
      total,
      activeUnits,
      withoutResources,
    };
  }, [resourceTypes]);

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

  function scrollToElement(id: string) {
    window.requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({
        behavior: "smooth",

        block: "start",
      });
    });
  }

  function switchInventoryView(view: InventoryView) {
    setInventoryView(view);

    closeResourceForm();
    closeResourceTypeForm();

    setError(null);

    setConflictReservations([]);
  }

  /*
   * RESOURCE CRUD
   */

  function startCreatingResource() {
    setInventoryView("RESOURCES");

    setCreatingResource(true);

    setEditingResourceId(null);

    setResourceForm(createEmptyResourceForm(resourceTypes[0]?.id ?? ""));

    setResourceFormError(null);

    setConflictReservations([]);

    scrollToElement("resource-form");
  }

  function startEditingResource(resource: Resource) {
    setInventoryView("RESOURCES");

    setCreatingResource(false);

    setEditingResourceId(resource.id);

    setResourceForm({
      name: resource.name,

      code: resource.code ?? "",

      resourceTypeId: resource.resourceTypeId,

      floor: resource.floor === null ? "" : String(resource.floor),

      capacity: String(resource.capacity),

      isActive: resource.isActive,
    });

    setResourceFormError(null);

    setConflictReservations([]);

    scrollToElement("resource-form");
  }

  function closeResourceForm() {
    setCreatingResource(false);

    setEditingResourceId(null);

    setResourceForm(createEmptyResourceForm());

    setResourceFormError(null);

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

  async function handleResourceSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setSavingResource(true);

    setResourceFormError(null);

    setConflictReservations([]);

    try {
      if (creatingResource) {
        await createResource(resourceForm);
      } else {
        if (!editingResourceId) {
          return;
        }

        const resource = resources.find(
          (item) => item.id === editingResourceId,
        );

        if (!resource) {
          throw new Error("Recurso no encontrado");
        }

        await patchResource(resource, resourceForm);
      }

      closeResourceForm();

      await loadData();
    } catch (saveError) {
      const apiError = saveError as Error & {
        reservations?: ApiConflictReservation[];
      };

      setResourceFormError(apiError.message);

      setConflictReservations(apiError.reservations ?? []);
    } finally {
      setSavingResource(false);
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

    setResourceFormError(null);

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

  /*
   * RESOURCE TYPE CRUD
   */

  function startCreatingResourceType() {
    setInventoryView("RESOURCE_TYPES");

    setCreatingResourceType(true);

    setEditingResourceTypeId(null);

    setResourceTypeForm(createEmptyResourceTypeForm());

    setResourceTypeSlugTouched(false);

    setResourceTypeFormError(null);

    scrollToElement("resource-type-form");
  }

  function startEditingResourceType(resourceType: ResourceType) {
    setInventoryView("RESOURCE_TYPES");

    setCreatingResourceType(false);

    setEditingResourceTypeId(resourceType.id);

    setResourceTypeForm({
      name: resourceType.name,

      slug: resourceType.slug,

      description: resourceType.description ?? "",
    });

    /*
     * En edición no cambiamos
     * automáticamente el slug
     * cuando cambia el nombre.
     */
    setResourceTypeSlugTouched(true);

    setResourceTypeFormError(null);

    scrollToElement("resource-type-form");
  }

  function closeResourceTypeForm() {
    setCreatingResourceType(false);

    setEditingResourceTypeId(null);

    setResourceTypeForm(createEmptyResourceTypeForm());

    setResourceTypeSlugTouched(false);

    setResourceTypeFormError(null);
  }

  async function createResourceType(data: ResourceTypeForm) {
    const response = await fetch("/api/resource-types", {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        businessId: BUSINESS_ID,

        name: data.name.trim(),

        slug: data.slug.trim(),

        description: data.description.trim(),
      }),
    });

    const result = (await response.json()) as ApiErrorResponse & {
      item?: ResourceType;
    };

    if (!response.ok || !result.success) {
      throw new Error(
        result.error || "No fue posible crear el tipo de inventario",
      );
    }

    return result;
  }

  async function patchResourceType(id: string, data: ResourceTypeForm) {
    const response = await fetch(`/api/resource-types/${id}`, {
      method: "PATCH",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        name: data.name.trim(),

        slug: data.slug.trim(),

        description: data.description.trim(),
      }),
    });

    const result = (await response.json()) as ApiErrorResponse & {
      item?: ResourceType;
    };

    if (!response.ok || !result.success) {
      throw new Error(
        result.error || "No fue posible actualizar el tipo de inventario",
      );
    }

    return result;
  }

  async function handleResourceTypeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setSavingResourceType(true);

    setResourceTypeFormError(null);

    try {
      if (creatingResourceType) {
        await createResourceType(resourceTypeForm);
      } else {
        if (!editingResourceTypeId) {
          return;
        }

        await patchResourceType(editingResourceTypeId, resourceTypeForm);
      }

      closeResourceTypeForm();

      await loadData();
    } catch (saveError) {
      setResourceTypeFormError(
        saveError instanceof Error
          ? saveError.message
          : "No fue posible guardar el tipo de inventario",
      );
    } finally {
      setSavingResourceType(false);
    }
  }

  const editingResource = editingResourceId
    ? (resources.find((resource) => resource.id === editingResourceId) ?? null)
    : null;

  const resourceFormVisible = creatingResource || editingResource !== null;

  const editingResourceType = editingResourceTypeId
    ? (resourceTypes.find(
        (resourceType) => resourceType.id === editingResourceTypeId,
      ) ?? null)
    : null;

  const resourceTypeFormVisible =
    creatingResourceType || editingResourceType !== null;

  const busy = savingResource || savingResourceType || changingStateId !== null;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">
            Inventario
          </h1>

          <p className="text-sm text-zinc-500">
            Administra las categorías de inventario y sus unidades físicas.
          </p>
        </div>

        {inventoryView === "RESOURCES" ? (
          <button
            type="button"
            onClick={startCreatingResource}
            disabled={loading || resourceTypes.length === 0 || busy}
            className="h-10 rounded-lg bg-zinc-950 px-4 text-sm font-medium text-white disabled:opacity-50"
          >
            Nuevo recurso
          </button>
        ) : (
          <button
            type="button"
            onClick={startCreatingResourceType}
            disabled={loading || busy}
            className="h-10 rounded-lg bg-zinc-950 px-4 text-sm font-medium text-white disabled:opacity-50"
          >
            Nuevo tipo de inventario
          </button>
        )}
      </header>

      <section className="flex flex-wrap gap-2 border-b border-zinc-200">
        <button
          type="button"
          onClick={() => switchInventoryView("RESOURCES")}
          className={`border-b-2 px-4 py-3 text-sm font-medium ${
            inventoryView === "RESOURCES"
              ? "border-zinc-950 text-zinc-950"
              : "border-transparent text-zinc-500 hover:text-zinc-900"
          }`}
        >
          Unidades físicas
        </button>

        <button
          type="button"
          onClick={() => switchInventoryView("RESOURCE_TYPES")}
          className={`border-b-2 px-4 py-3 text-sm font-medium ${
            inventoryView === "RESOURCE_TYPES"
              ? "border-zinc-950 text-zinc-950"
              : "border-transparent text-zinc-500 hover:text-zinc-900"
          }`}
        >
          Tipos de inventario
        </button>
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

      {inventoryView === "RESOURCES" && (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-zinc-200 bg-white p-4">
              <p className="text-sm text-zinc-500">Recursos</p>

              <p className="mt-1 text-2xl font-semibold text-zinc-950">
                {resourceSummary.total}
              </p>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-4">
              <p className="text-sm text-zinc-500">Activos</p>

              <p className="mt-1 text-2xl font-semibold text-zinc-950">
                {resourceSummary.active}
              </p>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-4">
              <p className="text-sm text-zinc-500">Inactivos</p>

              <p className="mt-1 text-2xl font-semibold text-zinc-950">
                {resourceSummary.inactive}
              </p>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-4">
              <p className="text-sm text-zinc-500">Con reservas activas</p>

              <p className="mt-1 text-2xl font-semibold text-zinc-950">
                {resourceSummary.assigned}
              </p>
            </div>
          </section>

          {resourceFormVisible && (
            <section
              id="resource-form"
              className="scroll-mt-6 rounded-xl border border-zinc-200 bg-white"
            >
              <div className="border-b border-zinc-200 px-5 py-4">
                <h2 className="font-semibold text-zinc-950">
                  {creatingResource ? "Nuevo recurso" : "Editar recurso"}
                </h2>

                <p className="mt-1 text-sm text-zinc-500">
                  {creatingResource
                    ? "Agrega una nueva unidad física al inventario."
                    : editingResource
                      ? getResourceLabel(editingResource)
                      : ""}
                </p>
              </div>

              <form onSubmit={handleResourceSubmit} className="space-y-5 p-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-1.5">
                    <span className="text-sm font-medium text-zinc-700">
                      Nombre
                    </span>

                    <input
                      required
                      value={resourceForm.name}
                      onChange={(event) =>
                        setResourceForm((current) => ({
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
                      value={resourceForm.code}
                      onChange={(event) =>
                        setResourceForm((current) => ({
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
                      Tipo de inventario
                    </span>

                    <select
                      required
                      value={resourceForm.resourceTypeId}
                      onChange={(event) =>
                        setResourceForm((current) => ({
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
                    <span className="text-sm font-medium text-zinc-700">
                      Piso
                    </span>

                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={resourceForm.floor}
                      onChange={(event) =>
                        setResourceForm((current) => ({
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
                      value={resourceForm.capacity}
                      onChange={(event) =>
                        setResourceForm((current) => ({
                          ...current,

                          capacity: event.target.value,
                        }))
                      }
                      className="h-10 w-full rounded-lg border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-500"
                    />

                    <p className="text-xs text-zinc-500">
                      Para inventario sin una capacidad de personas específica,
                      utiliza 1.
                    </p>
                  </label>
                </div>

                {creatingResource && (
                  <label className="flex items-center gap-3 rounded-lg border border-zinc-200 p-4">
                    <input
                      type="checkbox"
                      checked={resourceForm.isActive}
                      onChange={(event) =>
                        setResourceForm((current) => ({
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

                {resourceFormError && (
                  <div className="rounded-lg border border-zinc-300 p-4">
                    <p className="text-sm font-medium text-zinc-950">
                      {resourceFormError}
                    </p>

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
                    disabled={savingResource}
                    onClick={closeResourceForm}
                    className="h-10 rounded-lg border border-zinc-300 px-4 text-sm font-medium text-zinc-700 disabled:opacity-50"
                  >
                    Cancelar
                  </button>

                  <button
                    type="submit"
                    disabled={savingResource}
                    className="h-10 rounded-lg bg-zinc-950 px-4 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {savingResource
                      ? creatingResource
                        ? "Creando..."
                        : "Guardando..."
                      : creatingResource
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
                <h2 className="font-semibold text-zinc-950">
                  Unidades físicas
                </h2>

                <p className="mt-1 text-sm text-zinc-500">
                  {filteredResources.length} de {resources.length}
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs font-medium text-zinc-500">
                    Tipo
                  </span>

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
                  <span className="text-xs font-medium text-zinc-500">
                    Estado
                  </span>

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
                              {resource.activeReservations.map(
                                (reservation) => (
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
                                ),
                              )}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => startEditingResource(resource)}
                          disabled={
                            savingResource || changingStateId === resource.id
                          }
                          className="h-9 rounded-lg border border-zinc-300 px-3 text-sm font-medium text-zinc-700 disabled:opacity-50"
                        >
                          Editar
                        </button>

                        <button
                          type="button"
                          onClick={() => void handleToggleActive(resource)}
                          disabled={
                            changingStateId === resource.id || savingResource
                          }
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
        </>
      )}

      {inventoryView === "RESOURCE_TYPES" && (
        <>
          <section className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-zinc-200 bg-white p-4">
              <p className="text-sm text-zinc-500">Tipos de inventario</p>

              <p className="mt-1 text-2xl font-semibold text-zinc-950">
                {resourceTypeSummary.total}
              </p>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-4">
              <p className="text-sm text-zinc-500">Unidades físicas activas</p>

              <p className="mt-1 text-2xl font-semibold text-zinc-950">
                {resourceTypeSummary.activeUnits}
              </p>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-4">
              <p className="text-sm text-zinc-500">
                Tipos sin unidades activas
              </p>

              <p className="mt-1 text-2xl font-semibold text-zinc-950">
                {resourceTypeSummary.withoutResources}
              </p>
            </div>
          </section>

          <section className="rounded-xl border border-zinc-200 bg-white p-5">
            <h2 className="font-semibold text-zinc-950">
              ¿Qué es un tipo de inventario?
            </h2>

            <p className="mt-2 max-w-4xl text-sm leading-6 text-zinc-600">
              Representa una categoría de inventario físico finito que puede
              agotarse durante una reserva, por ejemplo habitaciones, mesas,
              estacionamientos, cunas o camas extra. No debe utilizarse para
              conceptos como persona adicional, desayuno o mascota cuando no
              representan una unidad física limitada.
            </p>

            <p className="mt-2 text-sm text-zinc-500">
              Los tipos de inventario no se eliminan desde administración en
              esta versión para proteger relaciones con recursos, servicios,
              bloqueos e historial.
            </p>
          </section>

          {resourceTypeFormVisible && (
            <section
              id="resource-type-form"
              className="scroll-mt-6 rounded-xl border border-zinc-200 bg-white"
            >
              <div className="border-b border-zinc-200 px-5 py-4">
                <h2 className="font-semibold text-zinc-950">
                  {creatingResourceType
                    ? "Nuevo tipo de inventario"
                    : "Editar tipo de inventario"}
                </h2>

                <p className="mt-1 text-sm text-zinc-500">
                  {creatingResourceType
                    ? "Crea una nueva categoría para agrupar unidades físicas."
                    : editingResourceType
                      ? editingResourceType.name
                      : ""}
                </p>
              </div>

              <form
                onSubmit={handleResourceTypeSubmit}
                className="space-y-5 p-5"
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-1.5">
                    <span className="text-sm font-medium text-zinc-700">
                      Nombre
                    </span>

                    <input
                      required
                      value={resourceTypeForm.name}
                      onChange={(event) => {
                        const name = event.target.value;

                        setResourceTypeForm((current) => ({
                          ...current,

                          name,

                          slug:
                            creatingResourceType && !resourceTypeSlugTouched
                              ? createSlug(name)
                              : current.slug,
                        }));
                      }}
                      placeholder="Ej. Estacionamiento"
                      className="h-10 w-full rounded-lg border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-500"
                    />
                  </label>

                  <label className="space-y-1.5">
                    <span className="text-sm font-medium text-zinc-700">
                      Slug
                    </span>

                    <input
                      required
                      value={resourceTypeForm.slug}
                      onChange={(event) => {
                        setResourceTypeSlugTouched(true);

                        setResourceTypeForm((current) => ({
                          ...current,

                          slug: createSlug(event.target.value),
                        }));
                      }}
                      placeholder="ej. estacionamiento"
                      className="h-10 w-full rounded-lg border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-500"
                    />

                    <p className="text-xs text-zinc-500">
                      Identificador único dentro del negocio.
                    </p>
                  </label>
                </div>

                <label className="block space-y-1.5">
                  <span className="text-sm font-medium text-zinc-700">
                    Descripción
                  </span>

                  <textarea
                    rows={4}
                    value={resourceTypeForm.description}
                    onChange={(event) =>
                      setResourceTypeForm((current) => ({
                        ...current,

                        description: event.target.value,
                      }))
                    }
                    placeholder="Describe qué unidades físicas pertenecen a este tipo de inventario."
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
                  />
                </label>

                {resourceTypeFormError && (
                  <div className="rounded-lg border border-zinc-300 p-4">
                    <p className="text-sm font-medium text-zinc-950">
                      {resourceTypeFormError}
                    </p>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={savingResourceType}
                    onClick={closeResourceTypeForm}
                    className="h-10 rounded-lg border border-zinc-300 px-4 text-sm font-medium text-zinc-700 disabled:opacity-50"
                  >
                    Cancelar
                  </button>

                  <button
                    type="submit"
                    disabled={savingResourceType}
                    className="h-10 rounded-lg bg-zinc-950 px-4 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {savingResourceType
                      ? creatingResourceType
                        ? "Creando..."
                        : "Guardando..."
                      : creatingResourceType
                        ? "Crear tipo"
                        : "Guardar cambios"}
                  </button>
                </div>
              </form>
            </section>
          )}

          <section className="rounded-xl border border-zinc-200 bg-white">
            <div className="border-b border-zinc-200 p-5">
              <h2 className="font-semibold text-zinc-950">
                Tipos de inventario
              </h2>

              <p className="mt-1 text-sm text-zinc-500">
                {resourceTypes.length} tipos configurados
              </p>
            </div>

            {loading ? (
              <div className="p-8 text-center text-sm text-zinc-500">
                Cargando tipos de inventario...
              </div>
            ) : resourceTypes.length === 0 ? (
              <div className="p-8 text-center text-sm text-zinc-500">
                No hay tipos de inventario configurados.
              </div>
            ) : (
              <div className="divide-y divide-zinc-200">
                {resourceTypes.map((resourceType) => (
                  <article key={resourceType.id} className="p-5">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-zinc-950">
                            {resourceType.name}
                          </h3>

                          <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-600">
                            {resourceType.slug}
                          </span>
                        </div>

                        <p className="mt-2 text-sm text-zinc-600">
                          {resourceType.description || "Sin descripción."}
                        </p>

                        <p className="mt-2 text-sm text-zinc-500">
                          Unidades físicas activas:{" "}
                          <span className="font-medium text-zinc-700">
                            {resourceType.activeResourceCount}
                          </span>
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => startEditingResourceType(resourceType)}
                        disabled={busy}
                        className="h-9 shrink-0 rounded-lg border border-zinc-300 px-3 text-sm font-medium text-zinc-700 disabled:opacity-50"
                      >
                        Editar
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
