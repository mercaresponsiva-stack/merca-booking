"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";

const BUSINESS_ID = "cmsni1uij0000ewvwjzoenugh";

type Customer = {
  id: string;

  firstName: string;
  lastName: string;

  email: string | null;
  phone: string | null;

  reservationCount: number;

  createdAt: string;
  updatedAt: string;
};

type CustomersResponse = {
  success: true;

  business: {
    id: string;
    name: string;
  };

  query: string | null;

  customers: Customer[];
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-SV", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);

  const [businessName, setBusinessName] = useState("");

  const [searchInput, setSearchInput] = useState("");

  const [appliedSearch, setAppliedSearch] = useState("");

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState<string | null>(null);

  const loadCustomers = useCallback(
    async (query = appliedSearch) => {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          businessId: BUSINESS_ID,

          limit: "50",
        });

        if (query.trim()) {
          params.set("query", query.trim());
        }

        const response = await fetch(`/api/customers?${params.toString()}`, {
          cache: "no-store",
        });

        const result = await response.json();

        if (!response.ok) {
          throw new Error(
            typeof result.error === "string"
              ? result.error
              : "No fue posible obtener los clientes",
          );
        }

        const data = result as CustomersResponse;

        setCustomers(data.customers);

        setBusinessName(data.business.name);
      } catch (error) {
        setError(
          error instanceof Error
            ? error.message
            : "No fue posible obtener los clientes",
        );
      } finally {
        setLoading(false);
      }
    },
    [appliedSearch],
  );

  useEffect(() => {
    void loadCustomers(appliedSearch);
  }, [appliedSearch, loadCustomers]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setAppliedSearch(searchInput.trim());
  }

  function handleReset() {
    setSearchInput("");
    setAppliedSearch("");
  }

  return (
    <main className="mx-auto w-full max-w-7xl p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Clientes</h1>

        <p className="mt-2 text-sm text-zinc-500">
          {businessName
            ? `Clientes registrados en ${businessName}.`
            : "Consulta los clientes registrados en el negocio."}
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="mb-6 rounded-xl border border-zinc-200 bg-white p-5"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col gap-1.5 text-sm">
            <span className="font-medium">Buscar cliente</span>

            <input
              type="search"
              autoComplete="off"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Nombre, apellido, correo o teléfono..."
              className="h-10 rounded-lg border border-zinc-300 px-3"
            />
          </label>

          <div className="flex gap-3">
            <button
              type="submit"
              className="h-10 rounded-lg bg-zinc-900 px-5 text-sm font-medium text-white"
            >
              Buscar
            </button>

            <button
              type="button"
              onClick={handleReset}
              disabled={!searchInput && !appliedSearch}
              className="h-10 rounded-lg border border-zinc-300 px-5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
            >
              Limpiar
            </button>
          </div>
        </div>
      </form>

      <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
        <div className="flex flex-col justify-between gap-3 border-b border-zinc-200 px-5 py-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="font-semibold">Listado de clientes</h2>

            <p className="mt-1 text-sm text-zinc-500">
              {loading
                ? "Cargando información..."
                : `${customers.length} cliente(s) mostrado(s)`}
            </p>
          </div>

          {appliedSearch && (
            <p className="text-sm text-zinc-500">
              Búsqueda:{" "}
              <span className="font-medium text-zinc-900">{appliedSearch}</span>
            </p>
          )}
        </div>

        {loading ? (
          <div className="flex min-h-64 items-center justify-center p-8">
            <p className="text-sm text-zinc-500">Cargando clientes...</p>
          </div>
        ) : error ? (
          <div className="flex min-h-64 flex-col items-center justify-center gap-4 p-8 text-center">
            <p className="text-sm font-medium text-red-700">{error}</p>

            <button
              type="button"
              onClick={() => void loadCustomers()}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm"
            >
              Reintentar
            </button>
          </div>
        ) : customers.length === 0 ? (
          <div className="flex min-h-64 flex-col items-center justify-center p-8 text-center">
            <p className="text-sm font-medium">No se encontraron clientes.</p>

            <p className="mt-2 text-sm text-zinc-500">
              Prueba con otro nombre, correo o teléfono.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-5 py-3">Cliente</th>

                  <th className="px-5 py-3">Correo</th>

                  <th className="px-5 py-3">Teléfono</th>

                  <th className="px-5 py-3">Reservas</th>

                  <th className="px-5 py-3">Cliente desde</th>

                  <th className="px-5 py-3">Acción</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-zinc-200">
                {customers.map((customer) => (
                  <tr key={customer.id} className="hover:bg-zinc-50">
                    <td className="px-5 py-4">
                      <Link
                        href={`/admin/customers/${customer.id}`}
                        className="font-medium hover:underline"
                      >
                        {customer.firstName} {customer.lastName}
                      </Link>

                      <p className="mt-1 text-xs text-zinc-400">
                        {customer.id}
                      </p>
                    </td>

                    <td className="px-5 py-4 text-zinc-600">
                      {customer.email || "—"}
                    </td>

                    <td className="px-5 py-4 text-zinc-600">
                      {customer.phone || "—"}
                    </td>

                    <td className="px-5 py-4">
                      <span className="inline-flex min-w-8 justify-center rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium">
                        {customer.reservationCount}
                      </span>
                    </td>

                    <td className="px-5 py-4 text-zinc-600">
                      {formatDate(customer.createdAt)}
                    </td>

                    <td className="px-5 py-4">
                      <Link
                        href={`/admin/customers/${customer.id}`}
                        className="text-sm font-medium hover:underline"
                      >
                        Ver cliente →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
