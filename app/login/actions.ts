"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type LoginState = {
  error: string | null;
};

export async function signIn(
  previousState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  // El estado anterior viene del cliente y no determina la autenticación.
  void previousState;

  const emailValue = formData.get("email");
  const passwordValue = formData.get("password");

  if (
    typeof emailValue !== "string" ||
    typeof passwordValue !== "string"
  ) {
    return {
      error: "Introduce tu correo electrónico y tu contraseña.",
    };
  }

  const email = emailValue.trim().toLowerCase();

  // La contraseña se conserva exactamente como fue introducida.
  const password = passwordValue;

  if (
    email.length === 0 ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return {
      error: "Introduce un correo electrónico válido.",
    };
  }

  if (
    password.length === 0 ||
    password.length > 1024
  ) {
    return {
      error: "Introduce una contraseña de entre 1 y 1024 caracteres.",
    };
  }

  try {
    const supabase = await createClient();

    const { data, error } =
      await supabase.auth.signInWithPassword({
        email,
        password,
      });

    if (error) {
      if (error.status === 429) {
        return {
          error:
            "Demasiados intentos. Espera unos minutos antes de volver a intentarlo.",
        };
      }

      return {
        error:
          "No fue posible iniciar sesión. Revisa tus datos e inténtalo de nuevo.",
      };
    }

    if (!data.user || !data.session) {
      return {
        error:
          "No fue posible completar el inicio de sesión. Inténtalo de nuevo.",
      };
    }
  } catch {
    return {
      error:
        "El inicio de sesión no está disponible en este momento. Inténtalo de nuevo.",
    };
  }

  // redirect debe permanecer fuera del bloque try/catch.
  revalidatePath("/", "layout");
  redirect("/admin");
}
