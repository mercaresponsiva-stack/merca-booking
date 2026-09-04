import Link from "next/link";
import { redirect } from "next/navigation";

import SignOutButton from "./SignOutButton";

import {
  AuthorizationError,
  requireBusinessAccess,
  type BusinessAccess,
} from "@/lib/auth/business-access";
import { DEV_BUSINESS_ID } from "@/lib/config/dev-context";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let access: BusinessAccess;

  try {
    // Temporal: debe coincidir con el negocio usado por las pantallas.
    access = await requireBusinessAccess(DEV_BUSINESS_ID);
  } catch (error) {
    if (error instanceof AuthorizationError && error.status === 401) {
      redirect("/login");
    }

    const accessDenied =
      error instanceof AuthorizationError && error.status === 403;

    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-5 text-zinc-950">
        <section className="w-full max-w-md space-y-4 rounded-xl border border-zinc-200 bg-white p-6">
          <p className="text-sm font-medium text-zinc-500">Merca Booking</p>

          <h1 className="text-xl font-semibold">
            {accessDenied
              ? "Acceso no autorizado"
              : "Acceso temporalmente no disponible"}
          </h1>

          <p className="text-sm text-zinc-600">
            {accessDenied
              ? "Tu cuenta no tiene acceso activo a este negocio. Consulta con su administrador."
              : "No pudimos comprobar tu acceso. Inténtalo de nuevo en unos instantes."}
          </p>

          <Link
            href="/login"
            prefetch={false}
            className="inline-flex h-10 items-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white"
          >
            Ir a iniciar sesión
          </Link>

          <div className="flex justify-end">
            <SignOutButton />
          </div>
        </section>
      </main>
    );
  }

  const initials =
    access.user.name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0))
      .join("")
      .toUpperCase() || "U";

  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-950">
      <div className="min-h-screen lg:grid lg:grid-cols-[260px_1fr]">
        <aside className="border-b border-zinc-200 bg-zinc-950 text-white lg:min-h-screen lg:border-b-0 lg:border-r lg:border-zinc-800">
          <div className="flex h-full flex-col">
            <div className="flex h-20 items-center border-b border-zinc-800 px-6">
              <div>
                <p className="text-lg font-semibold tracking-tight">
                  Merca Booking
                </p>

                <p className="mt-0.5 text-xs text-zinc-400">Administración</p>
              </div>
            </div>

            <nav className="flex gap-2 overflow-x-auto p-4 lg:flex-1 lg:flex-col">
              <Link
                href="/admin/reservations"
                className="flex min-w-fit items-center gap-3 rounded-lg bg-white/10 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/15"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  className="h-5 w-5"
                  aria-hidden="true"
                >
                  <path d="M6 3v3M18 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Z" />
                  <path d="M8 13h3M13 13h3M8 17h3" />
                </svg>
                Reservas
              </Link>

              <Link
                href="/admin/calendar"
                className="flex min-w-fit items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium text-zinc-300 transition hover:bg-white/10 hover:text-white"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  className="h-5 w-5"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="8" />
                  <path d="M12 8v4l3 2" />
                </svg>
                Calendario
              </Link>

              <Link
                href="/admin/blocks"
                className="flex min-w-fit items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium text-zinc-300 transition hover:bg-white/10 hover:text-white"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  className="h-5 w-5"
                  aria-hidden="true"
                >
                  <rect x="5" y="10" width="14" height="10" rx="2" />

                  <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                </svg>
                Bloqueos
              </Link>

              <Link
                href="/admin/resources"
                className="flex min-w-fit items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium text-zinc-300 transition hover:bg-white/10 hover:text-white"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  className="h-5 w-5"
                  aria-hidden="true"
                >
                  <rect x="4" y="4" width="6" height="6" rx="1" />

                  <rect x="14" y="4" width="6" height="6" rx="1" />

                  <rect x="4" y="14" width="6" height="6" rx="1" />

                  <rect x="14" y="14" width="6" height="6" rx="1" />
                </svg>
                Inventario
              </Link>

              <Link
                href="/admin/services"
                className="flex min-w-fit items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium text-zinc-300 transition hover:bg-white/10 hover:text-white"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  className="h-5 w-5"
                  aria-hidden="true"
                >
                  <path d="M5 6h14" />

                  <path d="M5 12h14" />

                  <path d="M5 18h14" />

                  <circle cx="8" cy="6" r="1.5" />

                  <circle cx="16" cy="12" r="1.5" />

                  <circle cx="10" cy="18" r="1.5" />
                </svg>
                Servicios
              </Link>

              <Link
                href="/admin/refund-policies"
                className="flex min-w-fit items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium text-zinc-300 transition hover:bg-white/10 hover:text-white"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  className="h-5 w-5"
                  aria-hidden="true"
                >
                  <path d="M6 3h9l3 3v15H6V3Z" />
                  <path d="M15 3v4h4" />
                  <path d="M9 11h6" />
                  <path d="M9 15h6" />
                </svg>
                Políticas de reembolso
              </Link>

              <Link
                href="/admin/customers"
                className="flex min-w-fit items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium text-zinc-300 transition hover:bg-white/10 hover:text-white"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  className="h-5 w-5"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="8" r="3" />

                  <path d="M6 20c0-3.5 2.7-6 6-6s6 2.5 6 6" />
                </svg>
                Clientes
              </Link>
              <Link
                href="/admin/settings/payment-options"
                className="flex min-w-fit items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium text-zinc-300 transition hover:bg-white/10 hover:text-white"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  className="h-5 w-5"
                  aria-hidden="true"
                >
                  <rect x="3" y="6" width="18" height="12" rx="2" />
                  <path d="M3 10h18" />
                  <path d="M7 15h3" />
                </svg>
                Pagos
              </Link>
            </nav>

            <div className="hidden border-t border-zinc-800 p-4 lg:block">
              <div className="rounded-xl bg-zinc-900 p-4">
                <p className="text-sm font-medium">{access.business.name}</p>

                <p className="mt-1 text-xs text-zinc-500">
                  Entorno de desarrollo
                </p>
              </div>
            </div>
          </div>
        </aside>

        <div className="min-w-0">
          <header className="flex h-16 items-center justify-between border-b border-zinc-200 bg-white px-5 sm:px-8">
            <div>
              <p className="text-sm font-medium text-zinc-900">
                Panel de recepción
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="hidden text-right sm:block">
                <p className="text-sm font-medium">{access.user.name}</p>

                <p className="text-xs text-zinc-500">{access.role}</p>
              </div>

              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white">
                {initials}
              </div>

              <SignOutButton />
            </div>
          </header>

          <main className="p-5 sm:p-8 lg:p-10">{children}</main>
        </div>
      </div>
    </div>
  );
}
