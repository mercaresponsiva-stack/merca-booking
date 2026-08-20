"use client";

import { FormEvent, useEffect, useState } from "react";

import { DEV_BUSINESS_ID as BUSINESS_ID } from "@/lib/config/dev-context";

type CurrentRequirement = {
  resourceTypeId: string;

  requiredQuantity: number;

  resourceType: {
    id: string;

    name: string;

    activeResourceCount: number;
    totalResourceCount: number;
  };
};

type ResourceType = {
  id: string;

  name: string;
  slug: string;

  description: string | null;

  activeResourceCount: number;
};

type ResourceTypesResponse = {
  success: boolean;

  items?: ResourceType[];

  error?: string;
};

type ConflictReservation = {
  id: string;

  confirmationCode: string;

  status: string;

  startAt: string;
  endAt: string;

  guests: number;

  adults: number | null;
  children: number | null;
};

type ApiResponse = {
  success?: boolean;

  error?: string;
  code?: string;

  reservations?: ConflictReservation[];
};

type Props = {
  serviceId: string;

  serviceName: string;

  activeReservationCount: number;

  currentRequirements: CurrentRequirement[];

  onClose: () => void;

  onSaved: () => Promise<void> | void;
};

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

function createSelectedState(requirements: CurrentRequirement[]) {
  const result: Record<string, boolean> = {};

  for (const requirement of requirements) {
    result[requirement.resourceTypeId] = true;
  }

  return result;
}

function createQuantityState(requirements: CurrentRequirement[]) {
  const result: Record<string, string> = {};

  for (const requirement of requirements) {
    result[requirement.resourceTypeId] = String(requirement.requiredQuantity);
  }

  return result;
}

