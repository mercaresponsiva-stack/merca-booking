"use client";

import { useActionState, useState } from "react";

import { signIn, type LoginState } from "./actions";

const INITIAL_STATE: LoginState = {
  error: null,
};

export default function LoginForm() {
  const [email, setEmail] = useState("");

  const [state, formAction, isPending] =
    useActionState(signIn, INITIAL_STATE);

  return (
    <form
      action={formAction}
      aria-busy={isPending}
      className="space-y-5"
    >
      <fieldset
        disabled={isPending}
        className="space-y-5"
      >
        <legend className="sr-only">
          Credenciales de acceso
        </legend>

        <div className="space-y-2">
          <label
            htmlFor="login-email"
            className="block text-sm font-medium text-zinc-900"
          >
            Correo electrónico
          </label>

          <input
            id="login-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-describedby="login-feedback"
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-zinc-900 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 disabled:opacity-60"
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="login-password"
            className="block text-sm font-medium text-zinc-900"
          >
            Contraseña
          </label>

          <input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={1024}
            aria-describedby="login-feedback"
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-zinc-900 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 disabled:opacity-60"
          />
        </div>
      </fieldset>

      <div
        id="login-feedback"
        aria-live="polite"
        aria-atomic="true"
      >
        {!isPending && state.error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700">
            {state.error}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="flex h-11 w-full items-center justify-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? "Iniciando sesión..." : "Iniciar sesión"}
      </button>
    </form>
  );
}
