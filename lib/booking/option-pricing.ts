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

  unitPrice: number;

  pricingBase: OptionPricingBase;
  pricingFrequency: OptionPricingFrequency;

  /*
   * El Core NO interpreta tiempo.
   *
   * Ejemplos:
   *
   * ONCE       -> 1
   * PER_NIGHT  -> Hotel puede enviar 3
   * PER_DAY    -> vertical puede enviar 2
   * PER_HOUR   -> vertical puede enviar 1.5
   */
  billingUnits?: number;
};

export type OptionPriceCalculation = {
  quantity: number;

  includedQuantity: number;
  optionalQuantity: number;

  /*
   * Unidades sobre las que realmente
   * se aplica unitPrice.
   *
   * RESERVATION:
   *   1 si existe parte opcional.
   *
   * QUANTITY:
   *   optionalQuantity.
   *
   * PERSON:
   *   optionalQuantity.
   */
  chargeableUnits: number;

  unitPrice: number;

  pricingBase: OptionPricingBase;
  pricingFrequency: OptionPricingFrequency;

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

function normalizeMoney(
  value: number,
) {
  /*
   * Mantiene por ahora precisión
   * monetaria de 2 decimales.
   *
   * Persistencia final seguirá usando
   * Prisma Decimal.
   */
  return Math.round(
    (value +
      Number.EPSILON) *
      100,
  ) / 100;
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
    !Number.isFinite(
      unitPrice,
    ) ||
    unitPrice < 0
  ) {
    throw new Error(
      "INVALID_OPTION_UNIT_PRICE",
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
   * ONCE siempre equivale a una sola
   * unidad temporal.
   *
   * El caller no necesita enviarla.
   */
  const effectiveBillingUnits =
    pricingFrequency ===
    "ONCE"
      ? 1
      : billingUnits;

  if (
    effectiveBillingUnits ===
      undefined ||
    !Number.isFinite(
      effectiveBillingUnits,
    ) ||
    effectiveBillingUnits <= 0
  ) {
    throw new Error(
      "INVALID_OPTION_BILLING_UNITS",
    );
  }

  /*
   * Solo optionalQuantity representa
   * unidades cobrables.
   *
   * includedQuantity sí forma parte de
   * quantity porque puede consumir
   * inventario físico, pero no genera
   * cargo.
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

  const subtotal =
    normalizeMoney(
      unitPrice *
        chargeableUnits *
        effectiveBillingUnits,
    );

  return {
    quantity,

    includedQuantity,
    optionalQuantity,

    chargeableUnits,

    unitPrice:
      normalizeMoney(
        unitPrice,
      ),

    pricingBase,
    pricingFrequency,

    billingUnits:
      effectiveBillingUnits,

    subtotal,
  };
}
