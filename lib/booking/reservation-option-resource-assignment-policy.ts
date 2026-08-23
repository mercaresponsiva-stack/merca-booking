import {
  resolveReservationOptionActiveQuantity,
} from "@/lib/booking/reservation-option-quantity";

export type ReservationOptionResourceAssignmentPolicyViolation =
  | "RESERVATION_OPTION_REQUIRED"
  | "RESERVATION_OPTION_NOT_VALID"
  | "RESERVATION_OPTION_NOT_ACTIVE"
  | "RESERVATION_OPTION_CONFIGURATION_REQUIRED"
  | "RESOURCE_NOT_ALLOWED_FOR_OPTION";

type ReservationOptionResourceRequirement = {
  resourceTypeId: string;
  requiredQuantity: number;
};

type ReservationOptionAssignedResource = {
  resource: {
    resourceTypeId: string | null;
  };
};

export type ReservationOptionForResourceAssignment = {
  id: string;

  includedQuantity: number;
  optionalQuantity: number;
  removedOptionalQuantity: number;

  serviceOption: {
    serviceId: string;

    resourceTypes:
      ReservationOptionResourceRequirement[];
  } | null;

  resources:
    ReservationOptionAssignedResource[];
};

type ResolveReservationOptionInput<
  T extends ReservationOptionForResourceAssignment,
> = {
  options: T[];

  resourceTypeId: string;

  requestedReservationOptionId:
    string | null;
};

type ResolveReservationOptionResult<
  T extends ReservationOptionForResourceAssignment,
> =
  | {
      ok: true;

      reservationOption: T;

      serviceId: string;

      activeQuantity: number;

      requiredQuantity: number;

      requiredResourceCount: number;
    }
  | {
      ok: false;

      violation:
        ReservationOptionResourceAssignmentPolicyViolation;
    };

function assertPositiveInteger(
  value: number,
  errorCode: string,
) {
  if (
    !Number.isInteger(
      value,
    ) ||
    value < 1
  ) {
    throw new Error(
      errorCode,
    );
  }
}

function multiplySafe(
  first: number,
  second: number,
) {
  const result =
    first *
    second;

  if (
    !Number.isSafeInteger(
      result,
    )
  ) {
    throw new Error(
      "OPTION_RESOURCE_REQUIREMENT_OVERFLOW",
    );
  }

  return result;
}

/*
 * Resuelve a qué ReservationOption debe
 * pertenecer un Resource físico.
 *
 * A diferencia de ReservationService,
 * reservationOptionId siempre es explícito.
 *
 * Una reserva puede contener varias líneas
 * del mismo complemento, especialmente
 * después de:
 *
 * - agregar
 * - retirar
 * - volver a agregar
 *
 * Por eso nunca inferimos automáticamente
 * la línea destinataria.
 */
export function resolveReservationOptionForResource<
  T extends ReservationOptionForResourceAssignment,
>({
  options,
  resourceTypeId,
  requestedReservationOptionId,
}: ResolveReservationOptionInput<T>): ResolveReservationOptionResult<T> {
  if (
    !requestedReservationOptionId
  ) {
    return {
      ok: false,

      violation:
        "RESERVATION_OPTION_REQUIRED",
    };
  }

  const reservationOption =
    options.find(
      (option) =>
        option.id ===
        requestedReservationOptionId,
    );

  if (
    !reservationOption
  ) {
    return {
      ok: false,

      violation:
        "RESERVATION_OPTION_NOT_VALID",
    };
  }

  const quantity =
    resolveReservationOptionActiveQuantity({
      includedQuantity:
        reservationOption
          .includedQuantity,

      optionalQuantity:
        reservationOption
          .optionalQuantity,

      removedOptionalQuantity:
        reservationOption
          .removedOptionalQuantity,
    });

  if (
    quantity.activeQuantity <
    1
  ) {
    return {
      ok: false,

      violation:
        "RESERVATION_OPTION_NOT_ACTIVE",
    };
  }

  const serviceOption =
    reservationOption
      .serviceOption;

  if (
    !serviceOption
  ) {
    return {
      ok: false,

      violation:
        "RESERVATION_OPTION_CONFIGURATION_REQUIRED",
    };
  }

  const requirement =
    serviceOption
      .resourceTypes
      .find(
        (item) =>
          item.resourceTypeId ===
          resourceTypeId,
      );

  if (
    !requirement
  ) {
    return {
      ok: false,

      violation:
        "RESOURCE_NOT_ALLOWED_FOR_OPTION",
    };
  }

  assertPositiveInteger(
    requirement.requiredQuantity,
    "INVALID_OPTION_RESOURCE_REQUIRED_QUANTITY",
  );

  const requiredResourceCount =
    multiplySafe(
      quantity.activeQuantity,
      requirement.requiredQuantity,
    );

  return {
    ok: true,

    reservationOption,

    serviceId:
      serviceOption.serviceId,

    activeQuantity:
      quantity.activeQuantity,

    requiredQuantity:
      requirement.requiredQuantity,

    requiredResourceCount,
  };
}

export function isReservationOptionResourceRequirementSatisfied(
  reservationOption:
    ReservationOptionForResourceAssignment,

  resourceTypeId: string,

  requiredResourceCount: number,
) {
  const assignedCount =
    reservationOption
      .resources
      .filter(
        (assignment) =>
          assignment
            .resource
            .resourceTypeId ===
          resourceTypeId,
      )
      .length;

  return (
    assignedCount >=
    requiredResourceCount
  );
}
