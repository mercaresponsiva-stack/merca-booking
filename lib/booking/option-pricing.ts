export type OptionPricingBase =
  | "RESERVATION"
  | "QUANTITY"
  | "PERSON";

export type OptionPricingFrequency =
  | "ONCE"
  | "PER_NIGHT"
  | "PER_DAY"
  | "PER_HOUR";

export type CalculateOptionPriceInput = {
  includedQuantity: number;
  optionalQuantity: number;

  /*
   * string permite recibir directamente
   * Prisma Decimal.toString() sin convertir
   * primero a punto flotante.
   */
  unitPrice:
    number | string;

  pricingBase:
    OptionPricingBase;

  pricingFrequency:
    OptionPricingFrequency;

  /*
   * El Core no interpreta tiempo.
   *
   * Ejemplos:
   *
   * ONCE       -> 1
   * PER_NIGHT  -> 3
   * PER_DAY    -> 2
   * PER_HOUR   -> 0.333333...
   *
   * El Core lo normaliza a dos decimales
   * antes de calcular porque
   * ReservationOption.billingUnits
   * se persiste como Decimal(10, 2).
   */
  billingUnits?: number;
};

export type OptionPriceCalculation = {
  quantity: number;

  includedQuantity: number;
  optionalQuantity: number;

  chargeableUnits: number;

  unitPrice: number;

  pricingBase:
    OptionPricingBase;

  pricingFrequency:
    OptionPricingFrequency;

  /*
   * Valor ya normalizado a la misma
   * precisión que se persistirá.
   */
  billingUnits: number;

  subtotal: number;
};

function assertNonNegativeInteger(
  value: number,
  errorCode: string,
) {
  if (
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw new Error(
      errorCode,
    );
  }
}

function assertSafeInteger(
  value: number,
) {
  if (
    !Number.isSafeInteger(
      value,
    )
  ) {
    throw new Error(
      "OPTION_PRICE_OVERFLOW",
    );
  }

  return value;
}

/*
 * Convierte dinero a centavos.
 *
 * Para strings trabajamos directamente
 * sobre el decimal para evitar pasar
 * primero por Number.
 *
 * Decimal(10,2) entra con amplio margen
 * dentro de Number.MAX_SAFE_INTEGER.
 */
function moneyToCents(
  value:
    number | string,
): number {
  if (
    typeof value ===
    "number"
  ) {
    if (
      !Number.isFinite(
        value,
      ) ||
      value < 0
    ) {
      throw new Error(
        "INVALID_OPTION_UNIT_PRICE",
      );
    }

    return assertSafeInteger(
      Math.round(
        (
          value +
          Number.EPSILON
        ) *
          100,
      ),
    );
  }

  const normalized =
    value.trim();

  if (
    !/^\d+(?:\.\d+)?$/.test(
      normalized,
    )
  ) {
    throw new Error(
      "INVALID_OPTION_UNIT_PRICE",
    );
  }

  const [
    wholePart,
    fractionPart = "",
  ] =
    normalized.split(
      ".",
    );

  const whole =
    Number(
      wholePart,
    );

  if (
    !Number.isSafeInteger(
      whole,
    )
  ) {
    throw new Error(
      "OPTION_PRICE_OVERFLOW",
    );
  }

  /*
   * Necesitamos como mínimo tres
   * posiciones para poder aplicar
   * redondeo half-up al centavo.
   */
  const paddedFraction =
    fractionPart.padEnd(
      3,
      "0",
    );

  const firstTwoDecimals =
    Number(
      paddedFraction.slice(
        0,
        2,
      ),
    );

  let cents =
    whole *
      100 +
    firstTwoDecimals;

  /*
   * Tercer decimal >= 5:
   * redondeamos hacia arriba.
   */
  if (
    Number(
      paddedFraction[2] ??
        "0",
    ) >= 5
  ) {
    cents +=
      1;
  }

  return assertSafeInteger(
    cents,
  );
}

function centsToMoney(
  cents: number,
) {
  assertSafeInteger(
    cents,
  );

  return cents / 100;
}

/*
 * billingUnits se almacena como
 * Decimal(10,2).
 *
 * Primero obtenemos las centésimas que
 * realmente podemos persistir y solo
 * después calculamos el subtotal.
 */
function normalizeBillingUnitsToHundredths(
  value: number,
) {
  if (
    !Number.isFinite(
      value,
    ) ||
    value <= 0
  ) {
    throw new Error(
      "INVALID_OPTION_BILLING_UNITS",
    );
  }

  const hundredths =
    Math.round(
      (
        value +
        Number.EPSILON
      ) *
        100,
    );

  if (
    hundredths <= 0 ||
    !Number.isSafeInteger(
      hundredths,
    )
  ) {
    throw new Error(
      "INVALID_OPTION_BILLING_UNITS",
    );
  }

  return hundredths;
}

