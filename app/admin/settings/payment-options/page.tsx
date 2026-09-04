"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useState,
} from "react";

import type {
  PaymentOption,
} from "@/lib/booking/payment-option";
import {
  DEV_BUSINESS_ID as BUSINESS_ID,
} from "@/lib/config/dev-context";

type PaymentOptionItem = {
  value: PaymentOption;
  label: string;
  percentage: number;
};

type PaymentOptionsResponse = {
  success: true;

  business: {
    id: string;
    name: string;
    enabledPaymentOptions: PaymentOption[];
  };

  options: PaymentOptionItem[];

  permissions: {
    canEdit: boolean;
  };
};

function getErrorMessage(
  value: unknown,
  fallback: string,
) {
  if (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string"
  ) {
    return value.error;
  }

  return fallback;
}

async function requestPaymentOptionsConfiguration(
  signal?: AbortSignal,
) {
  const response = await fetch(
    `/api/businesses/${BUSINESS_ID}/payment-options`,
    {
      cache: "no-store",
      signal,
    },
  );

  const result: unknown =
    await response.json();

  if (!response.ok) {
    throw new Error(
      getErrorMessage(
        result,
        "No fue posible cargar las modalidades de pago.",
      ),
    );
  }

  return result as PaymentOptionsResponse;
}

