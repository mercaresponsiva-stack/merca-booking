import {
  resolveReservationOptionActiveQuantity,
} from "@/lib/booking/reservation-option-quantity";

import type { ReservationStatus } from "@/lib/booking/reservation-state";

export type ReservationPolicyViolation =
  | "INITIAL_PAYMENT_REQUIRED_FOR_CONFIRMATION"
  | "INITIAL_PAYMENT_REQUIRED_FOR_CHECK_IN"
  | "RESOURCES_REQUIRED_FOR_CHECK_IN"
  | "OPTION_RESOURCES_REQUIRED_FOR_CHECK_IN";

type PaymentSummaryForPolicy = {
  initialPaymentSatisfied: boolean;
};

type ReservationServiceForPolicy = {
  quantity: number;

  service: {
    resourceTypes: Array<{
      resourceTypeId: string;
      requiredQuantity: number;
    }>;
  };

  resources: Array<{
    resource: {
      resourceTypeId: string | null;
    };
  }>;
};

type ReservationOptionForPolicy = {
  includedQuantity: number;

  optionalQuantity: number;

  removedOptionalQuantity: number;

  serviceOption: {
    resourceTypes: Array<{
      resourceTypeId: string;
      requiredQuantity: number;
    }>;
  } | null;

  resources: Array<{
    resource: {
      resourceTypeId: string | null;
    };
  }>;
};

type ReservationTransitionPolicyInput = {
  targetStatus: ReservationStatus;

  paymentSummary: PaymentSummaryForPolicy;

  services: ReservationServiceForPolicy[];

  options: ReservationOptionForPolicy[];
};

export function getReservationTransitionPolicyViolation({
  targetStatus,
  paymentSummary,
  services,
  options,
}: ReservationTransitionPolicyInput): ReservationPolicyViolation | null {
  // ─────────────────────────────────────────────
  // CONFIRMATION
  // ─────────────────────────────────────────────

  if (targetStatus === "CONFIRMED" && !paymentSummary.initialPaymentSatisfied) {
    return "INITIAL_PAYMENT_REQUIRED_FOR_CONFIRMATION";
  }

  // ─────────────────────────────────────────────
  // CHECK-IN: PAYMENT
  // ─────────────────────────────────────────────

  if (
    targetStatus === "CHECKED_IN" &&
    !paymentSummary.initialPaymentSatisfied
  ) {
    return "INITIAL_PAYMENT_REQUIRED_FOR_CHECK_IN";
  }

  // ─────────────────────────────────────────────
  // CHECK-IN: PHYSICAL RESOURCES
  // ─────────────────────────────────────────────

  if (
    targetStatus === "CHECKED_IN" &&
    !hasRequiredResourcesAssigned(services)
  ) {
    return "RESOURCES_REQUIRED_FOR_CHECK_IN";
  }

  // ─────────────────────────────────────────────
  // CHECK-IN: OPTION PHYSICAL RESOURCES
  // ─────────────────────────────────────────────

  if (
    targetStatus === "CHECKED_IN" &&
    !hasRequiredReservationOptionResourcesAssigned(
      options,
    )
  ) {
    return "OPTION_RESOURCES_REQUIRED_FOR_CHECK_IN";
  }

  return null;
}

export function hasRequiredResourcesAssigned(
  services: ReservationServiceForPolicy[],
) {
  for (const reservationService of services) {
    for (const requirement of reservationService.service.resourceTypes) {
      const requiredQuantity = Math.max(1, requirement.requiredQuantity);

      const totalRequired = reservationService.quantity * requiredQuantity;

      const totalAssigned = reservationService.resources.filter(
        (assignment) =>
          assignment.resource.resourceTypeId === requirement.resourceTypeId,
      ).length;

      if (totalAssigned < totalRequired) {
        return false;
      }
    }
  }

  return true;
}
export function hasRequiredReservationOptionResourcesAssigned(
  options:
    ReservationOptionForPolicy[],
) {
  for (
    const reservationOption of
    options
  ) {
    const activeQuantity =
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

    /*
     * Una línea completamente retirada ya
     * no representa prestación ni demanda.
     */
    if (
      activeQuantity
        .activeQuantity ===
      0
    ) {
      continue;
    }

    /*
     * ReservationOption todavía no guarda
     * un snapshot propio de requisitos.
     *
     * Si ServiceOption ya no existe no
     * inventamos requisitos físicos. Las
     * configuraciones vigentes sí deben
     * satisfacerse por completo.
     */
    const requirements =
      reservationOption
        .serviceOption
        ?.resourceTypes ??
      [];

    for (
      const requirement of
      requirements
    ) {
      const requiredQuantity =
        Math.max(
          1,

          requirement
            .requiredQuantity,
        );

      const totalRequired =
        activeQuantity
          .activeQuantity *
        requiredQuantity;

      const totalAssigned =
        reservationOption
          .resources
          .filter(
            (
              assignment,
            ) =>
              assignment
                .resource
                .resourceTypeId ===
              requirement
                .resourceTypeId,
          )
          .length;

      if (
        totalAssigned <
        totalRequired
      ) {
        return false;
      }
    }
  }

  return true;
}
