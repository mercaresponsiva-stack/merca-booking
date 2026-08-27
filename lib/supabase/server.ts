import "server-only";

import {
  createServerClient,
} from "@supabase/ssr";

import {
  cookies,
} from "next/headers";

import {
  getSupabasePublicConfig,
} from "@/lib/supabase/config";

export async function createClient() {
  const cookieStore =
    await cookies();

  const {
    url,
    publishableKey,
  } =
    getSupabasePublicConfig();

  return createServerClient(
    url,
    publishableKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },

        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(
              ({
                name,
                value,
                options,
              }) => {
                cookieStore.set(
                  name,
                  value,
                  options,
                );
              },
            );
          } catch {
            /*
             * Los Server Components no pueden escribir cookies.
             * El Proxy actualizará la sesión cuando esté habilitado.
             */
          }
        },
      },
    },
  );
}