export default function PaymentOptionsSettingsPage() {
  const [businessName, setBusinessName] =
    useState("");

  const [availableOptions, setAvailableOptions] =
    useState<PaymentOptionItem[]>([]);

  const [enabledOptions, setEnabledOptions] =
    useState<PaymentOption[]>([]);

  const [canEdit, setCanEdit] =
    useState(false);

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [loadError, setLoadError] =
    useState<string | null>(null);

  const [formError, setFormError] =
    useState<string | null>(null);

  const [savedMessage, setSavedMessage] =
    useState<string | null>(null);

  async function loadConfiguration() {
    setLoading(true);
    setLoadError(null);

    try {
      const data =
        await requestPaymentOptionsConfiguration();

      setBusinessName(data.business.name);
      setAvailableOptions(data.options);
      setEnabledOptions(
        data.business.enabledPaymentOptions,
      );
      setCanEdit(data.permissions.canEdit);
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "No fue posible cargar las modalidades de pago.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();

    void requestPaymentOptionsConfiguration(
      controller.signal,
    )
      .then((data) => {
        setBusinessName(data.business.name);
        setAvailableOptions(data.options);
        setEnabledOptions(
          data.business.enabledPaymentOptions,
        );
        setCanEdit(data.permissions.canEdit);
      })
      .catch((error: unknown) => {
        if (
          error instanceof DOMException &&
          error.name === "AbortError"
        ) {
          return;
        }

        setLoadError(
          error instanceof Error
            ? error.message
            : "No fue posible cargar las modalidades de pago.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, []);

  const displayedOptions = useMemo(() => {
    const optionByValue = new Map(
      availableOptions.map((option) => [
        option.value,
        option,
      ]),
    );

    return [
      ...enabledOptions.flatMap((value) => {
        const option = optionByValue.get(value);

        return option ? [option] : [];
      }),

      ...availableOptions.filter(
        (option) =>
          !enabledOptions.includes(option.value),
      ),
    ];
  }, [availableOptions, enabledOptions]);

  function toggleOption(
    option: PaymentOption,
  ) {
    setFormError(null);
    setSavedMessage(null);

    setEnabledOptions((current) => {
      if (current.includes(option)) {
        if (current.length === 1) {
          setFormError(
            "Debes mantener al menos una modalidad de pago habilitada.",
          );

          return current;
        }

        return current.filter(
          (value) => value !== option,
        );
      }

      return [...current, option];
    });
  }

  function moveOption(
    option: PaymentOption,
    direction: -1 | 1,
  ) {
    setFormError(null);
    setSavedMessage(null);

    setEnabledOptions((current) => {
      const index = current.indexOf(option);
      const targetIndex = index + direction;

      if (
        index < 0 ||
        targetIndex < 0 ||
        targetIndex >= current.length
      ) {
        return current;
      }

      const next = [...current];
      const target = next[targetIndex];

      next[targetIndex] = option;
      next[index] = target;

      return next;
    });
  }

  async function saveConfiguration() {
    if (!canEdit || enabledOptions.length === 0) {
      return;
    }

    setSaving(true);
    setFormError(null);
    setSavedMessage(null);

    try {
      const response = await fetch(
        `/api/businesses/${BUSINESS_ID}/payment-options`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            enabledPaymentOptions:
              enabledOptions,
          }),
        },
      );

      const result: unknown =
        await response.json();

      if (!response.ok) {
        throw new Error(
          getErrorMessage(
            result,
            "No fue posible guardar las modalidades de pago.",
          ),
        );
      }

      const data =
        result as PaymentOptionsResponse;

      setEnabledOptions(
        data.business.enabledPaymentOptions,
      );
      setSavedMessage(
        "Las modalidades de pago fueron actualizadas.",
      );
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "No fue posible guardar las modalidades de pago.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-4xl p-4 sm:p-6">
      <div className="mb-6">
        <Link
          href="/admin"
          className="text-sm font-medium text-zinc-600 hover:text-zinc-900"
        >
          ← Volver al panel
        </Link>

        <h1 className="mt-4 text-2xl font-semibold text-zinc-950">
          Modalidades de pago
        </h1>

        <p className="mt-2 text-sm text-zinc-600">
          Elige qué anticipos podrá seleccionar el cliente y ordénalos como deben aparecer.
        </p>

        {businessName && (
          <p className="mt-1 text-sm font-medium text-zinc-800">
            {businessName}
          </p>
        )}
      </div>

      <section className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        Los cambios se aplican únicamente a reservas nuevas. Las reservas existentes conservarán la modalidad de pago con la que fueron creadas.
      </section>

      {loading && (
        <div className="rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-600">
          Cargando configuración…
        </div>
      )}

      {!loading && loadError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5">
          <p className="text-sm text-red-800">
            {loadError}
          </p>

          <button
            type="button"
            onClick={() => void loadConfiguration()}
            className="mt-4 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-800 hover:bg-red-100"
          >
            Intentar nuevamente
          </button>
        </div>
      )}

      {!loading && !loadError && (
        <>
          {!canEdit && (
            <div className="mb-5 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
              Puedes consultar esta configuración, pero solamente un propietario o administrador puede modificarla.
            </div>
          )}

          <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
            <div className="border-b border-zinc-200 px-5 py-4">
              <h2 className="font-semibold text-zinc-950">
                Opciones disponibles
              </h2>

              <p className="mt-1 text-sm text-zinc-600">
                Las opciones activas aparecen primero y en el orden configurado.
              </p>
            </div>

            <div className="divide-y divide-zinc-200">
              {displayedOptions.map((option) => {
                const enabled =
                  enabledOptions.includes(option.value);

                const enabledIndex =
                  enabledOptions.indexOf(option.value);

                return (
                  <div
                    key={option.value}
                    className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <label className="flex min-w-0 items-start gap-3">
                      <input
                        type="checkbox"
                        checked={enabled}
                        disabled={!canEdit || saving}
                        onChange={() => toggleOption(option.value)}
                        className="mt-1 h-4 w-4 rounded border-zinc-300"
                      />

                      <span>
                        <span className="block font-medium text-zinc-950">
                          {option.label}
                        </span>

                        <span className="mt-1 block text-sm text-zinc-600">
                          El pago inicial requerido será el {option.percentage}% del total de la reserva.
                        </span>
                      </span>
                    </label>

                    <div className="flex items-center gap-2 self-end sm:self-auto">
                      <span
                        className={
                          enabled
                            ? "rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800"
                            : "rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600"
                        }
                      >
                        {enabled ? "Activa" : "Inactiva"}
                      </span>

                      {enabled && canEdit && (
                        <>
                          <button
                            type="button"
                            aria-label={`Subir ${option.label}`}
                            title="Subir"
                            disabled={saving || enabledIndex === 0}
                            onClick={() => moveOption(option.value, -1)}
                            className="h-9 w-9 rounded-lg border border-zinc-300 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            ↑
                          </button>

                          <button
                            type="button"
                            aria-label={`Bajar ${option.label}`}
                            title="Bajar"
                            disabled={
                              saving ||
                              enabledIndex ===
                                enabledOptions.length - 1
                            }
                            onClick={() => moveOption(option.value, 1)}
                            className="h-9 w-9 rounded-lg border border-zinc-300 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            ↓
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {formError && (
            <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {formError}
            </p>
          )}

          {savedMessage && (
            <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              {savedMessage}
            </p>
          )}

          {canEdit && (
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                disabled={saving || enabledOptions.length === 0}
                onClick={() => void saveConfiguration()}
                className="rounded-lg bg-zinc-950 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? "Guardando…" : "Guardar configuración"}
              </button>
            </div>
          )}
        </>
      )}
    </main>
  );
}