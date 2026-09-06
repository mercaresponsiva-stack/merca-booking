import "server-only";

const TURNSTILE_SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const TURNSTILE_REQUEST_TIMEOUT_MS =
  5000;

export const MAXIMUM_TURNSTILE_TOKEN_LENGTH =
  2048;

const TURNSTILE_ACTION_PATTERN =
  /^[a-z0-9_-]{1,32}$/i;

const TURNSTILE_HOSTNAME_PATTERN =
  /^[a-z0-9.-]+$/;

type TurnstileVerificationResult =
  | {
      status:
        "valid";
    }
  | {
      status:
        "invalid";

      errorCodes:
        string[];
    }
  | {
      status:
        "unavailable";
    }
  | {
      status:
        "configuration_error";
    };

function readTurnstileConfiguration() {
  const secret =
    process.env
      .TURNSTILE_SECRET_KEY
      ?.trim() ??
    "";

  const expectedAction =
    process.env
      .TURNSTILE_EXPECTED_ACTION
      ?.trim() ??
    "";

  /*
   * Las claves dummy de Cloudflare pueden
   * responder sin action y con example.com.
   *
   * Este modo solo puede activarse fuera
   * de producción. Producción siempre exige
   * coincidencia exacta de action y hostname.
   */
  const testMode =
    process.env
      .TURNSTILE_TEST_MODE ===
      "true" &&
    process.env.NODE_ENV !==
      "production";

  const allowedHostnames =
    (
      process.env
        .TURNSTILE_ALLOWED_HOSTNAMES ??
      ""
    )
      .split(",")
      .map(
        (hostname) =>
          hostname
            .trim()
            .toLowerCase(),
      )
      .filter(
        Boolean,
      );

  const hostnamesAreValid =
    allowedHostnames.length >
      0 &&
    allowedHostnames.every(
      (hostname) =>
        hostname.length <=
          253 &&
        !hostname.startsWith(
          ".",
        ) &&
        !hostname.endsWith(
          ".",
        ) &&
        !hostname.includes(
          "..",
        ) &&
        TURNSTILE_HOSTNAME_PATTERN.test(
          hostname,
        ),
    );

  if (
    !secret ||
    (
      !testMode &&
      !TURNSTILE_ACTION_PATTERN.test(
        expectedAction,
      )
    ) ||
    !hostnamesAreValid
  ) {
    return null;
  }

  return {
    secret,
    expectedAction,
    testMode,

    allowedHostnames:
      new Set(
        allowedHostnames,
      ),
  };
}

function getErrorCodes(
  value: unknown,
) {
  if (
    !Array.isArray(
      value,
    )
  ) {
    return [];
  }

  return value.filter(
    (item): item is string =>
      typeof item ===
        "string",
  );
}

export async function verifyTurnstileToken(
  input: {
    token:
      string;

    idempotencyKey:
      string;
  },
): Promise<TurnstileVerificationResult> {
  const configuration =
    readTurnstileConfiguration();

  if (
    !configuration
  ) {
    return {
      status:
        "configuration_error",
    };
  }

  if (
    !input.token ||
    input.token.length >
      MAXIMUM_TURNSTILE_TOKEN_LENGTH
  ) {
    return {
      status:
        "invalid",

      errorCodes: [
        "invalid-input-response",
      ],
    };
  }

  const abortController =
    new AbortController();

  const timeout =
    setTimeout(
      () =>
        abortController.abort(),
      TURNSTILE_REQUEST_TIMEOUT_MS,
    );

  try {
    const response =
      await fetch(
        TURNSTILE_SITEVERIFY_URL,
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body:
            JSON.stringify({
              secret:
                configuration.secret,

              response:
                input.token,

              idempotency_key:
                input.idempotencyKey,
            }),

          cache:
            "no-store",

          signal:
            abortController.signal,
        },
      );

    if (
      !response.ok
    ) {
      return {
        status:
          "unavailable",
      };
    }

    let result:
      unknown;

    try {
      result =
        await response.json();
    } catch {
      return {
        status:
          "unavailable",
      };
    }

    if (
      typeof result !==
        "object" ||
      result ===
        null ||
      Array.isArray(
        result,
      )
    ) {
      return {
        status:
          "unavailable",
      };
    }

    const record =
      result as
        Record<
          string,
          unknown
        >;

    const errorCodes =
      getErrorCodes(
        record[
          "error-codes"
        ],
      );

    if (
      record.success !==
        true
    ) {
      return {
        status:
          "invalid",

        errorCodes,
      };
    }

    const hostname =
      typeof record.hostname ===
        "string"
        ? record.hostname
            .trim()
            .toLowerCase()
        : "";

    const action =
      typeof record.action ===
        "string"
        ? record.action.trim()
        : "";

    const hostnameMatches =
      configuration
        .allowedHostnames
        .has(
          hostname,
        );

    const actionMatches =
      configuration.testMode ||
      action ===
        configuration.expectedAction;

    if (
      !hostnameMatches ||
      !actionMatches
    ) {
      return {
        status:
          "invalid",

        errorCodes: [
          ...errorCodes,

          !hostnameMatches
            ? "unexpected-hostname"
            : "unexpected-action",
        ],
      };
    }

    return {
      status:
        "valid",
    };
  } catch {
    return {
      status:
        "unavailable",
    };
  } finally {
    clearTimeout(
      timeout,
    );
  }
}