export default function ResourceRequirementsEditor({
  serviceId,

  serviceName,

  activeReservationCount,

  currentRequirements,

  onClose,

  onSaved,
}: Props) {
  const [resourceTypes, setResourceTypes] = useState<ResourceType[]>([]);

  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    createSelectedState(currentRequirements),
  );

  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    createQuantityState(currentRequirements),
  );

  const [loading, setLoading] = useState(true);

  const [saving, setSaving] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const [conflictReservations, setConflictReservations] = useState<
    ConflictReservation[]
  >([]);

  useEffect(() => {
    let cancelled = false;

    async function loadResourceTypes() {
      setLoading(true);

      setError(null);

      try {
        const response = await fetch(
          `/api/resource-types?businessId=${BUSINESS_ID}`,
          {
            cache: "no-store",
          },
        );

        const data = (await response.json()) as ResourceTypesResponse;

        if (!response.ok || !data.success) {
          throw new Error(
            data.error || "No fue posible cargar los tipos de recurso",
          );
        }

        if (!cancelled) {
          setResourceTypes(data.items ?? []);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "No fue posible cargar los tipos de recurso",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadResourceTypes();

    return () => {
      cancelled = true;
    };
  }, []);

  function toggleResourceType(resourceTypeId: string) {
    setSelected((current) => {
      const nextValue = !current[resourceTypeId];

      return {
        ...current,

        [resourceTypeId]: nextValue,
      };
    });

    setQuantities((current) => ({
      ...current,

      [resourceTypeId]: current[resourceTypeId] || "1",
    }));

    setError(null);

    setConflictReservations([]);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setSaving(true);

    setError(null);

    setConflictReservations([]);

    try {
      const requirements = resourceTypes
        .filter((resourceType) => selected[resourceType.id])
        .map((resourceType) => {
          const requiredQuantity = Number(quantities[resourceType.id] ?? "1");

          if (!Number.isInteger(requiredQuantity) || requiredQuantity < 1) {
            throw new Error(
              `La cantidad requerida para ${resourceType.name} debe ser un entero mayor o igual a 1.`,
            );
          }

          return {
            resourceTypeId: resourceType.id,

            requiredQuantity,
          };
        });

      const response = await fetch(
        `/api/services/${serviceId}/resource-types`,
        {
          method: "PUT",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            businessId: BUSINESS_ID,

            requirements,
          }),
        },
      );

      const result = (await response.json()) as ApiResponse;

      if (!response.ok || !result.success) {
        setConflictReservations(result.reservations ?? []);

        throw new Error(
          result.error || "No fue posible actualizar los recursos requeridos",
        );
      }

      await onSaved();

      onClose();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "No fue posible actualizar los recursos requeridos",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      id="service-resource-form"
      className="scroll-mt-6 rounded-xl border border-zinc-200 bg-white"
    >
      <div className="border-b border-zinc-200 px-5 py-4">
        <h2 className="font-semibold text-zinc-950">
          Inventario requerido por reserva
        </h2>

        <p className="mt-1 text-sm text-zinc-500">{serviceName}</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5 p-5">
        <div className="rounded-lg border border-zinc-200 p-4">
          <p className="text-sm font-medium text-zinc-900">
            ¿Qué estás configurando?
          </p>

          <p className="mt-1 text-sm leading-6 text-zinc-500">
            Define qué tipos de inventario necesita cada reserva de este
            servicio y cuántas unidades físicas de cada tipo debe consumir.
          </p>

          <p className="mt-2 text-sm leading-6 text-zinc-500">
            Si seleccionas varios tipos, todos serán obligatorios. No
            representan alternativas entre sí.
          </p>
        </div>

        {activeReservationCount > 0 && (
          <div className="rounded-lg border border-zinc-300 p-4">
            <p className="text-sm font-medium text-zinc-950">
              Este servicio tiene {activeReservationCount} reserva
              {activeReservationCount === 1 ? "" : "s"} activa
              {activeReservationCount === 1 ? "" : "s"}.
            </p>

            <p className="mt-1 text-sm leading-6 text-zinc-500">
              Puedes revisar la configuración, pero el backend rechazará
              cualquier cambio estructural mientras esas reservas sigan activas.
            </p>
          </div>
        )}

        {loading ? (
          <div className="rounded-lg border border-zinc-200 p-6 text-center text-sm text-zinc-500">
            Cargando tipos de recurso...
          </div>
        ) : resourceTypes.length === 0 ? (
          <div className="rounded-lg border border-zinc-200 p-6 text-center text-sm text-zinc-500">
            No existen tipos de recurso disponibles.
          </div>
        ) : (
          <div className="space-y-3">
            {resourceTypes.map((resourceType) => {
              const isSelected = Boolean(selected[resourceType.id]);

              return (
                <div
                  key={resourceType.id}
                  className="rounded-xl border border-zinc-200 p-4"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <label className="flex min-w-0 cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleResourceType(resourceType.id)}
                        disabled={saving}
                        className="mt-1"
                      />

                      <div className="min-w-0">
                        <p className="text-sm font-medium text-zinc-950">
                          {resourceType.name}
                        </p>

                        {resourceType.description && (
                          <p className="mt-1 text-xs leading-5 text-zinc-500">
                            {resourceType.description}
                          </p>
                        )}

                        <p className="mt-1 text-xs text-zinc-500">
                          Unidades físicas activas en inventario:{" "}
                          {resourceType.activeResourceCount}
                        </p>
                      </div>
                    </label>

                    {isSelected && (
                      <label className="w-full space-y-1 sm:w-40">
                        <span className="text-xs font-medium text-zinc-500">
                          Unidades por reserva
                        </span>

                        <input
                          required
                          type="number"
                          min="1"
                          step="1"
                          value={quantities[resourceType.id] ?? "1"}
                          onChange={(event) =>
                            setQuantities((current) => ({
                              ...current,

                              [resourceType.id]: event.target.value,
                            }))
                          }
                          disabled={saving}
                          className="h-10 w-full rounded-lg border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-500 disabled:opacity-50"
                        />
                      </label>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-zinc-300 p-4">
            <p className="text-sm font-medium text-zinc-950">{error}</p>

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
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="h-10 rounded-lg border border-zinc-300 px-4 text-sm font-medium text-zinc-700 disabled:opacity-50"
          >
            Cancelar
          </button>

          <button
            type="submit"
            disabled={saving || loading}
            className="h-10 rounded-lg bg-zinc-950 px-4 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? "Guardando..." : "Guardar recursos"}
          </button>
        </div>
      </form>
    </section>
  );
}
