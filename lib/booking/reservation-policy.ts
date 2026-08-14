import type { ReservationStatus } from "@/lib/booking/reservation-state";

export type ReservationPolicyViolation =
  | "INITIAL_PAYMENT_REQUIRED_FOR_CONFIRMATION"
  | "INITIAL_PAYMENT_REQUIRED_FOR_CHECK_IN"
  | "RESOURCES_REQUIRED_FOR_CHECK_IN";

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

type ReservationTransitionPolicyInput = {
  targetStatus: ReservationStatus;

  paymentSummary: PaymentSummaryForPolicy;

  services: ReservationServiceForPolicy[];
};

export function getReservationTransitionPolicyViolation({
  targetStatus,
  paymentSummary,
  services,
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