function multiplySafeIntegers(
  ...values: number[]
) {
  let result =
    1;

  for (
    const value of
    values
  ) {
    if (
      !Number.isSafeInteger(
        value,
      )
    ) {
      throw new Error(
        "OPTION_PRICE_OVERFLOW",
      );
    }

    result *=
      value;

    if (
      !Number.isSafeInteger(
        result,
      )
    ) {
      throw new Error(
        "OPTION_PRICE_OVERFLOW",
      );
    }
  }

  return result;
}

/*
 * Redondeo half-up de una fracción
 * formada exclusivamente por enteros.
 *
 * Ejemplo:
 *
 * 1999 centavos × 3 × 100
 * -----------------------
 *           100
 *
 * = 5997 centavos.
 */
function roundFractionToInteger(
  numerator: number,
  denominator: number,
) {
  if (
    !Number.isSafeInteger(
      numerator,
    ) ||
    !Number.isSafeInteger(
      denominator,
    ) ||
    denominator <= 0
  ) {
    throw new Error(
      "OPTION_PRICE_OVERFLOW",
    );
  }

  const quotient =
    Math.floor(
      numerator /
        denominator,
    );

  const remainder =
    numerator %
    denominator;

  const rounded =
    remainder *
      2 >=
    denominator
      ? quotient + 1
      : quotient;

  return assertSafeInteger(
    rounded,
  );
}

export function calculateOptionPrice({
  includedQuantity,
  optionalQuantity,

  unitPrice,

  pricingBase,
  pricingFrequency,

  billingUnits,
}: CalculateOptionPriceInput): OptionPriceCalculation {
  assertNonNegativeInteger(
    includedQuantity,
    "INVALID_INCLUDED_QUANTITY",
  );

  assertNonNegativeInteger(
    optionalQuantity,
    "INVALID_OPTIONAL_QUANTITY",
  );

  const quantity =
    includedQuantity +
    optionalQuantity;

  if (
    quantity <= 0
  ) {
    throw new Error(
      "OPTION_QUANTITY_REQUIRED",
    );
  }

  if (
    pricingBase !==
      "RESERVATION" &&
    pricingBase !==
      "QUANTITY" &&
    pricingBase !==
      "PERSON"
  ) {
    throw new Error(
      "INVALID_OPTION_PRICING_BASE",
    );
  }

  if (
    pricingFrequency !==
      "ONCE" &&
    pricingFrequency !==
      "PER_NIGHT" &&
    pricingFrequency !==
      "PER_DAY" &&
    pricingFrequency !==
      "PER_HOUR"
  ) {
    throw new Error(
      "INVALID_OPTION_PRICING_FREQUENCY",
    );
  }

  /*
   * Precio monetario exacto expresado
   * como centavos enteros.
   */
  const unitPriceCents =
    moneyToCents(
      unitPrice,
    );

  /*
   * ONCE siempre equivale a 1.00.
   *
   * Las demás frecuencias usan el valor
   * calculado por la vertical, pero ya
   * normalizado a la precisión de DB.
   */
  let billingUnitHundredths:
    number;

  if (
    pricingFrequency ===
    "ONCE"
  ) {
    billingUnitHundredths =
      100;
  } else {
    if (
      billingUnits ===
      undefined
    ) {
      throw new Error(
        "INVALID_OPTION_BILLING_UNITS",
      );
    }

    billingUnitHundredths =
      normalizeBillingUnitsToHundredths(
        billingUnits,
      );
  }

  /*
   * includedQuantity puede consumir
   * inventario, pero no genera cobro.
   */
  let chargeableUnits =
    0;

  if (
    optionalQuantity >
    0
  ) {
    switch (
      pricingBase
    ) {
      case "RESERVATION":
        chargeableUnits =
          1;

        break;

      case "QUANTITY":
      case "PERSON":
        chargeableUnits =
          optionalQuantity;

        break;
    }
  }

  /*
   * Todo el cálculo monetario se hace
   * con enteros:
   *
   * unitPriceCents
   * × chargeableUnits
   * × billingUnitHundredths
   * ÷ 100
   */
  const subtotalNumerator =
    multiplySafeIntegers(
      unitPriceCents,
      chargeableUnits,
      billingUnitHundredths,
    );

  const subtotalCents =
    roundFractionToInteger(
      subtotalNumerator,
      100,
    );

  return {
    quantity,

    includedQuantity,
    optionalQuantity,

    chargeableUnits,

    unitPrice:
      centsToMoney(
        unitPriceCents,
      ),

    pricingBase,
    pricingFrequency,

    billingUnits:
      billingUnitHundredths /
      100,

    subtotal:
      centsToMoney(
        subtotalCents,
      ),
  };
}
