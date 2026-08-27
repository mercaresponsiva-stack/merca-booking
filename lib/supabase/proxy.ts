import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabasePublicConfig } from "@/lib/supabase/config";

export async function updateSession(request: NextRequest) {
  // Acumuladores exclusivos de esta solicitud, incluidos los borrados.
  const sessionCookies = NextResponse.next().cookies;
  const sessionHeaders = new Headers();

  function finish(response: NextResponse) {
    sessionHeaders.forEach((value, name) => {
      response.headers.set(name, value);
    });

    for (const cookie of sessionCookies.getAll()) {
      response.cookies.set(cookie);
    }

    response.headers.set(
      "Cache-Control",
      "private, no-store, max-age=0, must-revalidate",
    );
    response.headers.set("Pragma", "no-cache");
    response.headers.set("Expires", "0");
    response.headers.set("X-Robots-Tag", "noindex, nofollow");

    return response;
  }

  function unavailable() {
    return finish(
      new NextResponse(
        "No fue posible validar la sesión. Inténtalo de nuevo en unos instantes.",
        {
          status: 503,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Retry-After": "30",
          },
        },
      ),
    );
  }

  try {
    const { url, publishableKey } = getSupabasePublicConfig();

    const supabase = createServerClient(url, publishableKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },

        setAll(cookiesToSet, headers) {
          for (const { name, value, options } of cookiesToSet) {
            request.cookies.set(name, value);
            sessionCookies.set(name, value, options);
          }

          for (const [name, value] of Object.entries(headers ?? {})) {
            sessionHeaders.set(name, value);
          }
        },
      },
    });

    const { data, error } = await supabase.auth.getClaims();

    if (
      error &&
      error.status !== 400 &&
      error.status !== 401 &&
      error.status !== 403
    ) {
      return unavailable();
    }

    const hasSession =
      !error &&
      typeof data?.claims?.sub === "string" &&
      data.claims.sub.length > 0;

    const isAdminPath =
      request.nextUrl.pathname === "/admin" ||
      request.nextUrl.pathname.startsWith("/admin/");

    if (isAdminPath && !hasSession) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = "/login";
      loginUrl.search = "";

      return finish(NextResponse.redirect(loginUrl, 303));
    }

    // /login sigue disponible incluso con sesión: evita bucles de acceso.
    // La membresía se comprueba en el servidor, no en este Proxy.
    return finish(NextResponse.next({ request }));
  } catch {
    // No mostramos errores internos, cookies ni tokens.
    return unavailable();
  }
}
