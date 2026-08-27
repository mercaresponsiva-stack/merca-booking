"use client";

import { useActionState } from "react";

import { signOut, type SignOutState } from "@/lib/auth/sign-out";

const initialState: SignOutState = {
  error: null,
};

export default function SignOutButton() {
  const [state, formAction, pending] = useActionState(signOut, initialState);

  return (
    <form action={formAction} aria-busy={pending} className="relative">
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-lg border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-wait disabled:opacity-50"
      >
        {pending ? "Cerrando sesión..." : "Cerrar sesión"}
      </button>

      <div aria-live="polite" aria-atomic="true">
        {!pending && state.error && (
          <p className="absolute right-0 top-full z-20 mt-2 w-56 rounded-lg border border-red-200 bg-red-50 p-3 text-left text-xs text-red-700 shadow-sm">
            {state.error}
          </p>
        )}
      </div>
    </form>
  );
}
