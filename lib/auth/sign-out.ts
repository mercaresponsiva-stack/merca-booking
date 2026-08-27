"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type SignOutState = {
  error: string | null;
};

export async function signOut(
  previousState: SignOutState,
): Promise<SignOutState> {
  void previousState;

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signOut({ scope: "local" });

    if (error) {
      return {
        error: "No fue posible cerrar sesión. Inténtalo de nuevo.",
      };
    }
  } catch {
    return {
      error: "No fue posible cerrar sesión. Inténtalo de nuevo.",
    };
  }

  // También pueden salir las cuentas que no tienen acceso al negocio.
  // La redirección debe permanecer fuera del try/catch.
  revalidatePath("/", "layout");
  redirect("/login");
}
