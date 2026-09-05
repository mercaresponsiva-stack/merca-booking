import {
  NextResponse,
} from "next/server";

import {
  prisma,
} from "@/lib/prisma";

export const dynamic =
  "force-dynamic";

function healthJson(
  body: {
    success:
      boolean;

    status:
      "ok" |
      "unavailable";
  },

  status:
    number,
) {
  return NextResponse.json(
    body,
    {
      status,

      headers: {
        "Cache-Control":
          "no-store, max-age=0",

        "Pragma":
          "no-cache",

        "Expires":
          "0",

        "X-Content-Type-Options":
          "nosniff",

        "X-Robots-Tag":
          "noindex, nofollow",
      },
    },
  );
}

export async function GET() {
  try {
    await prisma.$queryRaw`
      SELECT 1
    `;

    return healthJson(
      {
        success:
          true,

        status:
          "ok",
      },
      200,
    );
  } catch (
    error
  ) {
    console.error(
      "GET /api/health error:",
      error,
    );

    return healthJson(
      {
        success:
          false,

        status:
          "unavailable",
      },
      503,
    );
  }
}
