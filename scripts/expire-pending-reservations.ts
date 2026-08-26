import {
  loadEnvConfig,
} from "@next/env";

loadEnvConfig(
  process.cwd(),
);

const DEFAULT_BATCH_LIMIT =
  100;

function resolveBatchLimit() {
  const configuredLimit =
    process.env
      .RESERVATION_EXPIRATION_BATCH_LIMIT
      ?.trim();

  if (
    !configuredLimit
  ) {
    return DEFAULT_BATCH_LIMIT;
  }

  return Number(
    configuredLimit,
  );
}

async function main() {
  const {
    prisma,
  } =
    await import(
      "../lib/prisma"
    );

  try {
    const {
      expireDuePendingReservations,
    } =
      await import(
        "../lib/booking/reservation-expiration-batch"
      );

    const result =
      await expireDuePendingReservations({
        requestedAt:
          new Date(),

        limit:
          resolveBatchLimit(),
      });

    const marker =
      result.failedCount ===
        0
        ? "RESERVATION_PENDING_EXPIRATION_BATCH_RUN_OK"
        : "RESERVATION_PENDING_EXPIRATION_BATCH_RUN_PARTIAL_FAILURE";

    console.log(
      marker,
    );

    console.log(
      JSON.stringify(
        result,
        null,
        2,
      ),
    );

    if (
      result.failedCount >
        0
    ) {
      process.exitCode =
        1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(
  (
    error,
  ) => {
    console.error(
      "RESERVATION_PENDING_EXPIRATION_BATCH_RUN_FAILED",
      error,
    );

    process.exitCode =
      1;
  },
);