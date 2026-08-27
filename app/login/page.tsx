import type { Metadata } from "next";

import LoginForm from "./LoginForm";

export const metadata: Metadata = {
  title: "Iniciar sesión",
  description: "Acceso al panel administrativo de Merca Booking.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-12 font-sans text-zinc-900">
      <section
        aria-labelledby="login-title"
        className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8"
      >
        <div className="mb-8">
          <p className="text-sm font-semibold tracking-wide text-zinc-500">
            Merca Booking
          </p>

          <h1
            id="login-title"
            className="mt-3 text-2xl font-semibold tracking-tight"
          >
            Iniciar sesión
          </h1>

          <p className="mt-2 text-sm leading-6 text-zinc-500">
            Accede con la cuenta asignada por tu negocio.
          </p>
        </div>

        <LoginForm />

        <p className="mt-6 border-t border-zinc-100 pt-5 text-sm leading-6 text-zinc-500">
          Si necesitas una cuenta, contacta al administrador de tu negocio.
        </p>
      </section>
    </main>
  );
}
