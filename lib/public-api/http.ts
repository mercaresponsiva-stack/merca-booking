import "server-only";

import { NextResponse } from "next/server";

export const PUBLIC_API_NO_STORE =
  "no-store, max-age=0";

export const PUBLIC_CATALOG_CACHE =
  "public, max-age=60, s-maxage=300, stale-while-revalidate=600";

const PUBLIC_PREFLIGHT_CACHE =
  "public, max-age=86400";

function applyPublicHeaders(
  headers: Headers,
) {
  headers.set(
    "Access-Control-Allow-Origin",
    "*",
  );

  headers.set(
    "Access-Control-Allow-Methods",
    "GET, OPTIONS",
  );

  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type",
  );

  headers.set(
    "Cross-Origin-Resource-Policy",
    "cross-origin",
  );

  headers.set(
    "X-Content-Type-Options",
    "nosniff",
  );

  headers.set(
    "X-Robots-Tag",
    "noindex, nofollow",
  );

  if (
    !headers.has(
      "Cache-Control",
    )
  ) {
    headers.set(
      "Cache-Control",
      PUBLIC_API_NO_STORE,
    );
  }

  if (
    headers
      .get(
        "Cache-Control",
      )
      ?.includes(
        "no-store",
      )
  ) {
    headers.set(
      "Pragma",
      "no-cache",
    );

    headers.set(
      "Expires",
      "0",
    );
  }

  return headers;
}

export function publicJson(
  body: unknown,

  init: ResponseInit = {},
) {
  const headers =
    applyPublicHeaders(
      new Headers(
        init.headers,
      ),
    );

  return NextResponse.json(
    body,
    {
      ...init,

      headers,
    },
  );
}

export function publicError(
  status: number,

  code: string,

  error: string,
) {
  return publicJson(
    {
      success:
        false,

      code,

      error,
    },
    {
      status,
    },
  );
}

export function publicOptions() {
  const headers =
    applyPublicHeaders(
      new Headers({
        "Cache-Control":
          PUBLIC_PREFLIGHT_CACHE,

        "Access-Control-Max-Age":
          "86400",
      }),
    );

  return new NextResponse(
    null,
    {
      status:
        204,

      headers,
    },
  );
}
