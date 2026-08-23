import {
  type OptionPricingBase,
  type OptionPricingFrequency,
} from "@/lib/booking/option-pricing";

import {
  resolveReservationOptionActiveQuantity,
  type ReservationOptionActiveQuantity,
} from "@/lib/booking/reservation-option-quantity";

import {
  resolveReservationOptionRemoval,
  type ReservationOptionRemovalResult,
} from "@/lib/booking/reservation-option-removal";

import {
  fromCents,
  toCents,
} from "@/lib/booking/money";

export type ReservationOptionGroupRemovalMember = {
  reservationOptionId: string;

  createdAt: Date;

  includedQuantity: number;

  optionalQuantity: number;

  removedOptionalQuantity: number;

  unitPrice:
    | number
    | string;

  pricingBase:
    OptionPricingBase;

  pricingFrequency:
    OptionPricingFrequency;

  billingUnits: number;

  currentSubtotal: number;
};

export type ReservationOptionGroupRemovalMemberResult = {
  reservationOptionId: string;

  createdAt: Date;

  removal:
    ReservationOptionRemovalResult;
};

export type ReservationOptionGroupRemovalResult = {
  removeOptionalQuantity: number;

  includedQuantity: number;

  originalOptionalQuantity: number;

  originalQuantity: number;

  removedOptionalQuantityBefore: number;
  removedOptionalQuantityAfter: number;

  activeOptionalQuantityBefore: number;
  activeOptionalQuantityAfter: number;

  activeQuantityBefore: number;
  activeQuantityAfter: number;

  oldSubtotal: number;
  newSubtotal: number;

  priceReduction: number;

  isFullyRemovedBefore: boolean;
  isFullyRemovedAfter: boolean;

  affectedReservationOptionIds:
    string[];

  affectedMembers:
    ReservationOptionGroupRemovalMemberResult[];
};

type NormalizedGroupMember = {
  member:
    ReservationOptionGroupRemovalMember;

  active:
    ReservationOptionActiveQuantity;

  currentSubtotalCents:
    number;
};

function assertPositiveInteger(
  value: number,
  errorCode: string,
) {
  if (
    !Number.isInteger(
      value,
    ) ||
    value <
      1
  ) {
    throw new Error(
      errorCode,
    );
  }
}

function addSafeInteger(
  first: number,
  second: number,
  errorCode: string,
) {
  const result =
    first +
    second;

  if (
    !Number.isSafeInteger(
      result,
    )
  ) {
    throw new Error(
      errorCode,
    );
  }

  return result;
}

function toSafeCents(
  value: number,
  errorCode: string,
) {
  if (
    !Number.isFinite(
      value,
    )
  ) {
    throw new Error(
      errorCode,
    );
  }

  const cents =
    toCents(
      value,
    );

  if (
    !Number.isSafeInteger(
      cents,
    ) ||
    cents <
      0
  ) {
    throw new Error(
      errorCode,
    );
  }

  return cents;
}

function compareNewestFirst(
  first:
    NormalizedGroupMember,

  second:
    NormalizedGroupMember,
) {
  const firstTime =
    first
      .member
      .createdAt
      .getTime();

  const secondTime =
    second
      .member
      .createdAt
      .getTime();

  if (
    firstTime !==
    secondTime
  ) {
    return firstTime >
      secondTime
      ? -1
      : 1;
  }

  return second
    .member
    .reservationOptionId
    .localeCompare(
      first
        .member
        .reservationOptionId,
    );
}

/*
 * Distribuye una reducción operacional
 * entre varias filas ReservationOption
 * pertenecientes al mismo grupo.
 *
 * Política:
 *
 * - conserva los snapshots históricos
 * - retira primero las compras más nuevas
 * - reutiliza la regla individual existente
 * - suma dinero exclusivamente en centavos
 * - no consulta Prisma
 * - no libera Resources
 * - no crea Refunds
 */
export function resolveReservationOptionGroupRemoval({
  members,

  removeOptionalQuantity,
}: {
  members:
    ReservationOptionGroupRemovalMember[];

  removeOptionalQuantity:
    number;
}): ReservationOptionGroupRemovalResult {
  assertPositiveInteger(
    removeOptionalQuantity,
    "INVALID_RESERVATION_OPTION_REMOVE_QUANTITY",
  );

  if (
    members.length ===
    0
  ) {
    throw new Error(
      "RESERVATION_OPTION_GROUP_MEMBERS_REQUIRED",
    );
  }

  const seenReservationOptionIds =
    new Set<string>();

  const normalizedMembers:
    NormalizedGroupMember[] =
    members.map(
      (
        member,
      ) => {
        const reservationOptionId =
          member
            .reservationOptionId
            .trim();

        if (
          !reservationOptionId
        ) {
          throw new Error(
            "RESERVATION_OPTION_GROUP_MEMBER_ID_REQUIRED",
          );
        }

        if (
          seenReservationOptionIds.has(
            reservationOptionId,
          )
        ) {
          throw new Error(
            "DUPLICATE_RESERVATION_OPTION_GROUP_MEMBER",
          );
        }

        seenReservationOptionIds.add(
          reservationOptionId,
        );

        if (
          Number.isNaN(
            member
              .createdAt
              .getTime(),
          )
        ) {
          throw new Error(
            "INVALID_RESERVATION_OPTION_GROUP_MEMBER_CREATED_AT",
          );
        }

        const active =
          resolveReservationOptionActiveQuantity({
            includedQuantity:
              member
                .includedQuantity,

            optionalQuantity:
              member
                .optionalQuantity,

            removedOptionalQuantity:
              member
                .removedOptionalQuantity,
          });

        const currentSubtotalCents =
          toSafeCents(
            member
              .currentSubtotal,

            "INVALID_RESERVATION_OPTION_GROUP_MEMBER_SUBTOTAL",
          );

        return {
          member: {
            ...member,

            reservationOptionId,
          },

          active,

          currentSubtotalCents,
        };
      },
    );

  let includedQuantity =
    0;

  let originalOptionalQuantity =
    0;

  let removedOptionalQuantityBefore =
    0;

  let activeOptionalQuantityBefore =
    0;

  let activeQuantityBefore =
    0;

  let oldSubtotalCents =
    0;

  for (
    const normalizedMember of
    normalizedMembers
  ) {
    includedQuantity =
      addSafeInteger(
        includedQuantity,

        normalizedMember
          .active
          .includedQuantity,

        "RESERVATION_OPTION_GROUP_QUANTITY_OVERFLOW",
      );

    originalOptionalQuantity =
      addSafeInteger(
        originalOptionalQuantity,

        normalizedMember
          .active
          .originalOptionalQuantity,

        "RESERVATION_OPTION_GROUP_QUANTITY_OVERFLOW",
      );

    removedOptionalQuantityBefore =
      addSafeInteger(
        removedOptionalQuantityBefore,

        normalizedMember
          .active
          .removedOptionalQuantity,

        "RESERVATION_OPTION_GROUP_QUANTITY_OVERFLOW",
      );

    activeOptionalQuantityBefore =
      addSafeInteger(
        activeOptionalQuantityBefore,

        normalizedMember
          .active
          .activeOptionalQuantity,

        "RESERVATION_OPTION_GROUP_QUANTITY_OVERFLOW",
      );

    activeQuantityBefore =
      addSafeInteger(
        activeQuantityBefore,

        normalizedMember
          .active
          .activeQuantity,

        "RESERVATION_OPTION_GROUP_QUANTITY_OVERFLOW",
      );

    oldSubtotalCents =
      addSafeInteger(
        oldSubtotalCents,

        normalizedMember
          .currentSubtotalCents,

        "RESERVATION_OPTION_GROUP_MONEY_OVERFLOW",
      );
  }

  if (
    activeOptionalQuantityBefore <
    1
  ) {
    throw new Error(
      "RESERVATION_OPTION_HAS_NO_ACTIVE_OPTIONAL_QUANTITY",
    );
  }

  if (
    removeOptionalQuantity >
    activeOptionalQuantityBefore
  ) {
    throw new Error(
      "RESERVATION_OPTION_REMOVE_QUANTITY_EXCEEDS_ACTIVE",
    );
  }

  const orderedMembers = [
    ...normalizedMembers,
  ].sort(
    compareNewestFirst,
  );

  const affectedMembers:
    ReservationOptionGroupRemovalMemberResult[] =
    [];

  let remainingQuantity =
    removeOptionalQuantity;

  let priceReductionCents =
    0;

  for (
    const normalizedMember of
    orderedMembers
  ) {
    if (
      remainingQuantity ===
      0
    ) {
      break;
    }

    const removableFromMember =
      Math.min(
        remainingQuantity,

        normalizedMember
          .active
          .activeOptionalQuantity,
      );

    if (
      removableFromMember <
      1
    ) {
      continue;
    }

    const removal =
      resolveReservationOptionRemoval({
        includedQuantity:
          normalizedMember
            .member
            .includedQuantity,

        optionalQuantity:
          normalizedMember
            .member
            .optionalQuantity,

        removedOptionalQuantity:
          normalizedMember
            .member
            .removedOptionalQuantity,

        removeOptionalQuantity:
          removableFromMember,

        unitPrice:
          normalizedMember
            .member
            .unitPrice,

        pricingBase:
          normalizedMember
            .member
            .pricingBase,

        pricingFrequency:
          normalizedMember
            .member
            .pricingFrequency,

        billingUnits:
          normalizedMember
            .member
            .billingUnits,

        currentSubtotal:
          normalizedMember
            .member
            .currentSubtotal,
      });

    affectedMembers.push({
      reservationOptionId:
        normalizedMember
          .member
          .reservationOptionId,

      createdAt:
        normalizedMember
          .member
          .createdAt,

      removal,
    });

    priceReductionCents =
      addSafeInteger(
        priceReductionCents,

        toSafeCents(
          removal
            .priceReduction,

          "INVALID_RESERVATION_OPTION_GROUP_PRICE_REDUCTION",
        ),

        "RESERVATION_OPTION_GROUP_MONEY_OVERFLOW",
      );

    remainingQuantity -=
      removableFromMember;
  }

  if (
    remainingQuantity !==
    0
  ) {
    throw new Error(
      "RESERVATION_OPTION_GROUP_REMOVAL_NOT_FULLY_ALLOCATED",
    );
  }

  const removedOptionalQuantityAfter =
    addSafeInteger(
      removedOptionalQuantityBefore,

      removeOptionalQuantity,

      "RESERVATION_OPTION_GROUP_QUANTITY_OVERFLOW",
    );

  const activeOptionalQuantityAfter =
    activeOptionalQuantityBefore -
    removeOptionalQuantity;

  const activeQuantityAfter =
    activeQuantityBefore -
    removeOptionalQuantity;

  const originalQuantity =
    addSafeInteger(
      includedQuantity,

      originalOptionalQuantity,

      "RESERVATION_OPTION_GROUP_QUANTITY_OVERFLOW",
    );

  const newSubtotalCents =
    oldSubtotalCents -
    priceReductionCents;

  if (
    newSubtotalCents <
    0
  ) {
    throw new Error(
      "RESERVATION_OPTION_GROUP_REMOVAL_EXCEEDS_SUBTOTAL",
    );
  }

  return {
    removeOptionalQuantity,

    includedQuantity,

    originalOptionalQuantity,

    originalQuantity,

    removedOptionalQuantityBefore,

    removedOptionalQuantityAfter,

    activeOptionalQuantityBefore,

    activeOptionalQuantityAfter,

    activeQuantityBefore,

    activeQuantityAfter,

    oldSubtotal:
      fromCents(
        oldSubtotalCents,
      ),

    newSubtotal:
      fromCents(
        newSubtotalCents,
      ),

    priceReduction:
      fromCents(
        priceReductionCents,
      ),

    isFullyRemovedBefore:
      activeQuantityBefore ===
      0,

    isFullyRemovedAfter:
      activeQuantityAfter ===
      0,

    affectedReservationOptionIds:
      affectedMembers.map(
        (
          member,
        ) =>
          member
            .reservationOptionId,
      ),

    affectedMembers,
  };
}