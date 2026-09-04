"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { zonedDateTimeToUtc } from "@/lib/booking/datetime";
import {
  getPaymentOptionLabel,
  isDepositPaymentOption,
  type PaymentOptionValue,
} from "@/lib/booking/payment-option";
import { isReservationCheckoutDue } from "@/lib/booking/reservation-checkout-timing";
import { isReservationCheckinDue } from "@/lib/booking/reservation-checkin-policy";
import { isReservationNoShowDue } from "@/lib/booking/reservation-no-show-policy";

type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: string;
};

type CancellationInitiator = "CUSTOMER" | "PROVIDER";

type CancellationResponse = {
  success: true;

  reservation: {
    id: string;
    confirmationCode: string;
    status: "CANCELLED";
  };

  cancellation: {
    id: string;
    type: string;
    reason: string | null;
    requestedAt: string;
    cancelledAt: string;

    createdBy: {
      id: string;
      name: string;
      email: string;
      role: string;
    } | null;

    refunds: Array<{
      id: string;
      paymentId: string;
      basis: string;

      baseAmount: number | string;

      contractElapsedDays: number;
      paymentElapsedDays: number;

      fullRefundDays: number;

      annualAdministrativeRate: number | string;

      maxAdministrativeRetention: number | string;

      administrativeRetention: number | string;

      amount: number | string;

      status: string;

      requestedAt: string;

      payment: {
        id: string;
        amount: number | string;
        method: string;
        paidAt: string | null;
      };
    }>;
  };
};

type Refund = {
  id: string;
  paymentId: string;
  cancellationId: string | null;
  reservationChangeId: string | null;
  basis: string;
  baseAmount: number;
  amount: number;
  status: string;
  reason: string | null;
  requestedAt: string;
  processedAt: string | null;
  externalReference: string | null;
  processedBy: AdminUser | null;
};

type RefundGroup = {
  key: string;

  basis: string;

  cancellationId: string | null;

  reservationChangeId: string | null;

  refunds: Refund[];

  amount: number;

  baseAmount: number;

  requestedAt: string;

  statuses: RefundAdminStatus[];

  displayStatus: RefundAdminStatus | "MIXED";
};

type RefundAdminStatus =
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

type RefundAdminTargetStatus =
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

type RefundAction = {
  status: RefundAdminTargetStatus;
  label: string;
};

function getRefundActions(status: RefundAdminStatus): RefundAction[] {
  switch (status) {
    case "PENDING":
      return [
        {
          status: "PROCESSING",
          label: "Iniciar procesamiento",
        },
        {
          status: "COMPLETED",
          label: "Completar devolución",
        },
        {
          status: "CANCELLED",
          label: "Cancelar reembolso",
        },
      ];

    case "PROCESSING":
      return [
        {
          status: "COMPLETED",
          label: "Completar devolución",
        },
        {
          status: "FAILED",
          label: "Marcar fallido",
        },
      ];

    case "FAILED":
      return [
        {
          status: "PROCESSING",
          label: "Reintentar",
        },
      ];

    case "COMPLETED":
    case "CANCELLED":
      return [];
  }
}

function getRefundGroupActionLabel(status: RefundAdminTargetStatus) {
  switch (status) {
    case "PROCESSING":
      return "Iniciar procesamiento";

    case "COMPLETED":
      return "Completar devolución";

    case "FAILED":
      return "Marcar fallido";

    case "CANCELLED":
      return "Cancelar reembolso";
  }
}

function getRefundGroupActions(group: RefundGroup): RefundAction[] {
  const candidates: RefundAdminTargetStatus[] = [
    "PROCESSING",
    "COMPLETED",
    "FAILED",
    "CANCELLED",
  ];

  return candidates
    .filter((targetStatus) =>
      group.refunds.every((refund) =>
        getRefundActions(refund.status as RefundAdminStatus).some(
          (action) => action.status === targetStatus,
        ),
      ),
    )
    .map((status) => ({
      status,
      label: getRefundGroupActionLabel(status),
    }));
}

function groupRefunds(refunds: Refund[]): RefundGroup[] {
  const groups = new Map<string, RefundGroup>();

  for (const refund of refunds) {
    const key = refund.cancellationId
      ? `cancellation:${refund.cancellationId}:${refund.basis}`
      : refund.reservationChangeId
        ? `change:${refund.reservationChangeId}:${refund.basis}`
        : `refund:${refund.id}`;

    const existing = groups.get(key);

    const status = refund.status as RefundAdminStatus;

    if (!existing) {
      groups.set(key, {
        key,

        basis: refund.basis,

        cancellationId: refund.cancellationId,

        reservationChangeId: refund.reservationChangeId,

        refunds: [refund],

        amount: refund.amount,

        baseAmount: refund.baseAmount,

        requestedAt: refund.requestedAt,

        statuses: [status],

        displayStatus: status,
      });

      continue;
    }

    existing.refunds.push(refund);

    existing.amount += refund.amount;

    existing.baseAmount += refund.baseAmount;

    existing.statuses.push(status);

    if (new Set(existing.statuses).size === 1) {
      existing.displayStatus = existing.statuses[0];
    } else {
      existing.displayStatus = "MIXED";
    }

    if (new Date(refund.requestedAt) > new Date(existing.requestedAt)) {
      existing.requestedAt = refund.requestedAt;
    }
  }

  return [...groups.values()].sort(
    (a, b) =>
      new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime(),
  );
}

type BusinessOptionsCatalogResponse = {
  success: true;

  items: Array<{
    id: string;
    name: string;
    description: string | null;
    isActive: boolean;

    services: Array<{
      id: string;

      isIncluded: boolean;
      isOptional: boolean;

      minOptionalQuantity: number;
      maxOptionalQuantity: number | null;

      price: number;

      pricingBase:
        | "RESERVATION"
        | "QUANTITY"
        | "PERSON";

      pricingFrequency:
        | "ONCE"
        | "PER_NIGHT"
        | "PER_DAY"
        | "PER_HOUR";

      availableAfterBooking: boolean;
      isActive: boolean;

      service: {
        id: string;
        name: string;
        slug: string;
        isActive: boolean;
      };

      resourceTypes: Array<{
        id: string;

        requiredQuantity: number;

        resourceType: {
          id: string;
          name: string;
          slug: string;
          activeResourceCount: number;
        };
      }>;
    }>;
  }>;
};

type PostBookingOptionChoice = {
  optionId: string;
  optionName: string;

  description: string | null;

  serviceOptionId: string;

  isIncluded: boolean;

  minOptionalQuantity: number;
  maxOptionalQuantity: number | null;

  price: number;

  pricingBase:
    | "RESERVATION"
    | "QUANTITY"
    | "PERSON";

  pricingFrequency:
    | "ONCE"
    | "PER_NIGHT"
    | "PER_DAY"
    | "PER_HOUR";

  resourceTypes: Array<{
    resourceTypeId: string;

    name: string;

    requiredQuantity: number;

    activeResourceCount: number;
  }>;
};

function localBusinessDateTimeToIso(
  value: string,
  timezone: string,
) {
  const match =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(
      value,
    );

  if (!match) {
    throw new Error(
      "La fecha y hora del complemento no es válida.",
    );
  }

  return zonedDateTimeToUtc(
    match[1],
    match[2],
    timezone,
  ).toISOString();
}

type ReservationDetailResponse = {
  success: true;

  reservation: {
    id: string;
    confirmationCode: string;
    status: string;
    source: string | null;
    startAt: string;
    endAt: string;
    expiresAt: string | null;
    guests: number;
    adults: number | null;
    children: number | null;
    subtotal: number;
    total: number;
    paymentOption: PaymentOptionValue;
    retractoEligible: boolean;
    specialRequests: string | null;
    createdAt: string;
    updatedAt: string;
  };

  business: {
    id: string;
    name: string;
    slug: string;
    currency: string;
    timezone: string;
    checkInTime: string | null;
    checkOutTime: string | null;

    type: {
      id: string;
      name: string;
      slug: string;
    };
  };

  customer: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    createdAt: string;
    updatedAt: string;
  };

  services: Array<{
    id: string;
    serviceId: string;
    name: string;
    slug: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;

    resources: Array<{
      assignmentId: string;
      resourceId: string;
      name: string;
      code: string | null;
      floor: string | null;

      resourceType: {
        id: string;
        name: string;
      } | null;

      createdAt: string;
    }>;
  }>;

  options: Array<{
    id: string;

    reservationServiceId: string | null;

    optionId: string | null;

    serviceOptionId: string | null;

    operationalGroupKey: string;

    name: string;

    description: string | null;

    quantity: number;

    includedQuantity: number;

    optionalQuantity: number;
    removedOptionalQuantity: number;

    activeOptionalQuantity: number;

    activeQuantity: number;

    isFullyRemoved: boolean;

    unitPrice: number;

    pricingBase:
      | "RESERVATION"
      | "QUANTITY"
      | "PERSON";

    pricingFrequency:
      | "ONCE"
      | "PER_NIGHT"
      | "PER_DAY"
      | "PER_HOUR";

    billingUnits: number;

    subtotal: number;

    startAt: string | null;

    endAt: string | null;

    resources: Array<{
      assignmentId: string;

      resourceId: string;

      name: string;

      code: string | null;

      floor: string | null;

      resourceType: {
        id: string;

        name: string;

        slug: string;
      } | null;

      createdAt: string;
    }>;

    createdAt: string;

    updatedAt: string;
  }>;
  paymentSummary: {
    total: number;
    paid: number;
    grossPaid: number;
    pending: number;
    refundPending: number;
    refunded: number;
    netPaid: number;
    balance: number;
    isPaid: boolean;
    paymentOption: PaymentOptionValue;
    requiredInitialPayment: number | null;
    initialPaymentRemaining: number | null;
    initialPaymentSatisfied: boolean;
    balanceDueAt: string | null;
  };

  financialState: {
    contractualBalance: number;
    amountDue: number;
    paymentAcceptanceAllowedByStatus: boolean;
    canAcceptPayment: boolean;
    hasRefundPending: boolean;
    isCancelled: boolean;
  };

  payments: Array<{
    id: string;
    amount: number;
    method: string;
    status: string;
    externalReference: string | null;
    paymentUrl: string | null;
    proofUrl: string | null;
    verifiedAt: string | null;
    verifiedBy: AdminUser | null;
    paidAt: string | null;
    createdAt: string;
    updatedAt: string;

    refunds: Array<{
      id: string;
      basis: string;
      baseAmount: number;
      amount: number;
      status: string;
      requestedAt: string;
      processedAt: string | null;
      externalReference: string | null;
      processedBy: AdminUser | null;
    }>;
  }>;

  refunds: Refund[];

  cancellation: {
    id: string;
    type: string;
    reason: string | null;
    requestedAt: string;
    cancelledAt: string;
    createdBy: AdminUser | null;
  } | null;

  changes: Array<{
    id: string;
    type: string;
    reason: string | null;
    oldStartAt: string | null;
    newStartAt: string | null;
    oldEndAt: string | null;
    newEndAt: string | null;
    oldSubtotal: number | null;
    newSubtotal: number | null;
    oldTotal: number | null;
    newTotal: number | null;
    oldStatus: string | null;
    newStatus: string | null;
    changedBy: AdminUser | null;
    createdAt: string;

    refunds: Array<{
      id: string;
      basis: string;
      amount: number;
      status: string;
    }>;
  }>;
};

type RescheduleResponse = {
  success: true;

  reservation: {
    id: string;
    confirmationCode: string;
    status: string;
    startAt: string;
    endAt: string;
    subtotal: number;
    total: number;
    paymentOption: PaymentOptionValue;
  };

  pricing: {
    nights: number;
    nightlyPrices: unknown[];
    total: number;
  };

  change: {
    id: string;
    type: string;
    oldStartAt: string | null;
    newStartAt: string | null;
    oldEndAt: string | null;
    newEndAt: string | null;
    oldTotal: number | null;
    newTotal: number | null;
    oldStatus: string | null;
    newStatus: string | null;
    reason: string | null;
    createdAt: string;
  };

  resources: {
    kept: Array<{
      assignmentId: string;
      resourceId: string;
      serviceId: string;
      resourceTypeId: string | null;
    }>;

    released: Array<{
      assignmentId: string;
      resourceId: string;
      serviceId: string;
      resourceTypeId: string | null;
      reason: string;
    }>;
  };

  financialImpact: {
    priceDifference: number;
    netPaid: number;
    balance: number;
    overpayment: number;
    initialPaymentShortfall: number;
    nextStatus: string;
  };

  paymentSummary: {
    total: number;
    paid: number;
    grossPaid: number;
    pending: number;
    refundPending: number;
    refunded: number;
    netPaid: number;
    balance: number;
    isPaid: boolean;
    initialPaymentRemaining: number | null;
    initialPaymentSatisfied: boolean;
  };

  financialState: {
    contractualBalance: number;
    amountDue: number;
    canAcceptPayment: boolean;
    hasRefundPending: boolean;
    isCancelled: boolean;
  };

  refunds: Array<{
    id: string;
    paymentId: string;
    basis: string;
    baseAmount: number;
    amount: number;
    status: string;
    reservationChangeId: string | null;
  }>;
};

type StayExtensionResponse = {
  success: true;

  reservation: {
    id: string;
    confirmationCode: string;
    status: string;
    startAt: string;
    endAt: string;
    subtotal: number;
    total: number;
    paymentOption: PaymentOptionValue;
  };

  pricing: {
    previousNights: number;
    additionalNights: number;
    nights: number;

    additionalServiceSubtotal: number;
    additionalOptionSubtotal: number;
    additionalCharge: number;

    newServiceSubtotal: number;
    newOptionSubtotal: number;
    newTotal: number;
  };

  resources: {
    kept: unknown[];
    unavailable: unknown[];
  };

  paymentSummary: {
    balance: number;
  };
};

type CheckoutResponse = {
  success: true;

  reservation: {
    id: string;
    confirmationCode: string;
    status: string;
    startAt: string;
    endAt: string;
    subtotal: number;
    total: number;
    paymentOption: PaymentOptionValue;
  };

  actor: {
    id: string;
    name: string;
    role: string;
  };

  checkout: {
    timing:
      | "EARLY"
      | "ON_TIME"
      | "LATE";

    scheduledEndAt: string;
    checkedOutAt: string;

    earlyCheckout: boolean;
    hasRefundPending: boolean;
  };

  change: {
    id: string;
    type: string;
    changedById: string | null;
    reason: string | null;
    createdAt: string;
  };

  resources: {
    retained: Array<{
      id: string;
      reservationServiceId: string | null;
      reservationOptionId: string | null;
      resourceId: string;
    }>;

    assignmentCount: number;
    inventoryReleasedByStatus: boolean;
  };

  paymentSummary: {
    total: number;
    pending: number;
    refundPending: number;
    netPaid: number;
    balance: number;
  };

  financialState: {
    contractualBalance: number;
    amountDue: number;
    paymentAcceptanceAllowedByStatus: boolean;
    canAcceptPayment: boolean;
    hasRefundPending: boolean;
    isCancelled: boolean;
  };
};

type ConfirmationResponse = {
  success: true;

  reservation:
    CheckoutResponse[
      "reservation"
    ];

  actor:
    CheckoutResponse[
      "actor"
    ];

  confirmation: {
    confirmedAt: string;

    initialPaymentSatisfied:
      boolean;

    requiredInitialPayment:
      number | null;

    initialPaymentRemaining:
      number | null;

    remainingBalance:
      number;
  };

  change:
    CheckoutResponse[
      "change"
    ];

  resources: {
    retained: Array<{
      id: string;

      reservationServiceId:
        string | null;

      reservationOptionId:
        string | null;

      resourceId:
        string;
    }>;

    assignmentCount:
      number;

    assignmentsRetained:
      boolean;

    inventoryContinuesByStatus:
      boolean;
  };

  paymentSummary:
    CheckoutResponse[
      "paymentSummary"
    ];

  financialState:
    CheckoutResponse[
      "financialState"
    ];
};

type CheckinResponse = {
  success: true;

  reservation:
    CheckoutResponse[
      "reservation"
    ];

  actor:
    CheckoutResponse[
      "actor"
    ];

  checkin: {
    timing:
      | "EARLY"
      | "ON_TIME"
      | "LATE";

    scheduledStartAt: string;
    scheduledEndAt: string;
    checkedInAt: string;

    earlyCheckin: boolean;
  };

  change:
    CheckoutResponse[
      "change"
    ];

  resources: {
    retained: Array<{
      id: string;
      reservationServiceId: string | null;
      reservationOptionId: string | null;
      resourceId: string;
    }>;

    assignmentCount: number;
    integrityValidated: boolean;
    validationStartAt: string;
    validationEndAt: string;
    earlyIntervalExpanded: boolean;
  };

  paymentSummary:
    CheckoutResponse[
      "paymentSummary"
    ];

  financialState:
    CheckoutResponse[
      "financialState"
    ];
};

type NoShowResponse = {
  success: true;

  reservation:
    CheckoutResponse[
      "reservation"
    ];

  actor:
    CheckoutResponse[
      "actor"
    ];

  noShow: {
    vertical: string;
    scheduledStartAt: string;
    scheduledEndAt: string;
    markedNoShowAt: string;
    pendingPaymentsResolved: boolean;
  };

  change:
    CheckoutResponse[
      "change"
    ];

  resources:
    CheckoutResponse[
      "resources"
    ];

  paymentSummary:
    CheckoutResponse[
      "paymentSummary"
    ];

  financialState:
    CheckoutResponse[
      "financialState"
    ];
};

type CompletionResponse = {
  success: true;

  reservation:
    CheckoutResponse[
      "reservation"
    ];

  actor:
    CheckoutResponse[
      "actor"
    ];

  completion: {
    completedAt: string;
    financiallySettled: boolean;
  };

  change:
    CheckoutResponse[
      "change"
    ];

  resources:
    CheckoutResponse[
      "resources"
    ];

  paymentSummary:
    CheckoutResponse[
      "paymentSummary"
    ];

  financialState:
    CheckoutResponse[
      "financialState"
    ];
};

type RegisterablePaymentMethod = "BANK_TRANSFER" | "CASH";

type PaymentTargetStatus = "PAID" | "FAILED";

import { DEV_RECEPTION_USER_ID as TEMP_RECEPTION_USER_ID } from "@/lib/config/dev-context";

type ReservationDetailOption =
  ReservationDetailResponse[
    "options"
  ][number];

type ReservationDetailOptionGroup =
  ReservationDetailOption & {
    /*
     * ID estable utilizado como representante
     * del grupo frente al endpoint.
     */
    reservationOptionIds:
      string[];

    memberCount: number;

    /*
     * Si los snapshots de precio difieren,
     * mostramos únicamente el subtotal
     * acumulado y no un unitPrice engañoso.
     */
    hasMixedPricing:
      boolean;
  };

function getReservationOptionGroups(
  options:
    ReservationDetailOption[],
): ReservationDetailOptionGroup[] {
  const optionsByGroup =
    new Map<
      string,
      ReservationDetailOption[]
    >();

  for (
    const option of options
  ) {
    const current =
      optionsByGroup.get(
        option
          .operationalGroupKey,
      ) ?? [];

    current.push(
      option,
    );

    optionsByGroup.set(
      option
        .operationalGroupKey,

      current,
    );
  }

  const groups:
    ReservationDetailOptionGroup[] =
    [];

  for (
    const members of
    optionsByGroup.values()
  ) {
    const sortedMembers = [
      ...members,
    ].sort(
      (
        first,
        second,
      ) => {
        const createdAtComparison =
          first
            .createdAt
            .localeCompare(
              second
                .createdAt,
            );

        if (
          createdAtComparison !==
          0
        ) {
          return createdAtComparison;
        }

        return first.id.localeCompare(
          second.id,
        );
      },
    );

    const firstMember =
      sortedMembers[0];

    if (
      !firstMember
    ) {
      continue;
    }

    const quantity =
      sortedMembers.reduce(
        (
          total,
          option,
        ) =>
          total +
          option.quantity,

        0,
      );

    const includedQuantity =
      sortedMembers.reduce(
        (
          total,
          option,
        ) =>
          total +
          option
            .includedQuantity,

        0,
      );

    const optionalQuantity =
      sortedMembers.reduce(
        (
          total,
          option,
        ) =>
          total +
          option
            .optionalQuantity,

        0,
      );

    const removedOptionalQuantity =
      sortedMembers.reduce(
        (
          total,
          option,
        ) =>
          total +
          option
            .removedOptionalQuantity,

        0,
      );

    const activeOptionalQuantity =
      sortedMembers.reduce(
        (
          total,
          option,
        ) =>
          total +
          option
            .activeOptionalQuantity,

        0,
      );

    const activeQuantity =
      sortedMembers.reduce(
        (
          total,
          option,
        ) =>
          total +
          option
            .activeQuantity,

        0,
      );

    /*
     * Sumamos dinero en centavos para no
     * introducir errores binarios visibles.
     */
    const subtotalCents =
      sortedMembers.reduce(
        (
          total,
          option,
        ) =>
          total +
          Math.round(
            option.subtotal *
              100,
          ),

        0,
      );

    const pricingSignatures =
      new Set(
        sortedMembers.map(
          (
            option,
          ) =>
            JSON.stringify([
              Math.round(
                option.unitPrice *
                  100,
              ),

              option
                .pricingBase,

              option
                .pricingFrequency,

              Math.round(
                option.billingUnits *
                  100,
              ),
            ]),
        ),
      );

    const resourcesById =
      new Map<
        string,
        ReservationDetailOption[
          "resources"
        ][number]
      >();

    for (
      const option of
      sortedMembers
    ) {
      for (
        const resource of
        option.resources
      ) {
        if (
          !resourcesById.has(
            resource.resourceId,
          )
        ) {
          resourcesById.set(
            resource.resourceId,
            resource,
          );
        }
      }
    }

    const resources = [
      ...resourcesById.values(),
    ].sort(
      (
        first,
        second,
      ) => {
        const createdAtComparison =
          first
            .createdAt
            .localeCompare(
              second
                .createdAt,
            );

        if (
          createdAtComparison !==
          0
        ) {
          return createdAtComparison;
        }

        return first
          .assignmentId
          .localeCompare(
            second
              .assignmentId,
          );
      },
    );

    const updatedAt =
      sortedMembers.reduce(
        (
          latest,
          option,
        ) =>
          option.updatedAt >
          latest
            ? option.updatedAt
            : latest,

        firstMember
          .updatedAt,
      );

    groups.push({
      ...firstMember,

      /*
       * El miembro más antiguo es un
       * representante estable. El endpoint
       * resolverá el grupo completo.
       */
      id:
        firstMember.id,

      reservationOptionIds:
        sortedMembers.map(
          (
            option,
          ) =>
            option.id,
        ),

      memberCount:
        sortedMembers.length,

      quantity,

      includedQuantity,

      optionalQuantity,

      removedOptionalQuantity,

      activeOptionalQuantity,

      activeQuantity,

      isFullyRemoved:
        activeQuantity ===
        0,

      subtotal:
        subtotalCents /
        100,

      resources,

      hasMixedPricing:
        pricingSignatures.size >
        1,

      updatedAt,
    });
  }

  return groups;
}

type ResourceAvailability =
  | "AVAILABLE"
  | "ASSIGNED"
  | "OCCUPIED"
  | "BLOCKED"
  | "UNAVAILABLE";

type ReservationResourceCandidate = {
  id: string;
  name: string;
  code: string | null;
  floor: number | null;
  capacity: number;
  resourceTypeId: string | null;
  assignmentId: string | null;
  assignedToReservation: boolean;
  available: boolean;
  availability: ResourceAvailability;
  unavailableReason: string | null;
};

type ResourceRequirementBase = {
  serviceId: string;

  service: {
    id: string;
    name: string;
    slug: string;
  };

  resourceType: {
    id: string;
    name: string;
    slug: string;
  };

  requiredQuantity: number;
  assignedQuantity: number;
  remainingQuantity: number;
  satisfied: boolean;

  resources:
    ReservationResourceCandidate[];
};

type ServiceResourceRequirement =
  ResourceRequirementBase & {
    source: "SERVICE";

    reservationServiceId: string;
  };

type OptionResourceRequirementShared = {
  source: "OPTION";

  reservationServiceId:
    string | null;

  operationalGroupKey: string;

  requirementGroupKey: string;

  option: {
    id: string;
    name: string;
    description: string | null;
  };

  activeQuantity: number;

  requiredQuantityPerUnit:
    number;

  effectiveStartAt: string;
  effectiveEndAt: string;

  usesReservationInterval:
    boolean;
};

type RawOptionResourceRequirement =
  ResourceRequirementBase &
    OptionResourceRequirementShared & {
      reservationOptionId:
        string;

      createdAt: string;
    };

type OptionResourceRequirement =
  ResourceRequirementBase &
    OptionResourceRequirementShared & {
      reservationOptionIds:
        string[];

      /*
       * Línea histórica concreta que todavía
       * necesita recibir el siguiente recurso.
       *
       * Aunque la UI agrupe varias compras,
       * ReservationResource conserva siempre
       * un propietario ReservationOption real.
       */
      assignmentTargetReservationOptionId:
        string | null;
    };

type ResourceRequirement =
  | ServiceResourceRequirement
  | OptionResourceRequirement;

type ReservationResourcesResponse = {
  success: true;

  reservation: {
    id: string;
    confirmationCode: string;
    status: string;
    startAt: string;
    endAt: string;
  };

  requirements:
    ServiceResourceRequirement[];

  optionRequirements:
    RawOptionResourceRequirement[];
};

type ReservationOperationalStatus =
  | "PENDING"
  | "CONFIRMED"
  | "CANCELLED"
  | "NO_SHOW"
  | "CHECKED_IN"
  | "CHECKED_OUT"
  | "COMPLETED"
  | "EXPIRED";

const RESERVATION_OPERATIONAL_STATUSES: readonly ReservationOperationalStatus[] = [
  "PENDING",
  "CONFIRMED",
  "CANCELLED",
  "NO_SHOW",
  "CHECKED_IN",
  "CHECKED_OUT",
  "COMPLETED",
  "EXPIRED",
];

function isOperationalStatus(
  value: string,
): value is ReservationOperationalStatus {
  return RESERVATION_OPERATIONAL_STATUSES.includes(
    value as ReservationOperationalStatus,
  );
}
function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("es-SV", {
    style: "currency",
    currency,
  }).format(amount);
}

function getDateOnlyInTimezone(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));

  const year = parts.find((part) => part.type === "year")?.value ?? "";

  const month = parts.find((part) => part.type === "month")?.value ?? "";

  const day = parts.find((part) => part.type === "day")?.value ?? "";

  return `${year}-${month}-${day}`;
}

function addDateOnlyDays(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);

  const date = new Date(
    Date.UTC(
      year,
      month - 1,
      day + days,
    ),
  );

  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}
function formatDate(value: string, timezone: string) {
  return new Intl.DateTimeFormat("es-SV", {
    timeZone: timezone,
    year: "numeric",
    month: "long",
    day: "2-digit",
  }).format(new Date(value));
}

function formatDateTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("es-SV", {
    timeZone: timezone,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function getStatusLabel(status: string) {
  switch (status) {
    case "PENDING":
      return "Pendiente";

    case "CONFIRMED":
      return "Confirmada";

    case "CANCELLED":
      return "Cancelada";

    case "NO_SHOW":
      return "No se presentó";

    case "CHECKED_IN":
      return "Check-in";

    case "CHECKED_OUT":
      return "Check-out";

    case "COMPLETED":
      return "Completada";

    case "EXPIRED":
      return "Vencida";

    case "PAID":
      return "Pagado";

    case "PROCESSING":
      return "Procesando";

    case "FAILED":
      return "Fallido";

    default:
      return status.replaceAll("_", " ");
  }
}

function getReservationChangeTypeLabel(type: string) {
  switch (type) {
    case "RESCHEDULE":
      return "Reprogramación";

    case "RESOURCE_CHANGE":
      return "Cambio de recurso";

    case "PRICE_ADJUSTMENT":
      return "Ajuste de precio";

    case "OPTION_ADDED":
      return "Complemento agregado";

    case "OPTION_REMOVED":
      return "Complemento retirado";

    case "STAY_EXTENSION":
      return "Extensión de estancia";

    case "CONFIRMATION":
      return "Confirmación";

    case "CHECK_IN":
      return "Check-in";

    case "NO_SHOW":
      return "No se presentó";

    case "CHECK_OUT":
      return "Check-out";

    case "COMPLETION":
      return "Cierre administrativo";

    case "EXPIRATION":
      return "Vencimiento automático";

    case "MANUAL":
      return "Cambio manual";

    default:
      return type.replaceAll("_", " ");
  }
}
function getResourceAvailabilityLabel(availability: ResourceAvailability) {
  switch (availability) {
    case "AVAILABLE":
      return "Disponible";

    case "ASSIGNED":
      return "Asignado";

    case "OCCUPIED":
      return "Ocupado";

    case "BLOCKED":
      return "Bloqueado";

    case "UNAVAILABLE":
      return "No disponible";
  }
}

function compareRawOptionResourceRequirements(
  first:
    RawOptionResourceRequirement,

  second:
    RawOptionResourceRequirement,
) {
  const createdAtComparison =
    first.createdAt.localeCompare(
      second.createdAt,
    );

  if (
    createdAtComparison !==
    0
  ) {
    return createdAtComparison;
  }

  return first
    .reservationOptionId
    .localeCompare(
      second
        .reservationOptionId,
    );
}

function mergeOptionResourceCandidates(
  requirements:
    RawOptionResourceRequirement[],
) {
  const candidatesByResourceId =
    new Map<
      string,
      ReservationResourceCandidate[]
    >();

  for (
    const requirement of
    requirements
  ) {
    for (
      const resource of
      requirement.resources
    ) {
      const current =
        candidatesByResourceId.get(
          resource.id,
        ) ?? [];

      current.push(
        resource,
      );

      candidatesByResourceId.set(
        resource.id,
        current,
      );
    }
  }

  const mergedResources:
    ReservationResourceCandidate[] =
    [];

  for (
    const candidates of
    candidatesByResourceId.values()
  ) {
    /*
     * Si el Resource pertenece a cualquiera
     * de las líneas del grupo, en la vista
     * agrupada aparece una sola vez como
     * asignado.
     */
    const assignedCandidate =
      candidates.find(
        (candidate) =>
          candidate
            .assignedToReservation,
      );

    if (
      assignedCandidate
    ) {
      mergedResources.push({
        ...assignedCandidate,

        assignedToReservation:
          true,

        available:
          false,

        availability:
          "ASSIGNED",

        unavailableReason:
          null,
      });

      continue;
    }

    /*
     * Basta que una evaluación válida del
     * mismo grupo lo considere disponible.
     */
    const availableCandidate =
      candidates.find(
        (candidate) =>
          candidate.available,
      );

    if (
      availableCandidate
    ) {
      mergedResources.push({
        ...availableCandidate,

        assignmentId:
          null,

        assignedToReservation:
          false,

        available:
          true,

        availability:
          "AVAILABLE",

        unavailableReason:
          null,
      });

      continue;
    }

    const unavailableCandidate =
      candidates.find(
        (candidate) =>
          candidate.availability ===
          "OCCUPIED",
      ) ??
      candidates.find(
        (candidate) =>
          candidate.availability ===
          "BLOCKED",
      ) ??
      candidates.find(
        (candidate) =>
          candidate.availability ===
          "UNAVAILABLE",
      ) ??
      candidates[0];

    if (
      !unavailableCandidate
    ) {
      continue;
    }

    mergedResources.push({
      ...unavailableCandidate,

      assignmentId:
        null,

      assignedToReservation:
        false,

      available:
        false,

      availability:
        unavailableCandidate
          .availability ===
        "ASSIGNED"
          ? "UNAVAILABLE"
          : unavailableCandidate
              .availability,
    });
  }

  return mergedResources;
}

function aggregateOptionResourceRequirements(
  requirements:
    RawOptionResourceRequirement[],
): OptionResourceRequirement[] {
  const requirementsByGroup =
    new Map<
      string,
      RawOptionResourceRequirement[]
    >();

  for (
    const requirement of
    requirements
  ) {
    const current =
      requirementsByGroup.get(
        requirement
          .requirementGroupKey,
      ) ?? [];

    current.push(
      requirement,
    );

    requirementsByGroup.set(
      requirement
        .requirementGroupKey,

      current,
    );
  }

  const groupedRequirements:
    OptionResourceRequirement[] =
    [];

  for (
    const groupRequirements of
    requirementsByGroup.values()
  ) {
    const sortedRequirements = [
      ...groupRequirements,
    ].sort(
      compareRawOptionResourceRequirements,
    );

    const firstRequirement =
      sortedRequirements[0];

    if (
      !firstRequirement
    ) {
      continue;
    }

    const activeQuantity =
      sortedRequirements.reduce(
        (
          total,
          requirement,
        ) =>
          total +
          requirement
            .activeQuantity,

        0,
      );

    const requiredQuantity =
      sortedRequirements.reduce(
        (
          total,
          requirement,
        ) =>
          total +
          requirement
            .requiredQuantity,

        0,
      );

    const assignedQuantity =
      sortedRequirements.reduce(
        (
          total,
          requirement,
        ) =>
          total +
          requirement
            .assignedQuantity,

        0,
      );

    const remainingQuantity =
      Math.max(
        requiredQuantity -
          assignedQuantity,

        0,
      );

    const satisfied =
      remainingQuantity ===
      0;

    /*
     * Las líneas más antiguas se completan
     * primero. Cuando aumenta la cantidad
     * del mismo complemento, la primera
     * línea todavía incompleta vuelve a
     * habilitar la asignación.
     */
    const assignmentTarget =
      satisfied
        ? null
        : sortedRequirements.find(
            (requirement) =>
              requirement
                .remainingQuantity >
              0,
          ) ??
          null;

    groupedRequirements.push({
      source:
        "OPTION",

      reservationServiceId:
        firstRequirement
          .reservationServiceId,

      operationalGroupKey:
        firstRequirement
          .operationalGroupKey,

      requirementGroupKey:
        firstRequirement
          .requirementGroupKey,

      reservationOptionIds:
        sortedRequirements.map(
          (requirement) =>
            requirement
              .reservationOptionId,
        ),

      assignmentTargetReservationOptionId:
        assignmentTarget
          ?.reservationOptionId ??
        null,

      serviceId:
        firstRequirement
          .serviceId,

      service:
        firstRequirement
          .service,

      resourceType:
        firstRequirement
          .resourceType,

      option:
        firstRequirement
          .option,

      activeQuantity,

      requiredQuantityPerUnit:
        firstRequirement
          .requiredQuantityPerUnit,

      effectiveStartAt:
        firstRequirement
          .effectiveStartAt,

      effectiveEndAt:
        firstRequirement
          .effectiveEndAt,

      usesReservationInterval:
        firstRequirement
          .usesReservationInterval,

      requiredQuantity,

      assignedQuantity,

      remainingQuantity,

      satisfied,

      resources:
        mergeOptionResourceCandidates(
          sortedRequirements,
        ),
    });
  }

  return groupedRequirements;
}

function getResourceRequirementKey(
  requirement:
    ResourceRequirement,
) {
  if (
    requirement.source ===
    "OPTION"
  ) {
    return (
      "OPTION:" +
      requirement
        .requirementGroupKey
    );
  }

  return `SERVICE:${requirement.reservationServiceId}:${requirement.resourceType.id}`;
}

function getReservationResourceRequirements(
  response:
    ReservationResourcesResponse,
): ResourceRequirement[] {
  return [
    ...response.requirements,

    ...aggregateOptionResourceRequirements(
      response
        .optionRequirements,
    ),
  ];
}

export default function ReservationDetailPage() {
  const [operationalNow, setOperationalNow] = useState(() => Date.now());

  useEffect(() => {
    const intervalId = window.setInterval(
      () => setOperationalNow(Date.now()),
      60_000,
    );

    return () => window.clearInterval(intervalId);
  }, []);

  const params = useParams<{
    id: string;
  }>();

  const reservationId = params.id;

  const [cancellationDialogOpen, setCancellationDialogOpen] = useState(false);

  const [cancellationInitiator, setCancellationInitiator] =
    useState<CancellationInitiator>("CUSTOMER");

  const [cancellationReason, setCancellationReason] = useState("");

  const [cancellationSubmitting, setCancellationSubmitting] = useState(false);

  const [cancellationError, setCancellationError] = useState<string | null>(
    null,
  );

  const [cancellationResult, setCancellationResult] =
    useState<CancellationResponse | null>(null);

  const [refundDialogOpen, setRefundDialogOpen] = useState(false);

  const [selectedRefundGroup, setSelectedRefundGroup] =
    useState<RefundGroup | null>(null);

  const [refundTargetStatus, setRefundTargetStatus] =
    useState<RefundAdminTargetStatus | null>(null);

  const [refundExternalReference, setRefundExternalReference] = useState("");

  const [refundSubmitting, setRefundSubmitting] = useState(false);

  const [refundActionError, setRefundActionError] = useState<string | null>(
    null,
  );

  const [refundActionSuccess, setRefundActionSuccess] = useState<string | null>(
    null,
  );

  const [rescheduleDialogOpen, setRescheduleDialogOpen] = useState(false);

  const [rescheduleCheckIn, setRescheduleCheckIn] = useState("");

  const [rescheduleCheckOut, setRescheduleCheckOut] = useState("");

  const [rescheduleReason, setRescheduleReason] = useState("");

  const [rescheduleSubmitting, setRescheduleSubmitting] = useState(false);

  const [rescheduleError, setRescheduleError] = useState<string | null>(null);

  const [rescheduleResult, setRescheduleResult] =
    useState<RescheduleResponse | null>(null);

  const [stayExtensionDialogOpen, setStayExtensionDialogOpen] =
    useState(false);

  const [stayExtensionCheckOut, setStayExtensionCheckOut] =
    useState("");

  const [stayExtensionReason, setStayExtensionReason] =
    useState("");

  const [stayExtensionSubmitting, setStayExtensionSubmitting] =
    useState(false);

  const [stayExtensionError, setStayExtensionError] =
    useState<string | null>(null);

  const [stayExtensionResult, setStayExtensionResult] =
    useState<StayExtensionResponse | null>(null);
  const [confirmationDialogOpen, setConfirmationDialogOpen] =
    useState(false);

  const [confirmationReason, setConfirmationReason] =
    useState("");

  const [confirmationSubmitting, setConfirmationSubmitting] =
    useState(false);

  const [confirmationError, setConfirmationError] =
    useState<string | null>(null);

  const [confirmationResult, setConfirmationResult] =
    useState<ConfirmationResponse | null>(null);

  const [checkinDialogOpen, setCheckinDialogOpen] =
    useState(false);

  const [checkinReason, setCheckinReason] =
    useState("");

  const [checkinSubmitting, setCheckinSubmitting] =
    useState(false);

  const [checkinError, setCheckinError] =
    useState<string | null>(null);

  const [checkinResult, setCheckinResult] =
    useState<CheckinResponse | null>(null);

  const [noShowDialogOpen, setNoShowDialogOpen] =
    useState(false);

  const [noShowReason, setNoShowReason] =
    useState("");

  const [noShowSubmitting, setNoShowSubmitting] =
    useState(false);

  const [noShowError, setNoShowError] =
    useState<string | null>(null);

  const [noShowResult, setNoShowResult] =
    useState<NoShowResponse | null>(null);

  const [checkoutDialogOpen, setCheckoutDialogOpen] =
    useState(false);

  const [checkoutReason, setCheckoutReason] =
    useState("");

  const [checkoutSubmitting, setCheckoutSubmitting] =
    useState(false);

  const [checkoutError, setCheckoutError] =
    useState<string | null>(null);

  const [checkoutResult, setCheckoutResult] =
    useState<CheckoutResponse | null>(null);

  const [completionDialogOpen, setCompletionDialogOpen] =
    useState(false);

  const [completionReason, setCompletionReason] =
    useState("");

  const [completionSubmitting, setCompletionSubmitting] =
    useState(false);

  const [completionError, setCompletionError] =
    useState<string | null>(null);

  const [completionResult, setCompletionResult] =
    useState<CompletionResponse | null>(null);

  const [optionDialogOpen, setOptionDialogOpen] = useState(false);

  const [postBookingOptions, setPostBookingOptions] =
    useState<PostBookingOptionChoice[]>([]);

  const [optionCatalogLoading, setOptionCatalogLoading] =
    useState(false);

  const [selectedPostBookingOptionId, setSelectedPostBookingOptionId] =
    useState("");

  const [optionQuantity, setOptionQuantity] =
    useState("1");

  const [optionOwnInterval, setOptionOwnInterval] =
    useState(false);

  const [optionStartAt, setOptionStartAt] =
    useState("");

  const [optionEndAt, setOptionEndAt] =
    useState("");

  const [optionAddReason, setOptionAddReason] =
    useState("");

  const [optionAddSubmitting, setOptionAddSubmitting] =
    useState(false);

  const [optionAddError, setOptionAddError] =
    useState<string | null>(null);

  const [optionAddSuccess, setOptionAddSuccess] =
    useState<string | null>(null);

  const [optionRemoveDialogOpen, setOptionRemoveDialogOpen] =
    useState(false);

  const [selectedReservationOptionId, setSelectedReservationOptionId] =
    useState("");

  const [optionRemoveQuantity, setOptionRemoveQuantity] =
    useState("1");

  const [optionRemoveReason, setOptionRemoveReason] =
    useState("");

  const [optionRemoveSubmitting, setOptionRemoveSubmitting] =
    useState(false);

  const [optionRemoveError, setOptionRemoveError] =
    useState<string | null>(null);

  const [optionRemoveSuccess, setOptionRemoveSuccess] =
    useState<string | null>(null);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);

  const [paymentMethod, setPaymentMethod] = useState<
    RegisterablePaymentMethod | ""
  >("");

  const [paymentProofUrl, setPaymentProofUrl] = useState("");

  const [paymentSubmitting, setPaymentSubmitting] = useState(false);

  const [paymentError, setPaymentError] = useState<string | null>(null);

  const [paymentSuccess, setPaymentSuccess] = useState<string | null>(null);

  const [paymentProcessingId, setPaymentProcessingId] = useState<string | null>(
    null,
  );

  const [paymentActionError, setPaymentActionError] = useState<string | null>(
    null,
  );

  const [resourceDialogOpen, setResourceDialogOpen] = useState(false);

  const [resourceOptions, setResourceOptions] =
    useState<ReservationResourcesResponse | null>(null);

  const [resourceLoading, setResourceLoading] = useState(false);

  const [resourceSubmitting, setResourceSubmitting] = useState(false);

  const [resourceError, setResourceError] = useState<string | null>(null);

  const [resourceSuccess, setResourceSuccess] = useState<string | null>(null);

  const [selectedRequirementKey, setSelectedRequirementKey] = useState("");

  const [selectedResourceId, setSelectedResourceId] = useState("");

  const [data, setData] = useState<ReservationDetailResponse | null>(null);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState<string | null>(null);

  const fetchReservation = useCallback(async () => {
    const response = await fetch(`/api/reservations/${reservationId}`, {
      method: "GET",
      cache: "no-store",
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(
        typeof result.error === "string"
          ? result.error
          : "No fue posible cargar la reserva",
      );
    }

    return result as ReservationDetailResponse;
  }, [reservationId]);

  const loadReservation = useCallback(async () => {
    try {
      const result = await fetchReservation();

      setData(result);
      setError(null);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "No fue posible cargar la reserva",
      );
    } finally {
      setLoading(false);
    }
  }, [fetchReservation]);

  useEffect(() => {
    let ignore = false;

    void fetchReservation()
      .then((result) => {
        if (ignore) {
          return;
        }

        setData(result);
        setError(null);
      })
      .catch((error: unknown) => {
        if (ignore) {
          return;
        }

        setError(
          error instanceof Error
            ? error.message
            : "No fue posible cargar la reserva",
        );
      })
      .finally(() => {
        if (!ignore) {
          setLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [fetchReservation]);


  async function openResourceDialog() {
    setResourceDialogOpen(true);
    setResourceLoading(true);
    setResourceError(null);
    setResourceSuccess(null);
    setResourceOptions(null);
    setSelectedRequirementKey("");
    setSelectedResourceId("");

    try {
      const response = await fetch(
        `/api/reservations/${reservationId}/resources`,
        {
          method: "GET",
          cache: "no-store",
        },
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof result.error === "string"
            ? result.error
            : "No fue posible consultar los recursos",
        );
      }

      const options =
        result as ReservationResourcesResponse;

      const requirements =
        getReservationResourceRequirements(
          options,
        );

      setResourceOptions(
        options,
      );

      const firstPendingRequirement =
        requirements.find(
          (requirement) =>
            !requirement.satisfied &&
            requirement.resources.some(
              (resource) =>
                resource.available,
            ),
        );

      if (
        firstPendingRequirement
      ) {
        const requirementKey =
          getResourceRequirementKey(
            firstPendingRequirement,
          );

        const firstAvailableResource =
          firstPendingRequirement
            .resources
            .find(
              (resource) =>
                resource.available,
            );

        setSelectedRequirementKey(
          requirementKey,
        );

        setSelectedResourceId(
          firstAvailableResource
            ?.id ??
            "",
        );
      }
    } catch (error) {
      setResourceError(
        error instanceof Error
          ? error.message
          : "No fue posible consultar los recursos",
      );
    } finally {
      setResourceLoading(false);
    }
  }

  async function handleAssignResource() {
    if (!resourceOptions || !selectedRequirementKey || !selectedResourceId) {
      setResourceError("Selecciona un recurso disponible.");

      return;
    }

    const selectedRequirement =
      getReservationResourceRequirements(
        resourceOptions,
      ).find(
        (requirement) =>
          getResourceRequirementKey(
            requirement,
          ) ===
          selectedRequirementKey,
      );

    if (!selectedRequirement) {
      setResourceError("No fue posible determinar el requisito seleccionado.");

      return;
    }

    if (
      selectedRequirement.source ===
        "OPTION" &&
      !selectedRequirement
        .assignmentTargetReservationOptionId
    ) {
      setResourceError(
        "Todos los recursos requeridos por este complemento ya están asignados.",
      );

      return;
    }

    setResourceSubmitting(true);
    setResourceError(null);

    try {
      const assignmentEndpoint =
        selectedRequirement.source ===
        "OPTION"
          ? `/api/reservations/${reservationId}/resources`
          : `/api/reservations/${reservationId}/room`;

      const assignmentBody =
        selectedRequirement.source ===
        "OPTION"
          ? {
              resourceId:
                selectedResourceId,

              reservationOptionId:
                selectedRequirement
                  .assignmentTargetReservationOptionId,
            }
          : {
              resourceId:
                selectedResourceId,

              reservationServiceId:
                selectedRequirement
                  .reservationServiceId,
            };

      const response =
        await fetch(
          assignmentEndpoint,
          {
            method:
              "PATCH",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify(
                assignmentBody,
              ),
          },
        );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof result.error === "string"
            ? result.error
            : "No fue posible asignar el recurso",
        );
      }

      const assignedResource =
        selectedRequirement.source ===
        "OPTION"
          ? result.assignment
              ?.resource
          : result.reservation
              ?.resource;

      setResourceDialogOpen(false);

      setResourceSuccess(
        assignedResource?.name
          ? `Recurso ${assignedResource.name} asignado correctamente.`
          : "Recurso asignado correctamente.",
      );

      await loadReservation();
    } catch (error) {
      setResourceError(
        error instanceof Error
          ? error.message
          : "No fue posible asignar el recurso",
      );
    } finally {
      setResourceSubmitting(false);
    }
  }

  function openPaymentDialog() {
    setPaymentError(null);
    setPaymentActionError(null);
    setPaymentSuccess(null);
    setPaymentProofUrl("");

    const firstMethod = availablePaymentMethods[0] ?? "";

    setPaymentMethod(firstMethod);
    setPaymentDialogOpen(true);
  }

  async function handleCreatePayment() {
    if (!paymentMethod) {
      setPaymentError("Selecciona un método de pago.");

      return;
    }

    setPaymentSubmitting(true);
    setPaymentError(null);
    setPaymentSuccess(null);

    try {
      const body: {
        method: RegisterablePaymentMethod;
        proofUrl?: string;
        verifiedById?: string;
      } = {
        method: paymentMethod,
      };

      if (paymentMethod === "BANK_TRANSFER" && paymentProofUrl.trim()) {
        body.proofUrl = paymentProofUrl.trim();
      }

      if (paymentMethod === "CASH") {
        body.verifiedById = TEMP_RECEPTION_USER_ID;
      }

      const response = await fetch(
        `/api/reservations/${reservationId}/payments`,
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify(body),
        },
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof result.error === "string"
            ? result.error
            : "No fue posible registrar el pago",
        );
      }

      setPaymentDialogOpen(false);
      setPaymentMethod("");
      setPaymentProofUrl("");

      if (paymentMethod === "BANK_TRANSFER") {
        setPaymentSuccess(
          "Transferencia registrada como pendiente de verificación.",
        );
      } else {
        setPaymentSuccess("Pago en efectivo registrado correctamente.");
      }

      await loadReservation();
    } catch (error) {
      setPaymentError(
        error instanceof Error
          ? error.message
          : "No fue posible registrar el pago",
      );
    } finally {
      setPaymentSubmitting(false);
    }
  }

  async function handlePaymentStatusChange(
    paymentId: string,
    status: PaymentTargetStatus,
  ) {
    setPaymentProcessingId(paymentId);
    setPaymentActionError(null);
    setPaymentSuccess(null);

    try {
      const body: {
        status: PaymentTargetStatus;
        verifiedById?: string;
      } = {
        status,
      };

      if (status === "PAID") {
        body.verifiedById = TEMP_RECEPTION_USER_ID;
      }

      const response = await fetch(
        `/api/reservations/${reservationId}/payments/${paymentId}`,
        {
          method: "PATCH",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify(body),
        },
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof result.error === "string"
            ? result.error
            : "No fue posible actualizar el pago",
        );
      }

      setPaymentSuccess(
        status === "PAID"
          ? "Transferencia confirmada correctamente."
          : "El pago fue marcado como fallido.",
      );

      await loadReservation();
    } catch (error) {
      setPaymentActionError(
        error instanceof Error
          ? error.message
          : "No fue posible actualizar el pago",
      );
    } finally {
      setPaymentProcessingId(null);
    }
  }

  function openRescheduleDialog() {
    if (!data) {
      return;
    }

    setRescheduleError(null);
    setRescheduleResult(null);

    setRescheduleCheckIn(
      getDateOnlyInTimezone(data.reservation.startAt, data.business.timezone),
    );

    setRescheduleCheckOut(
      getDateOnlyInTimezone(data.reservation.endAt, data.business.timezone),
    );

    setRescheduleReason("");
    setRescheduleDialogOpen(true);
  }

  async function handleReschedule() {
    if (!rescheduleCheckIn || !rescheduleCheckOut) {
      setRescheduleError("Debes indicar las nuevas fechas.");
      return;
    }

    if (rescheduleCheckOut <= rescheduleCheckIn) {
      setRescheduleError(
        "La fecha de salida debe ser posterior a la fecha de entrada.",
      );
      return;
    }

    setRescheduleSubmitting(true);
    setRescheduleError(null);

    try {
      const response = await fetch(
        `/api/reservations/${reservationId}/reschedule`,
        {
          method: "PATCH",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            checkIn: rescheduleCheckIn,

            checkOut: rescheduleCheckOut,

            changedById: TEMP_RECEPTION_USER_ID,

            reason: rescheduleReason.trim() || undefined,
          }),
        },
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof result.error === "string"
            ? result.error
            : "No fue posible reprogramar la reserva",
        );
      }

      const rescheduleResponse = result as RescheduleResponse;

      setRescheduleResult(rescheduleResponse);

      setRescheduleDialogOpen(false);

      await loadReservation();
    } catch (error) {
      setRescheduleError(
        error instanceof Error
          ? error.message
          : "No fue posible reprogramar la reserva",
      );
    } finally {
      setRescheduleSubmitting(false);
    }
  }

  function openStayExtensionDialog() {
    if (!data) {
      return;
    }

    const currentCheckOut =
      getDateOnlyInTimezone(
        data.reservation.endAt,
        data.business.timezone,
      );

    setStayExtensionError(null);
    setStayExtensionResult(null);

    setStayExtensionCheckOut(
      addDateOnlyDays(
        currentCheckOut,
        1,
      ),
    );

    setStayExtensionReason("");
    setStayExtensionDialogOpen(true);
  }

  async function handleStayExtension() {
    if (!data) {
      return;
    }

    if (!stayExtensionCheckOut) {
      setStayExtensionError(
        "Debes indicar la nueva fecha de salida.",
      );

      return;
    }

    const currentCheckOut =
      getDateOnlyInTimezone(
        data.reservation.endAt,
        data.business.timezone,
      );

    if (
      stayExtensionCheckOut <=
      currentCheckOut
    ) {
      setStayExtensionError(
        "La nueva fecha de salida debe ser posterior a la salida actual.",
      );

      return;
    }

    setStayExtensionSubmitting(true);
    setStayExtensionError(null);

    try {
      const response = await fetch(
        `/api/reservations/${reservationId}/extend`,
        {
          method: "PATCH",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            checkOut:
              stayExtensionCheckOut,

            changedById:
              TEMP_RECEPTION_USER_ID,

            reason:
              stayExtensionReason.trim() ||
              undefined,
          }),
        },
      );

      const result =
        await response.json();

      if (!response.ok) {
        throw new Error(
          typeof result.error ===
          "string"
            ? result.error
            : "No fue posible extender la estancia",
        );
      }

      const extensionResponse =
        result as StayExtensionResponse;

      setStayExtensionResult(
        extensionResponse,
      );

      setStayExtensionDialogOpen(
        false,
      );

      await loadReservation();
    } catch (error) {
      setStayExtensionError(
        error instanceof Error
          ? error.message
          : "No fue posible extender la estancia",
      );
    } finally {
      setStayExtensionSubmitting(
        false,
      );
    }
  }
  function openConfirmationDialog() {
    if (
      !data
    ) {
      return;
    }

    setConfirmationReason(
      "",
    );

    setConfirmationError(
      null,
    );

    setConfirmationResult(
      null,
    );

    setConfirmationDialogOpen(
      true,
    );
  }

  async function handleConfirmation() {
    if (
      !data
    ) {
      return;
    }

    if (
      !data.paymentSummary
        .initialPaymentSatisfied
    ) {
      setConfirmationError(
        "La reserva no puede confirmarse hasta cubrir el pago inicial requerido.",
      );

      return;
    }

    if (
      confirmationReason.trim().length >
      1000
    ) {
      setConfirmationError(
        "El motivo de la confirmación no puede superar los 1000 caracteres.",
      );

      return;
    }

    setConfirmationSubmitting(
      true,
    );

    setConfirmationError(
      null,
    );

    try {
      const response =
        await fetch(
          `/api/reservations/${reservationId}/confirm`,
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                changedById:
                  TEMP_RECEPTION_USER_ID,

                reason:
                  confirmationReason.trim() ||
                  undefined,
              }),
          },
        );

      const result =
        await response.json();

      if (
        !response.ok
      ) {
        throw new Error(
          typeof result.error ===
            "string"
            ? result.error
            : "No fue posible confirmar la reserva",
        );
      }

      const confirmationResponse =
        result as
          ConfirmationResponse;

      setConfirmationResult(
        confirmationResponse,
      );

      setConfirmationDialogOpen(
        false,
      );

      await loadReservation();
    } catch (
      error
    ) {
      setConfirmationError(
        error instanceof
          Error
          ? error.message
          : "No fue posible confirmar la reserva",
      );
    } finally {
      setConfirmationSubmitting(
        false,
      );
    }
  }

  function openCheckinDialog() {
    if (!data) {
      return;
    }

    setCheckinReason("");
    setCheckinError(null);
    setCheckinResult(null);

    setCheckinDialogOpen(true);
  }

  async function handleCheckin() {
    if (!data) {
      return;
    }

    if (
      checkinWindowClosed
    ) {
      setCheckinError(
        "La salida programada ya venció. Debes gestionar la reserva como no presentada.",
      );

      return;
    }

    if (
      checkinBlockedByInitialPayment
    ) {
      setCheckinError(
        "El pago inicial requerido debe estar cubierto antes del check-in.",
      );

      return;
    }

    if (
      !checkinDue &&
      !checkinReason.trim()
    ) {
      setCheckinError(
        "Debes indicar el motivo del ingreso anticipado.",
      );

      return;
    }

    if (
      checkinReason.trim().length >
      1000
    ) {
      setCheckinError(
        "El motivo del check-in no puede superar los 1000 caracteres.",
      );

      return;
    }

    setCheckinSubmitting(true);
    setCheckinError(null);

    try {
      const response = await fetch(
        `/api/reservations/${reservationId}/checkin`,
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            changedById:
              TEMP_RECEPTION_USER_ID,

            reason:
              checkinReason.trim() ||
              undefined,
          }),
        },
      );

      const result =
        await response.json();

      if (!response.ok) {
        throw new Error(
          typeof result.error ===
          "string"
            ? result.error
            : "No fue posible registrar el check-in",
        );
      }

      const checkinResponse =
        result as CheckinResponse;

      setCheckinResult(
        checkinResponse,
      );

      setCheckinDialogOpen(
        false,
      );

      await loadReservation();
    } catch (error) {
      setCheckinError(
        error instanceof Error
          ? error.message
          : "No fue posible registrar el check-in",
      );
    } finally {
      setCheckinSubmitting(
        false,
      );
    }
  }

  function openNoShowDialog() {
    if (!data) {
      return;
    }

    setNoShowReason("");
    setNoShowError(null);
    setNoShowResult(null);

    setNoShowDialogOpen(true);
  }

  async function handleNoShow() {
    if (!data) {
      return;
    }

    if (
      !noShowDue
    ) {
      setNoShowError(
        "La reserva todavía no ha alcanzado su hora programada de inicio.",
      );

      return;
    }

    if (
      noShowBlockedByPendingPayment
    ) {
      setNoShowError(
        "Debes confirmar o rechazar los pagos pendientes antes de registrar la ausencia.",
      );

      return;
    }

    const normalizedReason =
      noShowReason.trim();

    if (
      !normalizedReason
    ) {
      setNoShowError(
        "Debes indicar el motivo por el que se marca la reserva como no presentada.",
      );

      return;
    }

    if (
      normalizedReason.length >
      1000
    ) {
      setNoShowError(
        "El motivo de la ausencia no puede superar los 1000 caracteres.",
      );

      return;
    }

    setNoShowSubmitting(true);
    setNoShowError(null);

    try {
      const response = await fetch(
        `/api/reservations/${reservationId}/no-show`,
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            changedById:
              TEMP_RECEPTION_USER_ID,

            reason:
              normalizedReason,
          }),
        },
      );

      const result =
        await response.json();

      if (!response.ok) {
        throw new Error(
          typeof result.error ===
          "string"
            ? result.error
            : "No fue posible registrar la ausencia",
        );
      }

      const noShowResponse =
        result as NoShowResponse;

      setNoShowResult(
        noShowResponse,
      );

      setNoShowDialogOpen(
        false,
      );

      await loadReservation();
    } catch (error) {
      setNoShowError(
        error instanceof Error
          ? error.message
          : "No fue posible registrar la ausencia",
      );
    } finally {
      setNoShowSubmitting(
        false,
      );
    }
  }

  function openCheckoutDialog() {
    if (!data) {
      return;
    }

    setCheckoutReason("");
    setCheckoutError(null);
    setCheckoutResult(null);

    setCheckoutDialogOpen(true);
  }

  async function handleCheckout() {
    if (!data) {
      return;
    }

    const isEarlyCheckout =
      !isReservationCheckoutDue({
        status:
          data.reservation.status,

        endAt:
          data.reservation.endAt,

        now:
          new Date(),
      });

    if (
      isEarlyCheckout &&
      !checkoutReason.trim()
    ) {
      setCheckoutError(
        "Debes indicar el motivo de la salida anticipada.",
      );

      return;
    }

    setCheckoutSubmitting(true);
    setCheckoutError(null);

    try {
      const response = await fetch(
        `/api/reservations/${reservationId}/checkout`,
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            changedById:
              TEMP_RECEPTION_USER_ID,

            reason:
              checkoutReason.trim() ||
              undefined,
          }),
        },
      );

      const result =
        await response.json();

      if (!response.ok) {
        throw new Error(
          typeof result.error ===
            "string"
            ? result.error
            : "No fue posible registrar el check-out",
        );
      }

      const checkoutResponse =
        result as CheckoutResponse;

      setCheckoutResult(
        checkoutResponse,
      );

      setCheckoutDialogOpen(
        false,
      );

      await loadReservation();
    } catch (error) {
      setCheckoutError(
        error instanceof Error
          ? error.message
          : "No fue posible registrar el check-out",
      );
    } finally {
      setCheckoutSubmitting(
        false,
      );
    }
  }

  function openCompletionDialog() {
    if (!data) {
      return;
    }

    setCompletionReason("");
    setCompletionError(null);
    setCompletionResult(null);

    setCheckoutResult(null);
    setCompletionDialogOpen(true);
  }

  async function handleCompletion() {
    if (!data) {
      return;
    }

    if (
      !completionFinanciallySettled
    ) {
      setCompletionError(
        "No puedes completar la reserva hasta resolver saldos, pagos pendientes, devoluciones pendientes o sobrepagos.",
      );

      return;
    }

    if (
      completionReason.trim().length >
      1000
    ) {
      setCompletionError(
        "El motivo del cierre no puede superar los 1000 caracteres.",
      );

      return;
    }

    setCompletionSubmitting(true);
    setCompletionError(null);

    try {
      const response = await fetch(
        `/api/reservations/${reservationId}/complete`,
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            changedById:
              TEMP_RECEPTION_USER_ID,

            reason:
              completionReason.trim() ||
              undefined,
          }),
        },
      );

      const result =
        await response.json();

      if (!response.ok) {
        throw new Error(
          typeof result.error ===
          "string"
            ? result.error
            : "No fue posible completar la reserva",
        );
      }

      const completionResponse =
        result as CompletionResponse;

      setCompletionResult(
        completionResponse,
      );

      setCompletionDialogOpen(
        false,
      );

      await loadReservation();
    } catch (error) {
      setCompletionError(
        error instanceof Error
          ? error.message
          : "No fue posible completar la reserva",
      );
    } finally {
      setCompletionSubmitting(
        false,
      );
    }
  }

  function getExistingOptionalQuantity(
    serviceOptionId: string,
  ) {
    if (!data) {
      return 0;
    }

    return data.options
      .filter(
        (option) =>
          option.serviceOptionId ===
          serviceOptionId,
      )
      .reduce(
        (sum, option) =>
          sum +
          option.activeOptionalQuantity,
        0,
      );
  }

  function initializeOptionSelection(
    choice: PostBookingOptionChoice,
  ) {
    const existingOptionalQuantity =
      getExistingOptionalQuantity(
        choice.serviceOptionId,
      );

    const minimumAdditionalQuantity =
      Math.max(
        choice.minOptionalQuantity -
          existingOptionalQuantity,
        1,
      );

    setSelectedPostBookingOptionId(
      choice.serviceOptionId,
    );

    setOptionQuantity(
      String(
        minimumAdditionalQuantity,
      ),
    );

    const requiresOwnInterval =
      choice.pricingFrequency ===
      "PER_HOUR";

    setOptionOwnInterval(
      requiresOwnInterval,
    );

    setOptionStartAt("");
    setOptionEndAt("");
  }

  async function openOptionDialog() {
    if (!data) {
      return;
    }

    if (
      data.services.length !==
      1
    ) {
      setOptionAddError(
        "Esta versión de Hotel solo permite agregar complementos cuando la reserva tiene un único servicio.",
      );

      return;
    }

    setOptionDialogOpen(true);

    setOptionCatalogLoading(true);

    setOptionAddError(null);
    setOptionAddSuccess(null);

    setOptionRemoveSuccess(null);

    setPostBookingOptions([]);

    setSelectedPostBookingOptionId("");

    setOptionQuantity("1");

    setOptionOwnInterval(false);

    setOptionStartAt("");
    setOptionEndAt("");

    setOptionAddReason("");

    try {
      const response =
        await fetch(
          `/api/business-options?businessId=${encodeURIComponent(
            data.business.id,
          )}`,
          {
            method: "GET",
            cache: "no-store",
          },
        );

      const result =
        await response.json();

      if (!response.ok) {
        throw new Error(
          typeof result.error ===
            "string"
            ? result.error
            : "No fue posible cargar los complementos disponibles.",
        );
      }

      const catalog =
        result as BusinessOptionsCatalogResponse;

      const reservedService =
        data.services[0];

      const choices:
        PostBookingOptionChoice[] =
        [];

      for (
        const option of
        catalog.items
      ) {
        if (!option.isActive) {
          continue;
        }

        for (
          const serviceOption of
          option.services
        ) {
          if (
            serviceOption.service.id !==
              reservedService.serviceId ||
            !serviceOption.service.isActive ||
            !serviceOption.isActive ||
            !serviceOption.isOptional ||
            !serviceOption.availableAfterBooking
          ) {
            continue;
          }

          const existingOptionalQuantity =
            getExistingOptionalQuantity(
              serviceOption.id,
            );

          if (
            serviceOption.maxOptionalQuantity !==
              null &&
            existingOptionalQuantity >=
              serviceOption.maxOptionalQuantity
          ) {
            continue;
          }

          choices.push({
            optionId:
              option.id,

            optionName:
              option.name,

            description:
              option.description,

            serviceOptionId:
              serviceOption.id,

            isIncluded:
              serviceOption.isIncluded,

            minOptionalQuantity:
              serviceOption.minOptionalQuantity,

            maxOptionalQuantity:
              serviceOption.maxOptionalQuantity,

            price:
              serviceOption.price,

            pricingBase:
              serviceOption.pricingBase,

            pricingFrequency:
              serviceOption.pricingFrequency,

            resourceTypes:
              serviceOption.resourceTypes.map(
                (requirement) => ({
                  resourceTypeId:
                    requirement.resourceType.id,

                  name:
                    requirement.resourceType.name,

                  requiredQuantity:
                    requirement.requiredQuantity,

                  activeResourceCount:
                    requirement.resourceType
                      .activeResourceCount,
                }),
              ),
          });
        }
      }

      setPostBookingOptions(
        choices,
      );

      if (
        choices.length >
        0
      ) {
        initializeOptionSelection(
          choices[0],
        );
      }
    } catch (error) {
      setOptionAddError(
        error instanceof
          Error
          ? error.message
          : "No fue posible cargar los complementos disponibles.",
      );
    } finally {
      setOptionCatalogLoading(false);
    }
  }

  function handlePostBookingOptionSelection(
    serviceOptionId: string,
  ) {
    const choice =
      postBookingOptions.find(
        (option) =>
          option.serviceOptionId ===
          serviceOptionId,
      );

    if (!choice) {
      setSelectedPostBookingOptionId("");

      return;
    }

    initializeOptionSelection(
      choice,
    );

    setOptionAddError(null);
  }

  async function handleAddReservationOption() {
    if (!data) {
      return;
    }

    if (
      data.services.length !==
      1
    ) {
      setOptionAddError(
        "Esta versión de Hotel solo permite agregar complementos cuando la reserva tiene un único servicio.",
      );

      return;
    }

    const selectedOption =
      postBookingOptions.find(
        (option) =>
          option.serviceOptionId ===
          selectedPostBookingOptionId,
      );

    if (!selectedOption) {
      setOptionAddError(
        "Selecciona un complemento.",
      );

      return;
    }

    const quantity =
      Number(
        optionQuantity,
      );

    if (
      !Number.isInteger(
        quantity,
      ) ||
      quantity <
        1
    ) {
      setOptionAddError(
        "La cantidad debe ser un número entero mayor que cero.",
      );

      return;
    }

    const existingOptionalQuantity =
      getExistingOptionalQuantity(
        selectedOption.serviceOptionId,
      );

    const accumulatedOptionalQuantity =
      existingOptionalQuantity +
      quantity;

    if (
      accumulatedOptionalQuantity <
      selectedOption
        .minOptionalQuantity
    ) {
      setOptionAddError(
        `La cantidad opcional acumulada debe ser al menos ${selectedOption.minOptionalQuantity}.`,
      );

      return;
    }

    if (
      selectedOption
        .maxOptionalQuantity !==
        null &&
      accumulatedOptionalQuantity >
        selectedOption
          .maxOptionalQuantity
    ) {
      setOptionAddError(
        `La cantidad máxima acumulada para este complemento es ${selectedOption.maxOptionalQuantity}.`,
      );

      return;
    }

    if (
      selectedOption.pricingBase ===
        "PERSON" &&
      accumulatedOptionalQuantity >
        data.reservation.guests
    ) {
      setOptionAddError(
        "La cantidad seleccionada no puede superar la cantidad de huéspedes de la reserva.",
      );

      return;
    }

    const requiresOwnInterval =
      selectedOption
        .pricingFrequency ===
      "PER_HOUR";

    const useOwnInterval =
      requiresOwnInterval ||
      optionOwnInterval;

    let startAt:
      string | undefined;

    let endAt:
      string | undefined;

    if (
      useOwnInterval
    ) {
      if (
        !optionStartAt ||
        !optionEndAt
      ) {
        setOptionAddError(
          requiresOwnInterval
            ? "Este complemento por hora requiere fecha y hora de inicio y fin."
            : "Completa la fecha y hora de inicio y fin del intervalo.",
        );

        return;
      }

      try {
        startAt =
          localBusinessDateTimeToIso(
            optionStartAt,
            data.business.timezone,
          );

        endAt =
          localBusinessDateTimeToIso(
            optionEndAt,
            data.business.timezone,
          );
      } catch (error) {
        setOptionAddError(
          error instanceof
            Error
            ? error.message
            : "El intervalo del complemento no es válido.",
        );

        return;
      }

      if (
        new Date(endAt) <=
        new Date(startAt)
      ) {
        setOptionAddError(
          "La fecha y hora final debe ser posterior a la inicial.",
        );

        return;
      }
    }

    setOptionAddSubmitting(true);

    setOptionAddError(null);
    setOptionAddSuccess(null);

    setOptionRemoveSuccess(null);

    try {
      const response =
        await fetch(
          `/api/reservations/${reservationId}/options`,
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                changedById:
                  TEMP_RECEPTION_USER_ID,

                reason:
                  optionAddReason.trim() ||
                  undefined,

                options: [
                  {
                    reservationServiceId:
                      data.services[0].id,

                    serviceOptionId:
                      selectedOption
                        .serviceOptionId,

                    optionalQuantity:
                      quantity,

                    ...(startAt &&
                    endAt
                      ? {
                          startAt,
                          endAt,
                        }
                      : {}),
                  },
                ],
              }),
          },
        );

      const result =
        await response.json();

      if (!response.ok) {
        throw new Error(
          typeof result.error ===
            "string"
            ? result.error
            : "No fue posible agregar el complemento.",
        );
      }

      const addedName =
        selectedOption
          .optionName;

      setOptionDialogOpen(false);

      setOptionAddSuccess(
        `${addedName} agregado correctamente.`,
      );

      setSelectedPostBookingOptionId("");

      setOptionQuantity("1");

      setOptionOwnInterval(false);

      setOptionStartAt("");
      setOptionEndAt("");

      setOptionAddReason("");

      await loadReservation();
    } catch (error) {
      setOptionAddError(
        error instanceof
          Error
          ? error.message
          : "No fue posible agregar el complemento.",
      );
    } finally {
      setOptionAddSubmitting(false);
    }
  }

  function openOptionRemoveDialog(
    reservationOptionId: string,
  ) {
    if (!data) {
      return;
    }

    const option =
      reservationOptionGroups.find(
        (item) =>
          item.id === reservationOptionId,
      ) ?? null;

    if (!option) {
      setOptionRemoveError(
        "No se encontró el complemento seleccionado.",
      );

      return;
    }

    if (
      option.activeOptionalQuantity <= 0
    ) {
      setOptionRemoveError(
        "Este complemento ya no tiene cantidad opcional activa para retirar.",
      );

      return;
    }

    setSelectedReservationOptionId(
      option.id,
    );

    setOptionRemoveQuantity("1");

    setOptionRemoveReason("");

    setOptionRemoveError(null);

    setOptionRemoveSuccess(null);

    setOptionAddSuccess(null);

    setOptionRemoveDialogOpen(true);
  }

  async function handleRemoveReservationOption() {
    if (!data) {
      return;
    }

    const option =
      reservationOptionGroups.find(
        (item) =>
          item.id ===
          selectedReservationOptionId,
      ) ?? null;

    if (!option) {
      setOptionRemoveError(
        "No se encontró el complemento seleccionado.",
      );

      return;
    }

    const removeOptionalQuantity =
      Number(
        optionRemoveQuantity,
      );

    if (
      !Number.isInteger(
        removeOptionalQuantity,
      ) ||
      removeOptionalQuantity <= 0
    ) {
      setOptionRemoveError(
        "La cantidad a retirar debe ser un número entero mayor que cero.",
      );

      return;
    }

    if (
      removeOptionalQuantity >
      option.activeOptionalQuantity
    ) {
      setOptionRemoveError(
        `Solo puedes retirar hasta ${option.activeOptionalQuantity} unidad(es) opcional(es) activas.`,
      );

      return;
    }

    setOptionRemoveSubmitting(true);

    setOptionRemoveError(null);

    setOptionRemoveSuccess(null);

    setOptionAddSuccess(null);

    try {
      const response =
        await fetch(
          `/api/reservations/${reservationId}/options/${option.id}/remove`,
          {
            method: "PATCH",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                changedById:
                  TEMP_RECEPTION_USER_ID,

                removeOptionalQuantity,

                reason:
                  optionRemoveReason.trim() ||
                  undefined,
              }),
          },
        );

      const result =
        await response.json();

      if (!response.ok) {
        throw new Error(
          typeof result.error ===
            "string"
            ? result.error
            : "No fue posible reducir el complemento.",
        );
      }

      const fullyRemoved =
        removeOptionalQuantity ===
          option.activeOptionalQuantity &&
        option.includedQuantity ===
          0;

      setOptionRemoveDialogOpen(false);

      setSelectedReservationOptionId("");

      setOptionRemoveQuantity("1");

      setOptionRemoveReason("");

      setOptionRemoveSuccess(
        fullyRemoved
          ? `${option.name} retirado correctamente.`
          : `${option.name} reducido correctamente.`,
      );

      await loadReservation();
    } catch (error) {
      setOptionRemoveError(
        error instanceof Error
          ? error.message
          : "No fue posible reducir el complemento.",
      );
    } finally {
      setOptionRemoveSubmitting(false);
    }
  }
  function openRefundGroupDialog(
    group: RefundGroup,
    targetStatus: RefundAdminTargetStatus,
  ) {
    setSelectedRefundGroup(group);

    setRefundTargetStatus(targetStatus);

    setRefundExternalReference("");

    setRefundActionError(null);
    setRefundActionSuccess(null);

    setRefundDialogOpen(true);
  }

  async function handleRefundGroupStatusChange() {
    if (!selectedRefundGroup || !refundTargetStatus) {
      return;
    }

    setRefundSubmitting(true);

    setRefundActionError(null);
    setRefundActionSuccess(null);

    try {
      const response = await fetch(
        `/api/reservations/${reservationId}/refunds/group`,
        {
          method: "PATCH",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            refundIds: selectedRefundGroup.refunds.map((refund) => refund.id),

            status: refundTargetStatus,

            processedById: TEMP_RECEPTION_USER_ID,

            externalReference: refundExternalReference.trim() || undefined,
          }),
        },
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof result.error === "string"
            ? result.error
            : "No fue posible procesar la devolución",
        );
      }

      const successMessages: Record<RefundAdminTargetStatus, string> = {
        PROCESSING: "La devolución pasó a procesamiento.",

        COMPLETED: "La devolución fue completada correctamente.",

        FAILED: "La devolución fue marcada como fallida.",

        CANCELLED: "La devolución fue cancelada.",
      };

      setRefundActionSuccess(successMessages[refundTargetStatus]);

      setRefundDialogOpen(false);

      setSelectedRefundGroup(null);

      setRefundTargetStatus(null);

      setRefundExternalReference("");

      await loadReservation();
    } catch (error) {
      setRefundActionError(
        error instanceof Error
          ? error.message
          : "No fue posible procesar la devolución",
      );
    } finally {
      setRefundSubmitting(false);
    }
  }

  function openCancellationDialog() {
    setCancellationInitiator("CUSTOMER");

    setCancellationReason("");
    setCancellationError(null);
    setCancellationResult(null);
    setCancellationDialogOpen(true);
  }

  async function handleCancelReservation() {
    setCancellationSubmitting(true);
    setCancellationError(null);

    try {
      const response = await fetch(
        `/api/reservations/${reservationId}/cancel`,
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            initiator: cancellationInitiator,

            reason: cancellationReason.trim() || undefined,

            /*
             * Temporal mientras no exista
             * autenticación administrativa.
             *
             * Aunque CUSTOMER no lo exige,
             * conservamos trazabilidad de
             * quién procesó la operación.
             */
            createdById: TEMP_RECEPTION_USER_ID,
          }),
        },
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof result.error === "string"
            ? result.error
            : "No fue posible cancelar la reserva",
        );
      }

      const cancellationResponse = result as CancellationResponse;

      setCancellationResult(cancellationResponse);

      setCancellationDialogOpen(false);

      await loadReservation();
    } catch (error) {
      setCancellationError(
        error instanceof Error
          ? error.message
          : "No fue posible cancelar la reserva",
      );
    } finally {
      setCancellationSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-zinc-500">
        Cargando reserva...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-3xl">
        <Link
          href="/admin/reservations"
          className="text-sm font-medium text-zinc-600 hover:text-zinc-950"
        >
          ← Volver a reservas
        </Link>

        <div className="mt-6 rounded-xl border border-red-200 bg-white p-8 text-center">
          <p className="font-medium text-red-700">
            {error ?? "Reserva no encontrada"}
          </p>

          <button
            type="button"
            onClick={() => {
              setLoading(true);
              setError(null);
              void loadReservation();
            }}
            className="mt-4 rounded-lg border border-zinc-300 px-4 py-2 text-sm"
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  const { reservation, business, customer, paymentSummary, financialState } =
    data;

  const refundGroups = groupRefunds(data.refunds);

  const canAddOptions =
    (
      reservation.status ===
        "PENDING" ||
      reservation.status ===
        "CONFIRMED" ||
      reservation.status ===
        "CHECKED_IN"
    ) &&
    data.services.length ===
      1;

  const selectedPostBookingOption =
    postBookingOptions.find(
      (option) =>
        option.serviceOptionId ===
        selectedPostBookingOptionId,
    ) ??
    null;

  const reservationOptionGroups =
    getReservationOptionGroups(
      data.options,
    );

  const selectedReservationOption =
    reservationOptionGroups.find(
      (option) =>
        option.id ===
        selectedReservationOptionId,
    ) ?? null;

  const selectedExistingOptionalQuantity =
    selectedPostBookingOption
      ? getExistingOptionalQuantity(
          selectedPostBookingOption
            .serviceOptionId,
        )
      : 0;

  const selectedMaximumAdditionalQuantity =
    selectedPostBookingOption
      ?.maxOptionalQuantity ===
      null ||
    selectedPostBookingOption
      ?.maxOptionalQuantity ===
      undefined
      ? null
      : Math.max(
          selectedPostBookingOption
            .maxOptionalQuantity -
            selectedExistingOptionalQuantity,
          0,
        );

  const selectedRequiresOwnInterval =
    selectedPostBookingOption
      ?.pricingFrequency ===
    "PER_HOUR";

  const canCancelReservation =
    (reservation.status === "PENDING" || reservation.status === "CONFIRMED") &&
    !data.cancellation;

  const canReschedule =
    ["PENDING", "CONFIRMED"].includes(reservation.status) &&
    !financialState.hasRefundPending;

  const showStayExtensionAction =
    business.type.slug ===
      "hotel" &&
    reservation.status ===
      "CHECKED_IN";

  const canExtendStay =
    showStayExtensionAction &&
    !financialState.hasRefundPending;

  const minimumStayExtensionCheckOut =
    addDateOnlyDays(
      getDateOnlyInTimezone(
        reservation.endAt,
        business.timezone,
      ),
      1,
    );
  const pendingInitialPayment =
    data.payments.find(
      (payment) =>
        payment.status === "PENDING" &&
        (payment.method === "BANK_TRANSFER" || payment.method === "CARD"),
    ) ?? null;

  const availablePaymentMethods: RegisterablePaymentMethod[] = [];

  if (
    financialState.canAcceptPayment &&
    financialState.amountDue > 0 &&
    !pendingInitialPayment
  ) {
    if (reservation.paymentOption === "FULL") {
      availablePaymentMethods.push("BANK_TRANSFER");
    }

    if (isDepositPaymentOption(reservation.paymentOption)) {
      if (!paymentSummary.initialPaymentSatisfied) {
        availablePaymentMethods.push("BANK_TRANSFER");
      } else if (reservation.status === "CHECKED_IN") {
        availablePaymentMethods.push("CASH");
      }
    }
  }

  const canRegisterPayment = availablePaymentMethods.length > 0;

  const calculatedPaymentAmount =
    paymentMethod === "CASH"
      ? financialState.amountDue
      : isDepositPaymentOption(reservation.paymentOption)
        ? (paymentSummary.initialPaymentRemaining ?? 0)
        : financialState.amountDue;

  const showConfirmationAction =
    reservation.status ===
    "PENDING";

  const confirmationBlockedByInitialPayment =
    !paymentSummary
      .initialPaymentSatisfied;

  const checkinDue =
    isReservationCheckinDue({
      status:
        isOperationalStatus(
          reservation.status,
        )
          ? reservation.status
          : "PENDING",

      startAt:
        new Date(
          reservation.startAt,
        ),

      now:
        new Date(
          operationalNow,
        ),
    });

  const reservationEndTimestamp =
    new Date(
      reservation.endAt,
    ).getTime();

  const checkinWindowClosed =
    Number.isFinite(
      reservationEndTimestamp,
    ) &&
    operationalNow >=
      reservationEndTimestamp;

  const showCheckinAction =
    business.type.slug ===
      "hotel" &&
    reservation.status ===
      "CONFIRMED";

  const checkinBlockedByInitialPayment =
    !paymentSummary
      .initialPaymentSatisfied;

  const checkinIsEarly =
    showCheckinAction &&
    !checkinDue &&
    !checkinWindowClosed;

  const noShowDue =
    isReservationNoShowDue({
      status:
        isOperationalStatus(
          reservation.status,
        )
          ? reservation.status
          : "PENDING",

      scheduledStartAt:
        new Date(
          reservation.startAt,
        ),

      now:
        new Date(
          operationalNow,
        ),
    });

  const showNoShowAction =
    reservation.status ===
      "CONFIRMED";

  const noShowBlockedByPendingPayment =
    Math.round(
      paymentSummary.pending *
        100,
    ) >
    0;

  const checkoutDue = isReservationCheckoutDue({
    status: reservation.status,
    endAt: reservation.endAt,
    now: operationalNow,
  });

  const showCheckoutAction =
    business.type.slug ===
      "hotel" &&
    reservation.status ===
      "CHECKED_IN";

  const showCompletionAction =
    reservation.status ===
    "CHECKED_OUT";

  const checkoutBlockedByPendingPayment =
    paymentSummary.pending >
    0;

  const checkoutBlockedByBalance =
    paymentSummary.balance >
    0;

  const completionFinanciallySettled =
    Math.round(
      paymentSummary.balance *
        100,
    ) ===
      0 &&
    Math.round(
      paymentSummary.pending *
        100,
    ) ===
      0 &&
    Math.round(
      paymentSummary.refundPending *
        100,
    ) ===
      0 &&
    Math.round(
      paymentSummary.netPaid *
        100,
    ) ===
      Math.round(
        paymentSummary.total *
          100,
      );

  const canRemoveOptions = [
    "PENDING",
    "CONFIRMED",
    "CHECKED_IN",
  ].includes(
    reservation.status,
  );

  const canAssignResources = ["PENDING", "CONFIRMED", "CHECKED_IN"].includes(
    reservation.status,
  );

  const resourceActionLabel =
    business.type.slug === "hotel" ? "Asignar habitación" : "Asignar recurso";

  const resourceRequirements =
    resourceOptions
      ? getReservationResourceRequirements(
          resourceOptions,
        )
      : [];

  const selectedRequirement =
    resourceRequirements.find(
      (requirement) =>
        getResourceRequirementKey(
          requirement,
        ) ===
        selectedRequirementKey,
    ) ?? null;

  const resourceDialogTitle =
    selectedRequirement?.source ===
    "OPTION"
      ? "Asignar recurso de complemento"
      : resourceActionLabel;

  const resourceSubmitLabel =
    selectedRequirement?.source ===
    "OPTION"
      ? "Asignar recurso"
      : resourceActionLabel;

  return (
    <div className="mx-auto w-full max-w-[1500px]">
      <Link
        href="/admin/reservations"
        className="text-sm font-medium text-zinc-600 hover:text-zinc-950"
      >
        ← Volver a reservas
      </Link>

      <div className="mt-5 flex flex-col justify-between gap-5 lg:flex-row lg:items-start">
        <div>
          <p className="text-sm text-zinc-500">Reserva</p>

          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">
              {reservation.confirmationCode}
            </h1>

            <span className="rounded-full bg-zinc-200 px-3 py-1 text-xs font-medium">
              {getStatusLabel(reservation.status)}
            </span>

            {showCheckinAction &&
              checkinDue &&
              !checkinWindowClosed && (
                <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-800">
                  Ingreso pendiente
                </span>
              )}

            {checkoutDue && (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">
                Salida pendiente
              </span>
            )}
          </div>

          <p className="mt-2 text-sm text-zinc-500">
            Creada {formatDateTime(reservation.createdAt, business.timezone)}
          </p>

          {reservation.expiresAt &&
            (reservation.status === "PENDING" ||
              reservation.status === "EXPIRED") && (
              <p
                className={`mt-1 text-sm font-medium ${
                  reservation.status === "EXPIRED" ||
                  operationalNow >= Date.parse(reservation.expiresAt)
                    ? "text-red-700"
                    : "text-amber-700"
                }`}
              >
                {reservation.status === "EXPIRED"
                  ? "Venció el "
                  : operationalNow >= Date.parse(reservation.expiresAt)
                    ? "El plazo de pago venció el "
                    : "El plazo de pago vence el "}
                {formatDateTime(
                  reservation.expiresAt,
                  business.timezone,
                )}
              </p>
            )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!canCancelReservation}
            onClick={openCancellationDialog}
            className="h-10 rounded-lg border border-red-300 bg-white px-4 text-sm font-medium text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Cancelar reserva
          </button>

          <button
            type="button"
            disabled={!canReschedule}
            onClick={openRescheduleDialog}
            className="h-10 rounded-lg border border-zinc-300 bg-white px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
          >
            Reprogramar
          </button>

          {showStayExtensionAction && (
            <button
              type="button"
              disabled={!canExtendStay}
              title={
                financialState.hasRefundPending
                  ? "Debes resolver la devolución activa antes de extender la estancia."
                  : undefined
              }
              onClick={openStayExtensionDialog}
              className="h-10 rounded-lg border border-zinc-300 bg-white px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
            >
              Extender estancia
            </button>
          )}
          <button
            type="button"
            disabled={!canAssignResources}
            onClick={() => void openResourceDialog()}
            className="h-10 rounded-lg border border-zinc-300 bg-white px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
          >
            {resourceActionLabel}
          </button>

          {showConfirmationAction && (
            <button
              type="button"
              title={
                confirmationBlockedByInitialPayment
                  ? "Debes cubrir el pago inicial antes de confirmar la reserva."
                  : "Confirmar contractual y operativamente la reserva."
              }
              onClick={
                openConfirmationDialog
              }
              className="h-10 rounded-lg border border-emerald-300 bg-emerald-50 px-4 text-sm font-medium text-emerald-900"
            >
              Confirmar reserva
            </button>
          )}

          {showCheckinAction && (
            <button
              type="button"
              title={
                checkinWindowClosed
                  ? "La salida programada ya venció. Debes gestionar la reserva como no presentada."
                  : checkinBlockedByInitialPayment
                    ? "Debes cubrir el pago inicial antes del check-in."
                    : checkinIsEarly
                      ? "Esta acción registrará un ingreso anticipado."
                      : "Registrar el ingreso del huésped."
              }
              onClick={openCheckinDialog}
              className="h-10 rounded-lg border border-blue-300 bg-blue-50 px-4 text-sm font-medium text-blue-900"
            >
              Registrar check-in
            </button>
          )}

          {showNoShowAction && (
            <button
              type="button"
              title={
                !noShowDue
                  ? "Podrás registrar la ausencia cuando llegue la hora programada de inicio."
                  : noShowBlockedByPendingPayment
                    ? "Debes confirmar o rechazar los pagos pendientes antes de registrar la ausencia."
                    : "Registrar que el cliente no se presentó."
              }
              onClick={openNoShowDialog}
              className="h-10 rounded-lg border border-red-300 bg-red-50 px-4 text-sm font-medium text-red-800"
            >
              Marcar no presentado
            </button>
          )}

          {showCheckoutAction && (
            <button
              type="button"
              title={
                checkoutBlockedByPendingPayment
                  ? "Debes resolver los pagos pendientes antes del check-out."
                  : checkoutBlockedByBalance
                    ? "Debes cobrar el saldo pendiente antes del check-out."
                    : !checkoutDue
                      ? "Esta acción registrará una salida anticipada."
                      : undefined
              }
              onClick={openCheckoutDialog}
              className="h-10 rounded-lg border border-amber-300 bg-amber-50 px-4 text-sm font-medium text-amber-900"
            >
              Registrar check-out
            </button>
          )}

          {showCompletionAction && (
            <button
              type="button"
              title={
                completionFinanciallySettled
                  ? "Esta acción cerrará administrativamente la reserva."
                  : "Debes resolver saldos, pagos pendientes, devoluciones pendientes o sobrepagos antes de completar la reserva."
              }
              onClick={openCompletionDialog}
              className="h-10 rounded-lg border border-green-300 bg-green-50 px-4 text-sm font-medium text-green-900"
            >
              Completar reserva
            </button>
          )}

          <button
            type="button"
            disabled={!canRegisterPayment}
            onClick={openPaymentDialog}
            className="h-10 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Registrar pago
          </button>
        </div>
      </div>

      {resourceSuccess && (
        <div className="mt-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-800">
          {resourceSuccess}
        </div>
      )}

      {paymentSuccess && (
        <div className="mt-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-800">
          {paymentSuccess}
        </div>
      )}

      {paymentActionError && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {paymentActionError}
        </div>
      )}

      {refundActionSuccess && (
        <div className="mt-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-800">
          {refundActionSuccess}
        </div>
      )}

      {refundActionError && !refundDialogOpen && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {refundActionError}
        </div>
      )}

      {cancellationResult && (
        <div className="mt-3 rounded-xl border border-zinc-300 bg-zinc-50 p-4 text-sm">
          <p className="font-semibold">Reserva cancelada correctamente</p>

          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-xs text-zinc-500">Clasificación</p>

              <p className="mt-1 font-medium">
                {cancellationResult.cancellation.type.replaceAll("_", " ")}
              </p>
            </div>

            <div>
              <p className="text-xs text-zinc-500">Estado</p>

              <p className="mt-1 font-medium">Cancelada</p>
            </div>

            <div>
              <p className="text-xs text-zinc-500">Reembolsos generados</p>

              <p className="mt-1 font-medium">
                {cancellationResult.cancellation.refunds.length}
              </p>
            </div>

            <div>
              <p className="text-xs text-zinc-500">Total a devolver</p>

              <p className="mt-1 font-medium">
                {formatMoney(
                  cancellationResult.cancellation.refunds.reduce(
                    (sum, refund) => sum + Number(refund.amount),
                    0,
                  ),
                  business.currency,
                )}
              </p>
            </div>
          </div>

          {cancellationResult.cancellation.refunds.length > 0 && (
            <div className="mt-4 space-y-2">
              {cancellationResult.cancellation.refunds.map((refund) => (
                <div
                  key={refund.id}
                  className="rounded-lg border border-zinc-200 bg-white p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">
                        {refund.basis.replaceAll("_", " ")}
                      </p>

                      <p className="mt-1 text-xs text-zinc-500">
                        Pago {refund.payment.method}
                      </p>
                    </div>

                    <p className="font-semibold">
                      {formatMoney(Number(refund.amount), business.currency)}
                    </p>
                  </div>

                  {Number(refund.administrativeRetention) > 0 && (
                    <p className="mt-2 text-xs text-zinc-600">
                      Retención administrativa:{" "}
                      {formatMoney(
                        Number(refund.administrativeRetention),
                        business.currency,
                      )}
                    </p>
                  )}

                  <p className="mt-2 text-xs text-zinc-500">
                    Estado inicial: {refund.status}
                  </p>
                </div>
              ))}
            </div>
          )}

          {cancellationResult.cancellation.refunds.length === 0 && (
            <p className="mt-4 text-zinc-600">
              No fue necesario generar ningún reembolso porque no había
              principal pagado disponible para devolver.
            </p>
          )}
        </div>
      )}

      {rescheduleResult && (
        <div className="mt-3 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-900">
          <p className="font-semibold">Reserva reprogramada correctamente</p>

          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-xs text-green-700">Nuevas fechas</p>

              <p className="mt-1 font-medium">
                {formatDate(
                  rescheduleResult.reservation.startAt,
                  business.timezone,
                )}
                {" → "}
                {formatDate(
                  rescheduleResult.reservation.endAt,
                  business.timezone,
                )}
              </p>
            </div>

            <div>
              <p className="text-xs text-green-700">Precio</p>

              <p className="mt-1 font-medium">
                {formatMoney(
                  rescheduleResult.change.oldTotal ?? 0,
                  business.currency,
                )}
                {" → "}
                {formatMoney(
                  rescheduleResult.change.newTotal ?? 0,
                  business.currency,
                )}
              </p>
            </div>

            <div>
              <p className="text-xs text-green-700">Estado</p>

              <p className="mt-1 font-medium">
                {getStatusLabel(rescheduleResult.reservation.status)}
              </p>
            </div>

            <div>
              <p className="text-xs text-green-700">Recursos</p>

              <p className="mt-1 font-medium">
                {rescheduleResult.resources.kept.length} conservado(s) ·{" "}
                {rescheduleResult.resources.released.length} liberado(s)
              </p>
            </div>
          </div>

          {rescheduleResult.financialImpact.initialPaymentShortfall > 0 && (
            <p className="mt-3 font-medium text-amber-800">
              Se requiere un pago adicional de{" "}
              {formatMoney(
                rescheduleResult.financialImpact.initialPaymentShortfall,
                business.currency,
              )}{" "}
              para volver a cubrir el anticipo.
            </p>
          )}

          {rescheduleResult.refunds.length > 0 && (
            <div className="mt-3">
              {rescheduleResult.refunds.map((refund) => (
                <p key={refund.id} className="font-medium">
                  Devolución generada:{" "}
                  {formatMoney(refund.amount, business.currency)} ·{" "}
                  {refund.basis.replaceAll("_", " ")} ·{" "}
                  {getStatusLabel(refund.status)}
                </p>
              ))}
            </div>
          )}

          {rescheduleResult.resources.released.length > 0 && (
            <p className="mt-3 text-amber-800">
              Uno o más recursos asignados fueron liberados porque no podían
              mantenerse en las nuevas fechas.
            </p>
          )}
        </div>
      )}

      {confirmationResult && (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <p className="font-semibold">
            Reserva confirmada correctamente
          </p>

          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-xs text-emerald-700">
                Hora de confirmación
              </p>

              <p className="mt-1 font-medium">
                {formatDateTime(
                  confirmationResult
                    .confirmation
                    .confirmedAt,
                  business.timezone,
                )}
              </p>
            </div>

            <div>
              <p className="text-xs text-emerald-700">
                Estado
              </p>

              <p className="mt-1 font-medium">
                {getStatusLabel(
                  confirmationResult
                    .reservation
                    .status,
                )}
              </p>
            </div>

            <div>
              <p className="text-xs text-emerald-700">
                Pago inicial
              </p>

              <p className="mt-1 font-medium">
                Cubierto
              </p>
            </div>

            <div>
              <p className="text-xs text-emerald-700">
                Saldo restante
              </p>

              <p className="mt-1 font-medium">
                {formatMoney(
                  confirmationResult
                    .confirmation
                    .remainingBalance,
                  business.currency,
                )}
              </p>
            </div>

            <div>
              <p className="text-xs text-emerald-700">
                Recursos conservados
              </p>

              <p className="mt-1 font-medium">
                {
                  confirmationResult
                    .resources
                    .assignmentCount
                }
              </p>
            </div>

            <div>
              <p className="text-xs text-emerald-700">
                Confirmada por
              </p>

              <p className="mt-1 font-medium">
                {
                  confirmationResult
                    .actor
                    .name
                }
              </p>
            </div>
          </div>

          <p className="mt-3 text-emerald-800">
            Las fechas, precios, complementos y asignaciones permanecen sin
            cambios. La reserva continúa consumiendo inventario y puede recibir
            el saldo restante.
          </p>

          {confirmationResult.change.reason && (
            <p className="mt-2 text-emerald-800">
              Motivo:{" "}
              {
                confirmationResult
                  .change
                  .reason
              }
            </p>
          )}
        </div>
      )}

      {checkinResult && (
        <div className="mt-3 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-900">
          <p className="font-semibold">
            Check-in registrado correctamente
          </p>

          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-xs text-green-700">
                Hora registrada
              </p>

              <p className="mt-1 font-medium">
                {formatDateTime(
                  checkinResult.checkin.checkedInAt,
                  business.timezone,
                )}
              </p>
            </div>

            <div>
              <p className="text-xs text-green-700">
                Tipo de ingreso
              </p>

              <p className="mt-1 font-medium">
                {checkinResult.checkin.timing ===
                "EARLY"
                  ? "Anticipado"
                  : checkinResult.checkin.timing ===
                      "ON_TIME"
                    ? "A la hora programada"
                    : "Posterior a la hora programada"}
              </p>
            </div>

            <div>
              <p className="text-xs text-green-700">
                Estado
              </p>

              <p className="mt-1 font-medium">
                {getStatusLabel(
                  checkinResult.reservation.status,
                )}
              </p>
            </div>

            <div>
              <p className="text-xs text-green-700">
                Recursos validados
              </p>

              <p className="mt-1 font-medium">
                {
                  checkinResult.resources
                    .assignmentCount
                }
              </p>
            </div>

            <div>
              <p className="text-xs text-green-700">
                Total contractual
              </p>

              <p className="mt-1 font-medium">
                {formatMoney(
                  checkinResult.paymentSummary.total,
                  business.currency,
                )}
              </p>
            </div>

            <div>
              <p className="text-xs text-green-700">
                Saldo pendiente
              </p>

              <p className="mt-1 font-medium">
                {formatMoney(
                  checkinResult.paymentSummary.balance,
                  business.currency,
                )}
              </p>
            </div>

            <div>
              <p className="text-xs text-green-700">
                Registrado por
              </p>

              <p className="mt-1 font-medium">
                {checkinResult.actor.name}
              </p>
            </div>
          </div>

          <p className="mt-3 text-green-800">
            Las fechas, los precios y las asignaciones contractuales permanecen
            sin cambios. Los recursos continuarán consumiendo inventario durante
            la estancia.
          </p>

          {checkinResult.resources.earlyIntervalExpanded && (
            <p className="mt-2 text-amber-800">
              La disponibilidad física también fue validada desde la hora real
              del ingreso anticipado.
            </p>
          )}

          {checkinResult.change.reason && (
            <p className="mt-2 text-green-800">
              Motivo: {checkinResult.change.reason}
            </p>
          )}
        </div>
      )}

      {noShowResult && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-semibold">
            Ausencia registrada correctamente
          </p>

          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-xs text-amber-700">
                Hora registrada
              </p>

              <p className="mt-1 font-medium">
                {formatDateTime(
                  noShowResult.noShow.markedNoShowAt,
                  business.timezone,
                )}
              </p>
            </div>

            <div>
              <p className="text-xs text-amber-700">
                Estado
              </p>

              <p className="mt-1 font-medium">
                {getStatusLabel(
                  noShowResult.reservation.status,
                )}
              </p>
            </div>

            <div>
              <p className="text-xs text-amber-700">
                Total contractual
              </p>

              <p className="mt-1 font-medium">
                {formatMoney(
                  noShowResult.paymentSummary.total,
                  business.currency,
                )}
              </p>
            </div>

            <div>
              <p className="text-xs text-amber-700">
                Saldo contractual
              </p>

              <p className="mt-1 font-medium">
                {formatMoney(
                  noShowResult.paymentSummary.balance,
                  business.currency,
                )}
              </p>
            </div>

            <div>
              <p className="text-xs text-amber-700">
                Recursos liberados
              </p>

              <p className="mt-1 font-medium">
                {
                  noShowResult.resources
                    .assignmentCount
                }
              </p>
            </div>

            <div>
              <p className="text-xs text-amber-700">
                Registrado por
              </p>

              <p className="mt-1 font-medium">
                {noShowResult.actor.name}
              </p>
            </div>
          </div>

          <p className="mt-3 text-amber-900">
            Las fechas, precios y asignaciones permanecen como evidencia
            histórica. Los recursos dejaron de consumir inventario y la reserva
            ya no acepta nuevos pagos.
          </p>

          {noShowResult.paymentSummary.refundPending > 0 && (
            <p className="mt-2 text-amber-800">
              Las devoluciones pendientes existentes todavía pueden continuar su
              flujo administrativo.
            </p>
          )}

          {noShowResult.change.reason && (
            <p className="mt-2 text-amber-900">
              Motivo: {noShowResult.change.reason}
            </p>
          )}
        </div>
      )}

      {checkoutResult && (
        <div className="mt-3 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-900">
          <p className="font-semibold">
            Check-out registrado correctamente
          </p>

          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-xs text-green-700">
                Hora registrada
              </p>

              <p className="mt-1 font-medium">
                {new Intl.DateTimeFormat(
                  "es-SV",
                  {
                    dateStyle:
                      "medium",

                    timeStyle:
                      "short",

                    timeZone:
                      business.timezone,
                  },
                ).format(
                  new Date(
                    checkoutResult.checkout.checkedOutAt,
                  ),
                )}
              </p>
            </div>

            <div>
              <p className="text-xs text-green-700">
                Tipo de salida
              </p>

              <p className="mt-1 font-medium">
                {checkoutResult.checkout.timing ===
                "EARLY"
                  ? "Anticipada"
                  : checkoutResult.checkout.timing ===
                      "ON_TIME"
                    ? "A la hora programada"
                    : "Posterior a la hora programada"}
              </p>
            </div>

            <div>
              <p className="text-xs text-green-700">
                Estado
              </p>

              <p className="mt-1 font-medium">
                {getStatusLabel(
                  checkoutResult.reservation.status,
                )}
              </p>
            </div>

            <div>
              <p className="text-xs text-green-700">
                Recursos liberados
              </p>

              <p className="mt-1 font-medium">
                {
                  checkoutResult.resources
                    .assignmentCount
                }
              </p>
            </div>

            <div>
              <p className="text-xs text-green-700">
                Total contractual
              </p>

              <p className="mt-1 font-medium">
                {formatMoney(
                  checkoutResult.paymentSummary.total,
                  business.currency,
                )}
              </p>
            </div>

            <div>
              <p className="text-xs text-green-700">
                Saldo pendiente
              </p>

              <p className="mt-1 font-medium">
                {formatMoney(
                  checkoutResult.paymentSummary.balance,
                  business.currency,
                )}
              </p>
            </div>
          </div>

          <p className="mt-3 text-green-800">
            Las asignaciones físicas permanecen en el historial, pero ya no
            consumen inventario operativo.
          </p>

          {checkoutResult.checkout.earlyCheckout && (
            <p className="mt-2 text-amber-800">
              La salida anticipada no modificó las fechas ni el total
              contractual de la reserva.
            </p>
          )}

          {checkoutResult.checkout.hasRefundPending && (
            <p className="mt-2 text-amber-800">
              La salida fue registrada, pero la reserva no podrá marcarse como
              completada hasta resolver la devolución pendiente.
            </p>
          )}
        </div>
      )}

      {completionResult && (
        <div className="mt-3 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-900">
          <p className="font-semibold">
            Reserva completada correctamente
          </p>

          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-xs text-green-700">
                Cierre registrado
              </p>

              <p className="mt-1 font-medium">
                {new Intl.DateTimeFormat(
                  "es-SV",
                  {
                    dateStyle:
                      "medium",

                    timeStyle:
                      "short",

                    timeZone:
                      business.timezone,
                  },
                ).format(
                  new Date(
                    completionResult.completion.completedAt,
                  ),
                )}
              </p>
            </div>

            <div>
              <p className="text-xs text-green-700">
                Estado
              </p>

              <p className="mt-1 font-medium">
                {getStatusLabel(
                  completionResult.reservation.status,
                )}
              </p>
            </div>

            <div>
              <p className="text-xs text-green-700">
                Total contractual
              </p>

              <p className="mt-1 font-medium">
                {formatMoney(
                  completionResult.paymentSummary.total,
                  business.currency,
                )}
              </p>
            </div>

            <div>
              <p className="text-xs text-green-700">
                Pago neto
              </p>

              <p className="mt-1 font-medium">
                {formatMoney(
                  completionResult.paymentSummary.netPaid,
                  business.currency,
                )}
              </p>
            </div>

            <div>
              <p className="text-xs text-green-700">
                Saldo pendiente
              </p>

              <p className="mt-1 font-medium">
                {formatMoney(
                  completionResult.paymentSummary.balance,
                  business.currency,
                )}
              </p>
            </div>

            <div>
              <p className="text-xs text-green-700">
                Registrado por
              </p>

              <p className="mt-1 font-medium">
                {completionResult.actor.name}
              </p>
            </div>

            <div>
              <p className="text-xs text-green-700">
                Asignaciones históricas
              </p>

              <p className="mt-1 font-medium">
                {
                  completionResult.resources
                    .assignmentCount
                }
              </p>
            </div>
          </div>

          <p className="mt-3 text-green-800">
            La reserva quedó cerrada administrativamente. Sus fechas, precios,
            pagos, devoluciones y asignaciones históricas permanecen sin cambios.
          </p>

          {completionResult.change.reason && (
            <p className="mt-2 text-green-800">
              Motivo: {completionResult.change.reason}
            </p>
          )}
        </div>
      )}

      {stayExtensionResult && (
        <div className="mt-3 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-900">
          <p className="font-semibold">
            Estancia extendida correctamente
          </p>

          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-xs text-green-700">
                Nueva salida
              </p>

              <p className="mt-1 font-medium">
                {formatDate(
                  stayExtensionResult.reservation.endAt,
                  business.timezone,
                )}
              </p>
            </div>

            <div>
              <p className="text-xs text-green-700">
                Noches agregadas
              </p>

              <p className="mt-1 font-medium">
                {stayExtensionResult.pricing.additionalNights}
              </p>
            </div>

            <div>
              <p className="text-xs text-green-700">
                Cargo de habitación
              </p>

              <p className="mt-1 font-medium">
                {formatMoney(
                  stayExtensionResult.pricing
                    .additionalServiceSubtotal,
                  business.currency,
                )}
              </p>
            </div>

            <div>
              <p className="text-xs text-green-700">
                Complementos heredados
              </p>

              <p className="mt-1 font-medium">
                {formatMoney(
                  stayExtensionResult.pricing
                    .additionalOptionSubtotal,
                  business.currency,
                )}
              </p>
            </div>

            <div>
              <p className="text-xs text-green-700">
                Cargo adicional
              </p>

              <p className="mt-1 font-medium">
                {formatMoney(
                  stayExtensionResult.pricing
                    .additionalCharge,
                  business.currency,
                )}
              </p>
            </div>

            <div>
              <p className="text-xs text-green-700">
                Nuevo total
              </p>

              <p className="mt-1 font-medium">
                {formatMoney(
                  stayExtensionResult.pricing.newTotal,
                  business.currency,
                )}
              </p>
            </div>

            <div>
              <p className="text-xs text-green-700">
                Saldo pendiente
              </p>

              <p className="mt-1 font-medium">
                {formatMoney(
                  stayExtensionResult.paymentSummary.balance,
                  business.currency,
                )}
              </p>
            </div>

            <div>
              <p className="text-xs text-green-700">
                Recursos conservados
              </p>

              <p className="mt-1 font-medium">
                {stayExtensionResult.resources.kept.length}
              </p>
            </div>
          </div>

          <p className="mt-3 text-green-800">
            La reserva conserva su estado de check-in y sus recursos asignados.
          </p>
        </div>
      )}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Total
          </p>

          <p className="mt-2 text-2xl font-semibold">
            {formatMoney(reservation.total, business.currency)}
          </p>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Pagado neto
          </p>

          <p className="mt-2 text-2xl font-semibold">
            {formatMoney(paymentSummary.netPaid, business.currency)}
          </p>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Pendiente
          </p>

          <p className="mt-2 text-2xl font-semibold">
            {formatMoney(financialState.amountDue, business.currency)}
          </p>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Devuelto
          </p>

          <p className="mt-2 text-2xl font-semibold">
            {formatMoney(paymentSummary.refunded, business.currency)}
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.8fr)]">
        <div className="space-y-6">
          <section className="rounded-xl border border-zinc-200 bg-white">
            <div className="border-b border-zinc-200 px-5 py-4">
              <h2 className="font-semibold">Estancia y servicio</h2>
            </div>

            <div className="grid gap-6 p-5 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Entrada
                </p>

                <p className="mt-2 font-medium">
                  {formatDate(reservation.startAt, business.timezone)}
                </p>

                {business.checkInTime && (
                  <p className="mt-1 text-sm text-zinc-500">
                    Check-in {business.checkInTime}
                  </p>
                )}
              </div>

              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Salida
                </p>

                <p className="mt-2 font-medium">
                  {formatDate(reservation.endAt, business.timezone)}
                </p>

                {business.checkOutTime && (
                  <p className="mt-1 text-sm text-zinc-500">
                    Check-out {business.checkOutTime}
                  </p>
                )}

                {checkoutDue && (
                  <p className="mt-2 text-sm font-medium text-amber-700">
                    La salida programada ya venció. Confirma el check-out
                    cuando el huésped haya salido.
                  </p>
                )}
              </div>

              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Huéspedes
                </p>

                <p className="mt-2 font-medium">{reservation.guests}</p>

                <p className="mt-1 text-sm text-zinc-500">
                  {reservation.adults ?? 0} adulto(s) ·{" "}
                  {reservation.children ?? 0} niño(s)
                </p>
              </div>

              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Modalidad
                </p>

                <p className="mt-2 font-medium">
                  {getPaymentOptionLabel(reservation.paymentOption)}
                </p>

                <p className="mt-1 text-sm text-zinc-500">
                  Origen: {reservation.source ?? "No definido"}
                </p>
              </div>
            </div>

            <div className="border-t border-zinc-200">
              {data.services.map((service) => (
                <div key={service.id} className="p-5">
                  <div className="flex flex-col justify-between gap-3 sm:flex-row">
                    <div>
                      <p className="font-semibold">{service.name}</p>

                      <p className="mt-1 text-sm text-zinc-500">
                        Cantidad: {service.quantity}
                      </p>
                    </div>

                    <p className="font-medium">
                      {formatMoney(service.subtotal, business.currency)}
                    </p>
                  </div>

                  <div className="mt-4 rounded-lg bg-zinc-50 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                      Recursos asignados
                    </p>

                    {service.resources.length > 0 ? (
                      <div className="mt-3 space-y-2">
                        {service.resources.map((resource) => (
                          <div
                            key={resource.assignmentId}
                            className="flex justify-between gap-4 text-sm"
                          >
                            <span className="font-medium">{resource.name}</span>

                            <span className="text-zinc-500">
                              {resource.resourceType?.name ?? "Sin tipo"}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-zinc-500">
                        Sin recurso asignado.
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-zinc-200 bg-white">
            <div className="flex flex-col justify-between gap-3 border-b border-zinc-200 px-5 py-4 sm:flex-row sm:items-center">
              <div>
                <h2 className="font-semibold">Complementos</h2>

                <p className="mt-1 text-sm text-zinc-500">
                  Opciones incluidas y adicionales asociadas a esta reserva.
                </p>
              </div>

              {canAddOptions && (
                <button
                  type="button"
                  disabled={financialState.hasRefundPending}
                  onClick={() => void openOptionDialog()}
                  className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
                >
                  + Agregar complemento
                </button>
              )}
            </div>

            {financialState.hasRefundPending && canAddOptions && (
              <div className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-800">
                No se pueden agregar complementos mientras exista una devolución pendiente o en proceso.
              </div>
            )}

            {optionAddSuccess && (
              <div className="border-b border-emerald-200 bg-emerald-50 px-5 py-3 text-sm text-emerald-800">
                {optionAddSuccess}
              </div>
            )}

            {optionRemoveSuccess && (
              <div className="border-b border-emerald-200 bg-emerald-50 px-5 py-3 text-sm text-emerald-800">
                {optionRemoveSuccess}
              </div>
            )}

            {!optionDialogOpen && optionAddError && (
              <div className="border-b border-red-200 bg-red-50 px-5 py-3 text-sm text-red-700">
                {optionAddError}
              </div>
            )}


            {!optionRemoveDialogOpen && optionRemoveError && (
              <div className="border-b border-red-200 bg-red-50 px-5 py-3 text-sm text-red-700">
                {optionRemoveError}
              </div>
            )}

            {reservationOptionGroups.filter((option) => option.activeQuantity > 0).length === 0 ? (
              <p className="p-5 text-sm text-zinc-500">
                Esta reserva no tiene complementos registrados.
              </p>
            ) : (
              <div className="divide-y divide-zinc-100">
                {reservationOptionGroups.filter((option) => option.activeQuantity > 0).map((option) => (
                  <div key={option.id} className="p-5">
                    <div className="flex flex-col justify-between gap-4 sm:flex-row">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold">{option.name}</p>

                          {option.includedQuantity > 0 && (
                            <span className="rounded-full bg-zinc-100 px-2 py-1 text-xs font-medium">
                              Incluido
                            </span>
                          )}

                          {option.optionalQuantity > 0 && (
                            <span className="rounded-full bg-zinc-100 px-2 py-1 text-xs font-medium">
                              Adicional
                            </span>
                          )}
                        </div>

                        {option.description && (
                          <p className="mt-2 text-sm text-zinc-500">
                            {option.description}
                          </p>
                        )}

                        <div className="mt-3 space-y-1 text-sm text-zinc-600">
                          <p>
                            Cantidad original: {option.quantity}
                          </p>

                          {option.includedQuantity > 0 && (
                            <p>
                              Incluida: {option.includedQuantity}
                            </p>
                          )}

                          {option.optionalQuantity > 0 && (
                            <p>
                              Opcional original: {option.optionalQuantity}
                            </p>
                          )}

                          {option.removedOptionalQuantity > 0 && (
                            <p>
                              Retirada: {option.removedOptionalQuantity}
                            </p>
                          )}

                          {option.optionalQuantity > 0 && (
                            <p>
                              Opcional activa: {option.activeOptionalQuantity}
                            </p>
                          )}

                          <p>
                            Cantidad activa: {option.activeQuantity}
                          </p>

                          {option.memberCount > 1 && (
                            <p>
                              Movimientos acumulados: {option.memberCount}
                            </p>
                          )}

                          {option.hasMixedPricing ? (
                            <p>
                              Precio y modalidad: varios movimientos históricos
                            </p>
                          ) : (
                            <>
                              {option.optionalQuantity > 0 && (
                                <p>
                                  Precio adicional unitario:{" "}
                                  {formatMoney(
                                    option.unitPrice,
                                    business.currency,
                                  )}
                                </p>
                              )}

                              <p>
                                Modalidad:{" "}
                                {option.pricingBase.replaceAll("_", " ")} ·{" "}
                                {option.pricingFrequency.replaceAll("_", " ")}
                              </p>

                              <p>
                                Unidades de cobro: {option.billingUnits}
                              </p>
                            </>
                          )}
                        </div>

                        {option.startAt && option.endAt && (
                          <div className="mt-3 text-sm text-zinc-500">
                            <p>
                              Desde{" "}
                              {formatDateTime(
                                option.startAt,
                                business.timezone,
                              )}
                            </p>

                            <p>
                              Hasta{" "}
                              {formatDateTime(
                                option.endAt,
                                business.timezone,
                              )}
                            </p>
                          </div>
                        )}

                        {option.resources.length > 0 && (
                          <div className="mt-4 rounded-lg bg-zinc-50 p-4">
                            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                              Recursos asignados
                            </p>

                            <div className="mt-3 space-y-2">
                              {option.resources.map((resource) => (
                                <div
                                  key={resource.assignmentId}
                                  className="flex justify-between gap-4 text-sm"
                                >
                                  <span className="font-medium">
                                    {resource.name}
                                  </span>

                                  <span className="text-zinc-500">
                                    {resource.resourceType?.name ?? "Sin tipo"}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="sm:text-right">
                        <p className="font-medium">
                          {formatMoney(option.subtotal, business.currency)}
                        </p>
                        {option.isFullyRemoved && (
                          <p className="mt-1 text-xs font-medium text-zinc-500">
                            Retirado completamente
                          </p>
                        )}

                        {option.includedQuantity > 0 &&
                          option.activeOptionalQuantity === 0 && (
                            <p className="mt-1 text-xs text-zinc-500">
                              Sin cargo adicional
                            </p>
                          )}

                        {canRemoveOptions &&
                          option.activeOptionalQuantity > 0 && (
                            <button
                              type="button"
                              disabled={
                                financialState.hasRefundPending
                              }
                              onClick={() =>
                                openOptionRemoveDialog(
                                  option.id,
                                )
                              }
                              className="mt-3 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Reducir / quitar
                            </button>
                          )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
          {optionDialogOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-xl">
                <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
                  <div>
                    <h2 className="font-semibold">
                      Agregar complemento
                    </h2>

                    <p className="mt-1 text-sm text-zinc-500">
                      El precio final y el inventario serán validados nuevamente por el servidor.
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={optionAddSubmitting}
                    onClick={() => {
                      setOptionDialogOpen(false);
                      setOptionAddError(null);
                    }}
                    className="rounded-lg border border-zinc-300 px-3 py-2 text-sm disabled:opacity-50"
                  >
                    Cerrar
                  </button>
                </div>

                <div className="space-y-5 p-5">
                  {optionCatalogLoading ? (
                    <p className="text-sm text-zinc-500">
                      Cargando complementos disponibles...
                    </p>
                  ) : postBookingOptions.length === 0 ? (
                    <p className="rounded-lg bg-zinc-50 p-4 text-sm text-zinc-600">
                      No hay complementos adicionales disponibles para este servicio.
                    </p>
                  ) : (
                    <>
                      <div>
                        <label
                          htmlFor="post-booking-option"
                          className="text-sm font-medium"
                        >
                          Complemento
                        </label>

                        <select
                          id="post-booking-option"
                          value={selectedPostBookingOptionId}
                          disabled={optionAddSubmitting}
                          onChange={(event) =>
                            handlePostBookingOptionSelection(
                              event.target.value,
                            )
                          }
                          className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
                        >
                          {postBookingOptions.map((option) => (
                            <option
                              key={option.serviceOptionId}
                              value={option.serviceOptionId}
                            >
                              {option.optionName}
                            </option>
                          ))}
                        </select>
                      </div>

                      {selectedPostBookingOption && (
                        <div className="rounded-lg bg-zinc-50 p-4">
                          <div className="flex flex-col justify-between gap-3 sm:flex-row">
                            <div>
                              <p className="font-medium">
                                {selectedPostBookingOption.optionName}
                              </p>

                              {selectedPostBookingOption.description && (
                                <p className="mt-1 text-sm text-zinc-500">
                                  {selectedPostBookingOption.description}
                                </p>
                              )}
                            </div>

                            <div className="sm:text-right">
                              <p className="font-medium">
                                {formatMoney(
                                  selectedPostBookingOption.price,
                                  business.currency,
                                )}
                              </p>

                              <p className="mt-1 text-xs text-zinc-500">
                                Precio configurado
                              </p>
                            </div>
                          </div>

                          <div className="mt-3 space-y-1 text-sm text-zinc-600">
                            <p>
                              Modalidad:{" "}
                              {selectedPostBookingOption.pricingBase.replaceAll(
                                "_",
                                " ",
                              )}{" "}
                              ·{" "}
                              {selectedPostBookingOption.pricingFrequency.replaceAll(
                                "_",
                                " ",
                              )}
                            </p>

                            <p>
                              Cantidad opcional ya registrada:{" "}
                              {selectedExistingOptionalQuantity}
                            </p>

                            <p>
                              Mínimo acumulado:{" "}
                              {selectedPostBookingOption.minOptionalQuantity}
                            </p>

                            <p>
                              Máximo acumulado:{" "}
                              {selectedPostBookingOption.maxOptionalQuantity ??
                                "Sin límite configurado"}
                            </p>

                            {selectedPostBookingOption.isIncluded && (
                              <p>
                                La cantidad incluida original no volverá a generarse.
                              </p>
                            )}

                            {selectedPostBookingOption.resourceTypes.length > 0 && (
                              <div className="pt-2">
                                <p className="font-medium">
                                  Inventario físico requerido
                                </p>

                                <ul className="mt-1 list-disc space-y-1 pl-5">
                                  {selectedPostBookingOption.resourceTypes.map(
                                    (requirement) => (
                                      <li key={requirement.resourceTypeId}>
                                        {requirement.name}:{" "}
                                        {requirement.requiredQuantity} por unidad ·{" "}
                                        {requirement.activeResourceCount} recurso(s) activo(s)
                                      </li>
                                    ),
                                  )}
                                </ul>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      <div>
                        <label
                          htmlFor="post-booking-option-quantity"
                          className="text-sm font-medium"
                        >
                          Cantidad a agregar
                        </label>

                        <input
                          id="post-booking-option-quantity"
                          type="number"
                          min={1}
                          max={
                            selectedMaximumAdditionalQuantity ??
                            undefined
                          }
                          step={1}
                          value={optionQuantity}
                          disabled={optionAddSubmitting}
                          onChange={(event) =>
                            setOptionQuantity(
                              event.target.value,
                            )
                          }
                          className="mt-2 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                        />

                        {selectedMaximumAdditionalQuantity !== null && (
                          <p className="mt-1 text-xs text-zinc-500">
                            Máximo disponible según configuración:{" "}
                            {selectedMaximumAdditionalQuantity} unidad(es) adicionales.
                          </p>
                        )}
                      </div>

                      {selectedRequiresOwnInterval ? (
                        <div className="rounded-lg border border-zinc-200 p-4">
                          <p className="text-sm font-medium">
                            Intervalo requerido
                          </p>

                          <p className="mt-1 text-xs text-zinc-500">
                            Este complemento se cobra por hora y necesita fecha y hora de inicio y fin.
                          </p>
                        </div>
                      ) : (
                        <label className="flex items-start gap-3 rounded-lg border border-zinc-200 p-4">
                          <input
                            type="checkbox"
                            checked={optionOwnInterval}
                            disabled={optionAddSubmitting}
                            onChange={(event) =>
                              setOptionOwnInterval(
                                event.target.checked,
                              )
                            }
                            className="mt-1"
                          />

                          <span>
                            <span className="block text-sm font-medium">
                              Usar un intervalo específico
                            </span>

                            <span className="mt-1 block text-xs text-zinc-500">
                              Si no se activa, heredará el intervalo completo de la reserva.
                            </span>
                          </span>
                        </label>
                      )}

                      {(selectedRequiresOwnInterval ||
                        optionOwnInterval) && (
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div>
                            <label
                              htmlFor="post-booking-option-start"
                              className="text-sm font-medium"
                            >
                              Inicio
                            </label>

                            <input
                              id="post-booking-option-start"
                              type="datetime-local"
                              value={optionStartAt}
                              disabled={optionAddSubmitting}
                              onChange={(event) =>
                                setOptionStartAt(
                                  event.target.value,
                                )
                              }
                              className="mt-2 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                            />
                          </div>

                          <div>
                            <label
                              htmlFor="post-booking-option-end"
                              className="text-sm font-medium"
                            >
                              Fin
                            </label>

                            <input
                              id="post-booking-option-end"
                              type="datetime-local"
                              value={optionEndAt}
                              disabled={optionAddSubmitting}
                              onChange={(event) =>
                                setOptionEndAt(
                                  event.target.value,
                                )
                              }
                              className="mt-2 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                            />
                          </div>

                          <p className="text-xs text-zinc-500 sm:col-span-2">
                            Zona horaria: {business.timezone}.
                          </p>
                        </div>
                      )}

                      <div>
                        <label
                          htmlFor="post-booking-option-reason"
                          className="text-sm font-medium"
                        >
                          Motivo o nota
                        </label>

                        <textarea
                          id="post-booking-option-reason"
                          value={optionAddReason}
                          disabled={optionAddSubmitting}
                          onChange={(event) =>
                            setOptionAddReason(
                              event.target.value,
                            )
                          }
                          rows={3}
                          placeholder="Ej. El huésped solicita un parking adicional."
                          className="mt-2 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                        />
                      </div>
                    </>
                  )}

                  {optionAddError && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                      {optionAddError}
                    </div>
                  )}
                </div>

                <div className="flex flex-col-reverse gap-3 border-t border-zinc-200 px-5 py-4 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    disabled={optionAddSubmitting}
                    onClick={() => {
                      setOptionDialogOpen(false);
                      setOptionAddError(null);
                    }}
                    className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium disabled:opacity-50"
                  >
                    Cancelar
                  </button>

                  <button
                    type="button"
                    disabled={
                      optionAddSubmitting ||
                      optionCatalogLoading ||
                      !selectedPostBookingOption ||
                      postBookingOptions.length === 0
                    }
                    onClick={() =>
                      void handleAddReservationOption()
                    }
                    className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {optionAddSubmitting
                      ? "Agregando..."
                      : "Agregar complemento"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {optionRemoveDialogOpen && selectedReservationOption && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white shadow-xl">
                <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4">
                  <div>
                    <h2 className="font-semibold">
                      Reducir / quitar complemento
                    </h2>

                    <p className="mt-1 text-sm text-zinc-500">
                      {selectedReservationOption.name}
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={optionRemoveSubmitting}
                    onClick={() => {
                      setOptionRemoveDialogOpen(false);
                      setSelectedReservationOptionId("");
                      setOptionRemoveQuantity("1");
                      setOptionRemoveReason("");
                      setOptionRemoveError(null);
                    }}
                    className="rounded-lg border border-zinc-300 px-3 py-2 text-sm disabled:opacity-50"
                  >
                    Cerrar
                  </button>
                </div>

                <div className="space-y-5 p-5">
                  <div className="rounded-lg bg-zinc-50 p-4 text-sm text-zinc-600">
                    <p>
                      Opcional original:{" "}
                      {selectedReservationOption.optionalQuantity}
                    </p>

                    {selectedReservationOption.removedOptionalQuantity > 0 && (
                      <p>
                        Retirada anteriormente:{" "}
                        {selectedReservationOption.removedOptionalQuantity}
                      </p>
                    )}

                    <p>
                      Opcional activa:{" "}
                      {selectedReservationOption.activeOptionalQuantity}
                    </p>

                    {selectedReservationOption.includedQuantity > 0 && (
                      <p>
                        Incluida:{" "}
                        {selectedReservationOption.includedQuantity}
                      </p>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="reservation-option-remove-quantity"
                      className="text-sm font-medium"
                    >
                      Cantidad a retirar
                    </label>

                    <input
                      id="reservation-option-remove-quantity"
                      type="number"
                      min={1}
                      max={
                        selectedReservationOption.activeOptionalQuantity
                      }
                      value={optionRemoveQuantity}
                      disabled={optionRemoveSubmitting}
                      onChange={(event) => {
                        setOptionRemoveQuantity(
                          event.target.value,
                        );

                        setOptionRemoveError(null);
                      }}
                      className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
                    />

                    <p className="mt-2 text-xs text-zinc-500">
                      Puedes retirar entre 1 y{" "}
                      {selectedReservationOption.activeOptionalQuantity}.
                    </p>
                  </div>

                  {Number(optionRemoveQuantity) ===
                    selectedReservationOption.activeOptionalQuantity &&
                    selectedReservationOption.activeOptionalQuantity > 0 && (
                      <div className="rounded-lg bg-zinc-50 p-4 text-sm text-zinc-600">
                        Se retirará toda la cantidad opcional activa de este
                        complemento. Sus movimientos históricos permanecerán
                        en la reserva.
                      </div>
                    )}

                  <div>
                    <label
                      htmlFor="reservation-option-remove-reason"
                      className="text-sm font-medium"
                    >
                      Motivo
                      <span className="ml-1 font-normal text-zinc-500">
                        (opcional)
                      </span>
                    </label>

                    <textarea
                      id="reservation-option-remove-reason"
                      rows={3}
                      value={optionRemoveReason}
                      disabled={optionRemoveSubmitting}
                      onChange={(event) =>
                        setOptionRemoveReason(
                          event.target.value,
                        )
                      }
                      className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
                      placeholder="Ej. El huésped ya no necesita este complemento"
                    />
                  </div>

                  {financialState.hasRefundPending && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                      No se puede modificar el complemento mientras exista
                      una devolución pendiente o en proceso.
                    </div>
                  )}

                  {optionRemoveError && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                      {optionRemoveError}
                    </div>
                  )}
                </div>

                <div className="flex flex-col-reverse gap-3 border-t border-zinc-200 px-5 py-4 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    disabled={optionRemoveSubmitting}
                    onClick={() => {
                      setOptionRemoveDialogOpen(false);
                      setSelectedReservationOptionId("");
                      setOptionRemoveQuantity("1");
                      setOptionRemoveReason("");
                      setOptionRemoveError(null);
                    }}
                    className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium disabled:opacity-50"
                  >
                    Cancelar
                  </button>

                  <button
                    type="button"
                    disabled={
                      optionRemoveSubmitting ||
                      financialState.hasRefundPending ||
                      !Number.isInteger(
                        Number(optionRemoveQuantity),
                      ) ||
                      Number(optionRemoveQuantity) <= 0 ||
                      Number(optionRemoveQuantity) >
                        selectedReservationOption.activeOptionalQuantity
                    }
                    onClick={() =>
                      void handleRemoveReservationOption()
                    }
                    className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {optionRemoveSubmitting
                      ? "Procesando..."
                      : Number(optionRemoveQuantity) ===
                            selectedReservationOption.activeOptionalQuantity
                        ? selectedReservationOption.includedQuantity === 0
                          ? "Quitar complemento"
                          : "Retirar adicionales"
                        : "Reducir complemento"}
                  </button>
                </div>
              </div>
            </div>
          )}

          <section className="rounded-xl border border-zinc-200 bg-white">
            <div className="border-b border-zinc-200 px-5 py-4">
              <h2 className="font-semibold">Pagos</h2>
            </div>

            {data.payments.length === 0 ? (
              <p className="p-5 text-sm text-zinc-500">
                Esta reserva no tiene pagos registrados.
              </p>
            ) : (
              <div className="divide-y divide-zinc-100">
                {data.payments.map((payment) => (
                  <div key={payment.id} className="p-5">
                    <div className="flex flex-col justify-between gap-3 sm:flex-row">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">
                            {formatMoney(payment.amount, business.currency)}
                          </p>

                          <span className="rounded-full bg-zinc-100 px-2 py-1 text-xs font-medium">
                            {getStatusLabel(payment.status)}
                          </span>
                        </div>

                        <p className="mt-1 text-sm text-zinc-500">
                          {payment.method.replaceAll("_", " ")}
                        </p>
                      </div>

                      <div className="text-sm text-zinc-500 sm:text-right">
                        {payment.paidAt && (
                          <p>
                            Pagado{" "}
                            {formatDateTime(payment.paidAt, business.timezone)}
                          </p>
                        )}

                        {payment.externalReference && (
                          <p className="mt-1">
                            Ref. {payment.externalReference}
                          </p>
                        )}
                      </div>
                    </div>

                    {payment.status === "PENDING" &&
                      payment.method === "BANK_TRANSFER" && (
                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={paymentProcessingId === payment.id}
                            onClick={() =>
                              void handlePaymentStatusChange(payment.id, "PAID")
                            }
                            className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
                          >
                            {paymentProcessingId === payment.id
                              ? "Procesando..."
                              : "Confirmar transferencia"}
                          </button>

                          <button
                            type="button"
                            disabled={paymentProcessingId === payment.id}
                            onClick={() =>
                              void handlePaymentStatusChange(
                                payment.id,
                                "FAILED",
                              )
                            }
                            className="rounded-lg border border-zinc-300 px-3 py-2 text-xs font-medium disabled:opacity-50"
                          >
                            Marcar fallida
                          </button>
                        </div>
                      )}

                    {payment.status === "PENDING" &&
                      payment.method === "CARD" && (
                        <p className="mt-4 text-xs text-zinc-500">
                          Pendiente de confirmación del proveedor de pagos.
                        </p>
                      )}

                    {payment.refunds.length > 0 && (
                      <div className="mt-4 rounded-lg bg-zinc-50 p-4">
                        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                          Devoluciones de este pago
                        </p>

                        <div className="mt-3 space-y-2">
                          {payment.refunds.map((refund) => (
                            <div
                              key={refund.id}
                              className="flex flex-col justify-between gap-1 text-sm sm:flex-row"
                            >
                              <span>{refund.basis.replaceAll("_", " ")}</span>

                              <span className="font-medium">
                                {formatMoney(refund.amount, business.currency)}{" "}
                                · {getStatusLabel(refund.status)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-zinc-200 bg-white">
            <div className="border-b border-zinc-200 px-5 py-4">
              <h2 className="font-semibold">Historial</h2>
            </div>

            {data.changes.length === 0 ? (
              <p className="p-5 text-sm text-zinc-500">
                No hay cambios registrados.
              </p>
            ) : (
              <div className="divide-y divide-zinc-100">
                {data.changes.map((change) => (
                  <div key={change.id} className="p-5">
                    <div className="flex flex-col justify-between gap-2 sm:flex-row">
                      <div>
                        <p className="font-medium">
                          {getReservationChangeTypeLabel(change.type)}
                        </p>

                        {change.reason && (
                          <p className="mt-1 text-sm text-zinc-500">
                            {change.reason}
                          </p>
                        )}
                      </div>

                      <p className="text-sm text-zinc-500">
                        {formatDateTime(change.createdAt, business.timezone)}
                      </p>
                    </div>

                    {(change.oldStartAt || change.newStartAt) && (
                      <p className="mt-3 text-sm">
                        {change.oldStartAt
                          ? formatDate(change.oldStartAt, business.timezone)
                          : "—"}
                        {" → "}
                        {change.newStartAt
                          ? formatDate(change.newStartAt, business.timezone)
                          : "—"}
                      </p>
                    )}

                    {change.oldTotal !== null && change.newTotal !== null && (
                      <p className="mt-1 text-sm text-zinc-500">
                        {formatMoney(change.oldTotal, business.currency)}
                        {" → "}
                        {formatMoney(change.newTotal, business.currency)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="space-y-6">
          <section className="rounded-xl border border-zinc-200 bg-white">
            <div className="border-b border-zinc-200 px-5 py-4">
              <h2 className="font-semibold">Huésped</h2>
            </div>

            <div className="space-y-4 p-5">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Nombre
                </p>

                <p className="mt-1 font-medium">
                  {customer.firstName} {customer.lastName}
                </p>
              </div>

              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Email
                </p>

                <p className="mt-1 text-sm">{customer.email ?? "Sin email"}</p>
              </div>

              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Teléfono
                </p>

                <p className="mt-1 text-sm">
                  {customer.phone ?? "Sin teléfono"}
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-zinc-200 bg-white">
            <div className="border-b border-zinc-200 px-5 py-4">
              <h2 className="font-semibold">Estado financiero</h2>
            </div>

            <div className="space-y-3 p-5 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-zinc-500">Pagos brutos</span>

                <span className="font-medium">
                  {formatMoney(paymentSummary.grossPaid, business.currency)}
                </span>
              </div>

              <div className="flex justify-between gap-4">
                <span className="text-zinc-500">Reembolsado</span>

                <span className="font-medium">
                  {formatMoney(paymentSummary.refunded, business.currency)}
                </span>
              </div>

              <div className="flex justify-between gap-4">
                <span className="text-zinc-500">Refund pendiente</span>

                <span className="font-medium">
                  {formatMoney(paymentSummary.refundPending, business.currency)}
                </span>
              </div>

              <div className="flex justify-between gap-4 border-t border-zinc-200 pt-3">
                <span className="font-medium">Pagado neto</span>

                <span className="font-semibold">
                  {formatMoney(paymentSummary.netPaid, business.currency)}
                </span>
              </div>

              <div className="flex justify-between gap-4">
                <span className="font-medium">Monto exigible</span>

                <span className="font-semibold">
                  {formatMoney(financialState.amountDue, business.currency)}
                </span>
              </div>
            </div>
          </section>

          {refundGroups.length > 0 && (
            <section className="rounded-xl border border-zinc-200 bg-white">
              <div className="border-b border-zinc-200 px-5 py-4">
                <h2 className="font-semibold">Devoluciones</h2>
              </div>

              <div className="divide-y divide-zinc-100">
                {refundGroups.map((group) => {
                  const actions = getRefundGroupActions(group);

                  return (
                    <div key={group.key} className="p-5">
                      <div className="flex justify-between gap-3">
                        <div>
                          <p className="font-medium">
                            {group.basis.replaceAll("_", " ")}
                          </p>

                          <p className="mt-1 text-sm text-zinc-500">
                            {group.displayStatus === "MIXED"
                              ? "Estados mixtos"
                              : getStatusLabel(group.displayStatus)}
                          </p>

                          {group.refunds.length > 1 && (
                            <p className="mt-1 text-xs text-zinc-500">
                              {group.refunds.length} movimientos internos
                              asociados
                            </p>
                          )}
                        </div>

                        <p className="font-semibold">
                          {formatMoney(group.amount, business.currency)}
                        </p>
                      </div>

                      {actions.length > 0 && (
                        <div className="mt-4 flex flex-wrap gap-2">
                          {actions.map((action) => (
                            <button
                              key={action.status}
                              type="button"
                              onClick={() =>
                                openRefundGroupDialog(group, action.status)
                              }
                              className="rounded-lg border border-zinc-300 px-3 py-2 text-xs font-medium"
                            >
                              {action.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {data.cancellation && (
            <section className="rounded-xl border border-zinc-200 bg-white">
              <div className="border-b border-zinc-200 px-5 py-4">
                <h2 className="font-semibold">Cancelación</h2>
              </div>

              <div className="space-y-3 p-5 text-sm">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Tipo
                  </p>

                  <p className="mt-1 font-medium">
                    {data.cancellation.type.replaceAll("_", " ")}
                  </p>
                </div>

                {data.cancellation.reason && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                      Motivo
                    </p>

                    <p className="mt-1">{data.cancellation.reason}</p>
                  </div>
                )}

                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Fecha
                  </p>

                  <p className="mt-1">
                    {formatDateTime(
                      data.cancellation.cancelledAt,
                      business.timezone,
                    )}
                  </p>
                </div>
              </div>
            </section>
          )}

          {reservation.specialRequests && (
            <section className="rounded-xl border border-zinc-200 bg-white p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Solicitudes especiales
              </p>

              <p className="mt-2 text-sm leading-6">
                {reservation.specialRequests}
              </p>
            </section>
          )}
        </div>
      </div>
      {confirmationDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white shadow-xl">
            <div className="border-b border-zinc-200 px-5 py-4">
              <h2 className="font-semibold">
                Confirmar reserva
              </h2>

              <p className="mt-1 text-sm text-zinc-500">
                Reserva {
                  reservation
                    .confirmationCode
                }
              </p>
            </div>

            <div className="space-y-5 p-5">
              <div className="grid gap-3 rounded-lg bg-zinc-50 p-4 text-sm sm:grid-cols-2">
                <div>
                  <p className="text-zinc-500">
                    Inicio programado
                  </p>

                  <p className="mt-1 font-medium">
                    {formatDateTime(
                      reservation.startAt,
                      business.timezone,
                    )}
                  </p>
                </div>

                <div>
                  <p className="text-zinc-500">
                    Fin programado
                  </p>

                  <p className="mt-1 font-medium">
                    {formatDateTime(
                      reservation.endAt,
                      business.timezone,
                    )}
                  </p>
                </div>

                <div>
                  <p className="text-zinc-500">
                    Total contractual
                  </p>

                  <p className="mt-1 font-medium">
                    {formatMoney(
                      paymentSummary.total,
                      business.currency,
                    )}
                  </p>
                </div>

                <div>
                  <p className="text-zinc-500">
                    Pago inicial requerido
                  </p>

                  <p className="mt-1 font-medium">
                    {paymentSummary
                      .requiredInitialPayment ===
                    null
                      ? "No definido"
                      : formatMoney(
                          paymentSummary
                            .requiredInitialPayment,
                          business.currency,
                        )}
                  </p>
                </div>

                <div>
                  <p className="text-zinc-500">
                    Pago neto registrado
                  </p>

                  <p className="mt-1 font-medium">
                    {formatMoney(
                      paymentSummary.netPaid,
                      business.currency,
                    )}
                  </p>
                </div>

                <div>
                  <p className="text-zinc-500">
                    Pago inicial pendiente
                  </p>

                  <p className="mt-1 font-medium">
                    {formatMoney(
                      paymentSummary
                        .initialPaymentRemaining ??
                        0,
                      business.currency,
                    )}
                  </p>
                </div>

                <div>
                  <p className="text-zinc-500">
                    Saldo contractual restante
                  </p>

                  <p className="mt-1 font-medium">
                    {formatMoney(
                      paymentSummary.balance,
                      business.currency,
                    )}
                  </p>
                </div>
              </div>

              {confirmationBlockedByInitialPayment && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-700">
                  Debes cubrir el pago inicial requerido antes de confirmar la
                  reserva.
                </div>
              )}

              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm leading-6 text-emerald-800">
                La confirmación conservará las fechas, precios, complementos y
                asignaciones actuales. La reserva seguirá consumiendo inventario
                y cualquier saldo restante podrá cobrarse después.
              </div>

              <label className="flex flex-col gap-2 text-sm">
                <span className="font-medium">
                  Motivo (opcional)
                </span>

                <textarea
                  rows={3}
                  maxLength={1000}
                  value={
                    confirmationReason
                  }
                  onChange={(event) =>
                    setConfirmationReason(
                      event.target.value,
                    )
                  }
                  placeholder="Ej. pago inicial verificado y reserva aprobada"
                  className="rounded-lg border border-zinc-300 px-3 py-2"
                />
              </label>

              {confirmationError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">
                  {confirmationError}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 border-t border-zinc-200 px-5 py-4">
              <button
                type="button"
                disabled={
                  confirmationSubmitting
                }
                onClick={() => {
                  setConfirmationDialogOpen(
                    false,
                  );

                  setConfirmationError(
                    null,
                  );
                }}
                className="h-10 rounded-lg border border-zinc-300 px-4 text-sm font-medium disabled:opacity-50"
              >
                Cancelar
              </button>

              <button
                type="button"
                disabled={
                  confirmationSubmitting ||
                  confirmationBlockedByInitialPayment
                }
                onClick={() =>
                  void handleConfirmation()
                }
                className="h-10 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {confirmationSubmitting
                  ? "Confirmando..."
                  : "Confirmar reserva"}
              </button>
            </div>
          </div>
        </div>
      )}

      {checkinDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white shadow-xl">
            <div className="border-b border-zinc-200 px-5 py-4">
              <h2 className="font-semibold">
                Registrar check-in
              </h2>

              <p className="mt-1 text-sm text-zinc-500">
                Reserva {reservation.confirmationCode}
              </p>
            </div>

            <div className="space-y-5 p-5">
              <div className="grid gap-3 rounded-lg bg-zinc-50 p-4 text-sm sm:grid-cols-2">
                <div>
                  <p className="text-zinc-500">
                    Entrada programada
                  </p>

                  <p className="mt-1 font-medium">
                    {formatDateTime(
                      reservation.startAt,
                      business.timezone,
                    )}
                  </p>
                </div>

                <div>
                  <p className="text-zinc-500">
                    Salida programada
                  </p>

                  <p className="mt-1 font-medium">
                    {formatDateTime(
                      reservation.endAt,
                      business.timezone,
                    )}
                  </p>
                </div>

                <div>
                  <p className="text-zinc-500">
                    Pago inicial requerido
                  </p>

                  <p className="mt-1 font-medium">
                    {paymentSummary.requiredInitialPayment ===
                    null
                      ? "No definido"
                      : formatMoney(
                          paymentSummary.requiredInitialPayment,
                          business.currency,
                        )}
                  </p>
                </div>

                <div>
                  <p className="text-zinc-500">
                    Pago inicial pendiente
                  </p>

                  <p className="mt-1 font-medium">
                    {formatMoney(
                      paymentSummary.initialPaymentRemaining ??
                        0,
                      business.currency,
                    )}
                  </p>
                </div>
              </div>

              {checkinWindowClosed && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-700">
                  La salida programada ya venció. No puede registrarse check-in;
                  debes gestionar la reserva como no presentada.
                </div>
              )}

              {checkinIsEarly && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-800">
                  Este será un ingreso anticipado. Las fechas y el total
                  contractual permanecerán sin cambios, se ampliará la
                  validación física desde la hora real y debes registrar el
                  motivo.
                </div>
              )}

              {checkinBlockedByInitialPayment && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  Debes cubrir el pago inicial requerido antes de registrar el
                  check-in.
                </div>
              )}

              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm leading-6 text-blue-800">
                Al confirmar se volverán a validar todos los recursos físicos
                obligatorios de la reserva y sus complementos activos.
              </div>

              <label className="flex flex-col gap-2 text-sm">
                <span className="font-medium">
                  Motivo
                  {checkinIsEarly
                    ? " (obligatorio)"
                    : " (opcional)"}
                </span>

                <textarea
                  rows={3}
                  maxLength={1000}
                  value={checkinReason}
                  onChange={(event) =>
                    setCheckinReason(
                      event.target.value,
                    )
                  }
                  placeholder={
                    checkinIsEarly
                      ? "Ej. habitación disponible para ingreso anticipado"
                      : "Ej. ingreso verificado por recepción"
                  }
                  className="rounded-lg border border-zinc-300 px-3 py-2"
                />
              </label>

              {checkinError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">
                  {checkinError}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 border-t border-zinc-200 px-5 py-4">
              <button
                type="button"
                disabled={checkinSubmitting}
                onClick={() => {
                  setCheckinDialogOpen(false);
                  setCheckinError(null);
                }}
                className="h-10 rounded-lg border border-zinc-300 px-4 text-sm font-medium disabled:opacity-50"
              >
                Cancelar
              </button>

              <button
                type="button"
                disabled={
                  checkinSubmitting ||
                  checkinWindowClosed ||
                  checkinBlockedByInitialPayment ||
                  (checkinIsEarly &&
                    !checkinReason.trim())
                }
                onClick={() =>
                  void handleCheckin()
                }
                className="h-10 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {checkinSubmitting
                  ? "Registrando..."
                  : "Confirmar check-in"}
              </button>
            </div>
          </div>
        </div>
      )}

      {noShowDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white shadow-xl">
            <div className="border-b border-zinc-200 px-5 py-4">
              <h2 className="font-semibold">
                Marcar como no presentado
              </h2>

              <p className="mt-1 text-sm text-zinc-500">
                Reserva {reservation.confirmationCode}
              </p>
            </div>

            <div className="space-y-5 p-5">
              <div className="grid gap-3 rounded-lg bg-zinc-50 p-4 text-sm sm:grid-cols-2">
                <div>
                  <p className="text-zinc-500">
                    Inicio programado
                  </p>

                  <p className="mt-1 font-medium">
                    {formatDateTime(
                      reservation.startAt,
                      business.timezone,
                    )}
                  </p>
                </div>

                <div>
                  <p className="text-zinc-500">
                    Fin programado
                  </p>

                  <p className="mt-1 font-medium">
                    {formatDateTime(
                      reservation.endAt,
                      business.timezone,
                    )}
                  </p>
                </div>

                <div>
                  <p className="text-zinc-500">
                    Total contractual
                  </p>

                  <p className="mt-1 font-medium">
                    {formatMoney(
                      paymentSummary.total,
                      business.currency,
                    )}
                  </p>
                </div>

                <div>
                  <p className="text-zinc-500">
                    Saldo contractual
                  </p>

                  <p className="mt-1 font-medium">
                    {formatMoney(
                      paymentSummary.balance,
                      business.currency,
                    )}
                  </p>
                </div>

                <div>
                  <p className="text-zinc-500">
                    Pagos pendientes
                  </p>

                  <p className="mt-1 font-medium">
                    {formatMoney(
                      paymentSummary.pending,
                      business.currency,
                    )}
                  </p>
                </div>

                <div>
                  <p className="text-zinc-500">
                    Devoluciones pendientes
                  </p>

                  <p className="mt-1 font-medium">
                    {formatMoney(
                      paymentSummary.refundPending,
                      business.currency,
                    )}
                  </p>
                </div>
              </div>

              {!noShowDue && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-800">
                  La ausencia solo puede registrarse cuando llegue la hora
                  programada de inicio.
                </div>
              )}

              {noShowBlockedByPendingPayment && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-700">
                  Debes confirmar o rechazar los pagos pendientes antes de marcar
                  la reserva como no presentada.
                </div>
              )}

              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
                Esta acción liberará el inventario operativo sin eliminar las
                asignaciones históricas. No modificará fechas ni precios, no
                generará devoluciones automáticamente y la reserva dejará de
                aceptar nuevos pagos.
              </div>

              <label className="flex flex-col gap-2 text-sm">
                <span className="font-medium">
                  Motivo (obligatorio)
                </span>

                <textarea
                  rows={3}
                  maxLength={1000}
                  value={noShowReason}
                  onChange={(event) =>
                    setNoShowReason(
                      event.target.value,
                    )
                  }
                  placeholder="Ej. el cliente no llegó ni respondió a los intentos de contacto"
                  className="rounded-lg border border-zinc-300 px-3 py-2"
                />
              </label>

              {noShowError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">
                  {noShowError}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 border-t border-zinc-200 px-5 py-4">
              <button
                type="button"
                disabled={noShowSubmitting}
                onClick={() => {
                  setNoShowDialogOpen(false);
                  setNoShowError(null);
                }}
                className="h-10 rounded-lg border border-zinc-300 px-4 text-sm font-medium disabled:opacity-50"
              >
                Cancelar
              </button>

              <button
                type="button"
                disabled={
                  noShowSubmitting ||
                  !noShowDue ||
                  noShowBlockedByPendingPayment ||
                  !noShowReason.trim()
                }
                onClick={() =>
                  void handleNoShow()
                }
                className="h-10 rounded-lg bg-red-700 px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {noShowSubmitting
                  ? "Registrando..."
                  : "Confirmar ausencia"}
              </button>
            </div>
          </div>
        </div>
      )}

      {checkoutDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
            <div className="border-b border-zinc-200 px-5 py-4">
              <h2 className="font-semibold">
                Registrar check-out
              </h2>

              <p className="mt-1 text-sm text-zinc-500">
                Reserva {reservation.confirmationCode}
              </p>
            </div>

            <div className="space-y-5 p-5">
              <div className="grid gap-3 rounded-lg bg-zinc-50 p-4 text-sm sm:grid-cols-2">
                <div>
                  <p className="text-zinc-500">
                    Salida programada
                  </p>

                  <p className="mt-1 font-medium">
                    {formatDate(
                      reservation.endAt,
                      business.timezone,
                    )}
                  </p>
                </div>

                <div>
                  <p className="text-zinc-500">
                    Total contractual
                  </p>

                  <p className="mt-1 font-medium">
                    {formatMoney(
                      paymentSummary.total,
                      business.currency,
                    )}
                  </p>
                </div>

                <div>
                  <p className="text-zinc-500">
                    Saldo pendiente
                  </p>

                  <p className="mt-1 font-medium">
                    {formatMoney(
                      paymentSummary.balance,
                      business.currency,
                    )}
                  </p>
                </div>

                <div>
                  <p className="text-zinc-500">
                    Pagos pendientes
                  </p>

                  <p className="mt-1 font-medium">
                    {formatMoney(
                      paymentSummary.pending,
                      business.currency,
                    )}
                  </p>
                </div>
              </div>

              {!checkoutDue && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-800">
                  Esta será una salida anticipada. Las fechas y el total
                  contractual permanecerán sin cambios, y debes registrar el
                  motivo.
                </div>
              )}

              {checkoutBlockedByPendingPayment && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  Debes confirmar, rechazar o resolver los pagos pendientes
                  antes de registrar el check-out.
                </div>
              )}

              {checkoutBlockedByBalance && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  Debes cobrar el saldo pendiente antes de registrar el
                  check-out.
                </div>
              )}

              {paymentSummary.refundPending > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  Existe una devolución pendiente. No impide la salida física,
                  pero deberá resolverse antes de completar administrativamente
                  la reserva.
                </div>
              )}

              <label className="flex flex-col gap-2 text-sm">
                <span className="font-medium">
                  Motivo
                  {!checkoutDue
                    ? " (obligatorio)"
                    : " (opcional)"}
                </span>

                <textarea
                  rows={3}
                  value={checkoutReason}
                  onChange={(event) =>
                    setCheckoutReason(
                      event.target.value,
                    )
                  }
                  placeholder={
                    checkoutDue
                      ? "Ej. salida confirmada por recepción"
                      : "Ej. huésped solicita salida anticipada"
                  }
                  className="rounded-lg border border-zinc-300 px-3 py-2"
                />
              </label>

              {checkoutError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">
                  {checkoutError}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 border-t border-zinc-200 px-5 py-4">
              <button
                type="button"
                disabled={checkoutSubmitting}
                onClick={() => {
                  setCheckoutDialogOpen(false);
                  setCheckoutError(null);
                }}
                className="h-10 rounded-lg border border-zinc-300 px-4 text-sm font-medium disabled:opacity-50"
              >
                Cancelar
              </button>

              <button
                type="button"
                disabled={
                  checkoutSubmitting ||
                  checkoutBlockedByPendingPayment ||
                  checkoutBlockedByBalance ||
                  (!checkoutDue &&
                    !checkoutReason.trim())
                }
                onClick={() =>
                  void handleCheckout()
                }
                className="h-10 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {checkoutSubmitting
                  ? "Registrando..."
                  : "Confirmar check-out"}
              </button>
            </div>
          </div>
        </div>
      )}

      {completionDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
            <div className="border-b border-zinc-200 px-5 py-4">
              <h2 className="font-semibold">
                Completar reserva
              </h2>

              <p className="mt-1 text-sm text-zinc-500">
                Reserva {reservation.confirmationCode}
              </p>
            </div>

            <div className="space-y-5 p-5">
              <div className="grid gap-3 rounded-lg bg-zinc-50 p-4 text-sm sm:grid-cols-2">
                <div>
                  <p className="text-zinc-500">
                    Estado actual
                  </p>

                  <p className="mt-1 font-medium">
                    {getStatusLabel(
                      reservation.status,
                    )}
                  </p>
                </div>

                <div>
                  <p className="text-zinc-500">
                    Total contractual
                  </p>

                  <p className="mt-1 font-medium">
                    {formatMoney(
                      paymentSummary.total,
                      business.currency,
                    )}
                  </p>
                </div>

                <div>
                  <p className="text-zinc-500">
                    Pago neto
                  </p>

                  <p className="mt-1 font-medium">
                    {formatMoney(
                      paymentSummary.netPaid,
                      business.currency,
                    )}
                  </p>
                </div>

                <div>
                  <p className="text-zinc-500">
                    Saldo pendiente
                  </p>

                  <p className="mt-1 font-medium">
                    {formatMoney(
                      paymentSummary.balance,
                      business.currency,
                    )}
                  </p>
                </div>

                <div>
                  <p className="text-zinc-500">
                    Pagos pendientes
                  </p>

                  <p className="mt-1 font-medium">
                    {formatMoney(
                      paymentSummary.pending,
                      business.currency,
                    )}
                  </p>
                </div>

                <div>
                  <p className="text-zinc-500">
                    Devoluciones pendientes
                  </p>

                  <p className="mt-1 font-medium">
                    {formatMoney(
                      paymentSummary.refundPending,
                      business.currency,
                    )}
                  </p>
                </div>
              </div>

              {completionFinanciallySettled ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-800">
                  Esta acción cerrará administrativamente la reserva. Las fechas,
                  precios, pagos, devoluciones y asignaciones históricas
                  permanecerán sin cambios.
                </div>
              ) : (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-700">
                  No puedes completar la reserva hasta resolver saldos, pagos
                  pendientes, devoluciones pendientes o sobrepagos.
                </div>
              )}

              <label className="flex flex-col gap-2 text-sm">
                <span className="font-medium">
                  Motivo (opcional)
                </span>

                <textarea
                  rows={3}
                  maxLength={1000}
                  value={completionReason}
                  onChange={(event) =>
                    setCompletionReason(
                      event.target.value,
                    )
                  }
                  placeholder="Ej. cierre administrativo verificado por recepción"
                  className="rounded-lg border border-zinc-300 px-3 py-2"
                />
              </label>

              {completionError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">
                  {completionError}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 border-t border-zinc-200 px-5 py-4">
              <button
                type="button"
                disabled={completionSubmitting}
                onClick={() => {
                  setCompletionDialogOpen(false);
                  setCompletionError(null);
                }}
                className="h-10 rounded-lg border border-zinc-300 px-4 text-sm font-medium disabled:opacity-50"
              >
                Cancelar
              </button>

              <button
                type="button"
                disabled={
                  completionSubmitting ||
                  !completionFinanciallySettled
                }
                onClick={() =>
                  void handleCompletion()
                }
                className="h-10 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {completionSubmitting
                  ? "Completando..."
                  : "Confirmar cierre"}
              </button>
            </div>
          </div>
        </div>
      )}

      {resourceDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-xl">
            <div className="border-b border-zinc-200 px-5 py-4">
              <h2 className="font-semibold">{resourceDialogTitle}</h2>

              <p className="mt-1 text-sm text-zinc-500">
                Reserva {reservation.confirmationCode}
              </p>
            </div>

            <div className="p-5">
              {resourceLoading ? (
                <div className="py-12 text-center text-sm text-zinc-500">
                  Consultando disponibilidad...
                </div>
              ) : resourceError && !resourceOptions ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
                  {resourceError}
                </div>
              ) : resourceOptions ? (
                <div className="space-y-5">
                  {resourceRequirements.length === 0 ? (
                    <div className="rounded-lg bg-zinc-50 p-4 text-sm text-zinc-500">
                      La reserva no requiere recursos físicos.
                    </div>
                  ) : (
                    <>
                      <div className="space-y-3">
                        {resourceRequirements.map((requirement) => {
                          const requirementKey =
                            getResourceRequirementKey(
                              requirement,
                            );

                          return (
                            <label
                              key={requirementKey}
                              className={`block rounded-lg border p-4 ${
                                selectedRequirementKey === requirementKey
                                  ? "border-zinc-900"
                                  : "border-zinc-200"
                              } ${requirement.satisfied ? "opacity-60" : ""}`}
                            >
                              <div className="flex gap-3">
                                <input
                                  type="radio"
                                  name="resourceRequirement"
                                  value={requirementKey}
                                  checked={
                                    selectedRequirementKey === requirementKey
                                  }
                                  disabled={requirement.satisfied}
                                  onChange={() => {
                                    setSelectedRequirementKey(requirementKey);

                                    const firstAvailable =
                                      requirement.resources.find(
                                        (resource) => resource.available,
                                      );

                                    setSelectedResourceId(
                                      firstAvailable?.id ?? "",
                                    );
                                  }}
                                />

                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="font-medium">
                                      {requirement.source === "OPTION"
                                        ? requirement.option.name
                                        : requirement.service.name}
                                    </p>

                                    {requirement.source === "OPTION" && (
                                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
                                        Complemento
                                      </span>
                                    )}
                                  </div>

                                  <p className="mt-1 text-sm text-zinc-500">
                                    {requirement.source === "OPTION"
                                      ? `Complemento de ${requirement.service.name} · ${requirement.resourceType.name}`
                                      : requirement.resourceType.name}
                                  </p>

                                  {requirement.source === "OPTION" && (
                                    <p className="mt-1 text-xs text-zinc-500">
                                      Cantidad activa:{" "}
                                      {requirement.activeQuantity}
                                      {" · "}
                                      Requiere{" "}
                                      {requirement.requiredQuantityPerUnit}{" "}
                                      recurso(s) por unidad
                                    </p>
                                  )}

                                  <p className="mt-2 text-xs text-zinc-500">
                                    Asignados: {requirement.assignedQuantity} de{" "}
                                    {requirement.requiredQuantity}
                                  </p>

                                  {requirement.satisfied && (
                                    <p className="mt-1 text-xs font-medium text-green-700">
                                      Requisito satisfecho
                                    </p>
                                  )}
                                </div>
                              </div>
                            </label>
                          );
                        })}
                      </div>

                      {selectedRequirement && (
                        <div>
                          <p className="mb-3 text-sm font-medium">
                            Recursos disponibles
                          </p>

                          <div className="space-y-2">
                            {selectedRequirement.resources.map((resource) => (
                              <label
                                key={resource.id}
                                className={`flex items-center justify-between gap-4 rounded-lg border p-4 ${
                                  resource.available
                                    ? "cursor-pointer border-zinc-200"
                                    : "cursor-not-allowed border-zinc-100 bg-zinc-50 opacity-60"
                                } ${
                                  selectedResourceId === resource.id
                                    ? "border-zinc-900"
                                    : ""
                                }`}
                              >
                                <div className="flex items-center gap-3">
                                  <input
                                    type="radio"
                                    name="resource"
                                    value={resource.id}
                                    disabled={!resource.available}
                                    checked={selectedResourceId === resource.id}
                                    onChange={() =>
                                      setSelectedResourceId(resource.id)
                                    }
                                  />

                                  <div>
                                    <p className="font-medium">
                                      {resource.code ?? resource.name}
                                    </p>

                                    <p className="mt-1 text-xs text-zinc-500">
                                      {resource.floor !== null
                                        ? `Piso ${resource.floor} · `
                                        : ""}
                                      Capacidad {resource.capacity}
                                    </p>
                                  </div>
                                </div>

                                <span className="text-xs font-medium">
                                  {getResourceAvailabilityLabel(
                                    resource.availability,
                                  )}
                                </span>
                              </label>
                            ))}
                          </div>

                          {!selectedRequirement.resources.some(
                            (resource) => resource.available,
                          ) && (
                            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                              No hay recursos disponibles para este requisito
                              durante el intervalo requerido.
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}

                  {resourceError && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">
                      {resourceError}
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            <div className="flex justify-end gap-3 border-t border-zinc-200 px-5 py-4">
              <button
                type="button"
                disabled={resourceSubmitting}
                onClick={() => {
                  setResourceDialogOpen(false);
                  setResourceError(null);
                }}
                className="h-10 rounded-lg border border-zinc-300 px-4 text-sm font-medium disabled:opacity-50"
              >
                Cerrar
              </button>

              <button
                type="button"
                disabled={
                  resourceSubmitting ||
                  !selectedRequirement ||
                  !selectedResourceId ||
                  selectedRequirement.satisfied
                }
                onClick={() => void handleAssignResource()}
                className="h-10 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {resourceSubmitting ? "Asignando..." : resourceSubmitLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {paymentDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
            <div className="border-b border-zinc-200 px-5 py-4">
              <h2 className="font-semibold">Registrar pago</h2>

              <p className="mt-1 text-sm text-zinc-500">
                Reserva {reservation.confirmationCode}
              </p>
            </div>

            <div className="space-y-5 p-5">
              <div className="rounded-lg bg-zinc-50 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Monto a registrar
                </p>

                <p className="mt-2 text-2xl font-semibold">
                  {formatMoney(calculatedPaymentAmount, business.currency)}
                </p>

                <p className="mt-1 text-xs text-zinc-500">
                  El monto es calculado por el sistema y no puede editarse
                  manualmente.
                </p>
              </div>

              <label className="flex flex-col gap-2 text-sm">
                <span className="font-medium">Método de pago</span>

                <select
                  value={paymentMethod}
                  onChange={(event) => {
                    const value = event.target.value;

                    if (value === "BANK_TRANSFER" || value === "CASH") {
                      setPaymentMethod(value);
                    }
                  }}
                  className="h-10 rounded-lg border border-zinc-300 bg-white px-3"
                >
                  {availablePaymentMethods.map((method) => (
                    <option key={method} value={method}>
                      {method === "BANK_TRANSFER"
                        ? "Transferencia bancaria"
                        : "Efectivo"}
                    </option>
                  ))}
                </select>
              </label>

              {paymentMethod === "BANK_TRANSFER" && (
                <>
                  <label className="flex flex-col gap-2 text-sm">
                    <span className="font-medium">Comprobante</span>

                    <input
                      type="url"
                      value={paymentProofUrl}
                      onChange={(event) =>
                        setPaymentProofUrl(event.target.value)
                      }
                      placeholder="URL del comprobante (opcional)"
                      className="h-10 rounded-lg border border-zinc-300 px-3"
                    />
                  </label>

                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    La transferencia se creará como pendiente. Después deberá
                    verificarse desde la sección de pagos.
                  </div>
                </>
              )}

              {paymentMethod === "CASH" && (
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700">
                  El sistema registrará automáticamente el saldo pendiente
                  completo como recibido en efectivo.
                </div>
              )}

              <div className="rounded-lg border border-zinc-200 p-3 text-sm text-zinc-600">
                <p>
                  Modalidad:{" "}
                  <span className="font-medium text-zinc-900">
                    {getPaymentOptionLabel(reservation.paymentOption)}
                  </span>
                </p>

                <p className="mt-1">
                  Saldo exigible:{" "}
                  <span className="font-medium text-zinc-900">
                    {formatMoney(financialState.amountDue, business.currency)}
                  </span>
                </p>
              </div>

              {paymentError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">
                  {paymentError}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 border-t border-zinc-200 px-5 py-4">
              <button
                type="button"
                disabled={paymentSubmitting}
                onClick={() => {
                  setPaymentDialogOpen(false);
                  setPaymentError(null);
                }}
                className="h-10 rounded-lg border border-zinc-300 px-4 text-sm font-medium disabled:opacity-50"
              >
                Cancelar
              </button>

              <button
                type="button"
                disabled={!paymentMethod || paymentSubmitting}
                onClick={() => void handleCreatePayment()}
                className="h-10 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white disabled:opacity-50"
              >
                {paymentSubmitting ? "Registrando..." : "Registrar pago"}
              </button>
            </div>
          </div>
        </div>
      )}

      {rescheduleDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
            <div className="border-b border-zinc-200 px-5 py-4">
              <h2 className="font-semibold">Reprogramar reserva</h2>

              <p className="mt-1 text-sm text-zinc-500">
                {reservation.confirmationCode}
              </p>
            </div>

            <div className="space-y-5 p-5">
              <div className="rounded-lg bg-zinc-50 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Fechas actuales
                </p>

                <p className="mt-2 text-sm font-medium">
                  {formatDate(reservation.startAt, business.timezone)}
                  {" → "}
                  {formatDate(reservation.endAt, business.timezone)}
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-2 text-sm">
                  <span className="font-medium">Nueva entrada</span>

                  <input
                    type="date"
                    value={rescheduleCheckIn}
                    onChange={(event) =>
                      setRescheduleCheckIn(event.target.value)
                    }
                    className="h-10 rounded-lg border border-zinc-300 px-3"
                  />
                </label>

                <label className="flex flex-col gap-2 text-sm">
                  <span className="font-medium">Nueva salida</span>

                  <input
                    type="date"
                    value={rescheduleCheckOut}
                    onChange={(event) =>
                      setRescheduleCheckOut(event.target.value)
                    }
                    className="h-10 rounded-lg border border-zinc-300 px-3"
                  />
                </label>
              </div>

              <label className="flex flex-col gap-2 text-sm">
                <span className="font-medium">Motivo</span>

                <textarea
                  rows={3}
                  value={rescheduleReason}
                  onChange={(event) => setRescheduleReason(event.target.value)}
                  placeholder="Ej. solicitud del huésped"
                  className="rounded-lg border border-zinc-300 px-3 py-2"
                />
              </label>

              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-800">
                El sistema volverá a calcular disponibilidad, tarifa y estado
                financiero. Una habitación puede conservarse o liberarse y un
                cambio de precio puede requerir un pago adicional o generar una
                devolución.
              </div>

              {rescheduleError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">
                  {rescheduleError}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 border-t border-zinc-200 px-5 py-4">
              <button
                type="button"
                disabled={rescheduleSubmitting}
                onClick={() => {
                  setRescheduleDialogOpen(false);
                  setRescheduleError(null);
                }}
                className="h-10 rounded-lg border border-zinc-300 px-4 text-sm font-medium disabled:opacity-50"
              >
                Cancelar
              </button>

              <button
                type="button"
                disabled={
                  rescheduleSubmitting ||
                  !rescheduleCheckIn ||
                  !rescheduleCheckOut
                }
                onClick={() => void handleReschedule()}
                className="h-10 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white disabled:opacity-50"
              >
                {rescheduleSubmitting
                  ? "Reprogramando..."
                  : "Confirmar reprogramación"}
              </button>
            </div>
          </div>
        </div>
      )}

      {stayExtensionDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
            <div className="border-b border-zinc-200 px-5 py-4">
              <h2 className="font-semibold">
                Extender estancia
              </h2>

              <p className="mt-1 text-sm text-zinc-500">
                {reservation.confirmationCode}
              </p>
            </div>

            <div className="space-y-5 p-5">
              <div className="rounded-lg bg-zinc-50 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Salida actual
                </p>

                <p className="mt-2 text-sm font-medium">
                  {formatDate(
                    reservation.endAt,
                    business.timezone,
                  )}

                  {business.checkOutTime && (
                    <>
                      {" · "}
                      Check-out {business.checkOutTime}
                    </>
                  )}
                </p>
              </div>

              <label className="flex flex-col gap-2 text-sm">
                <span className="font-medium">
                  Nueva fecha de salida
                </span>

                <input
                  type="date"
                  min={minimumStayExtensionCheckOut}
                  value={stayExtensionCheckOut}
                  onChange={(event) =>
                    setStayExtensionCheckOut(
                      event.target.value,
                    )
                  }
                  className="h-10 rounded-lg border border-zinc-300 px-3"
                />
              </label>

              <label className="flex flex-col gap-2 text-sm">
                <span className="font-medium">
                  Motivo
                </span>

                <textarea
                  rows={3}
                  value={stayExtensionReason}
                  onChange={(event) =>
                    setStayExtensionReason(
                      event.target.value,
                    )
                  }
                  placeholder="Ej. el huésped solicitó una noche adicional"
                  className="rounded-lg border border-zinc-300 px-3 py-2"
                />
              </label>

              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-800">
                Solo se extenderá la fecha de salida. Se cobrarán las noches
                adicionales con las tarifas vigentes y los complementos
                heredados que dependan de la estancia. La reserva conservará su
                estado de check-in y todos sus recursos asignados.
              </div>

              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm leading-6 text-zinc-600">
                Si una habitación, complemento o recurso asignado no puede
                mantenerse durante el tramo adicional, la operación será
                rechazada sin modificar la reserva.
              </div>

              {stayExtensionError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">
                  {stayExtensionError}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 border-t border-zinc-200 px-5 py-4">
              <button
                type="button"
                disabled={stayExtensionSubmitting}
                onClick={() => {
                  setStayExtensionDialogOpen(false);
                  setStayExtensionError(null);
                }}
                className="h-10 rounded-lg border border-zinc-300 px-4 text-sm font-medium disabled:opacity-50"
              >
                Cancelar
              </button>

              <button
                type="button"
                disabled={
                  stayExtensionSubmitting ||
                  !stayExtensionCheckOut
                }
                onClick={() =>
                  void handleStayExtension()
                }
                className="h-10 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white disabled:opacity-50"
              >
                {stayExtensionSubmitting
                  ? "Extendiendo..."
                  : "Confirmar extensión"}
              </button>
            </div>
          </div>
        </div>
      )}
      {refundDialogOpen && selectedRefundGroup && refundTargetStatus && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
            <div className="border-b border-zinc-200 px-5 py-4">
              <h2 className="font-semibold">Gestionar devolución</h2>

              <p className="mt-1 text-sm text-zinc-500">
                {reservation.confirmationCode}
              </p>
            </div>

            <div className="space-y-5 p-5">
              <div className="rounded-lg bg-zinc-50 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Importe total
                </p>

                <p className="mt-2 text-2xl font-semibold">
                  {formatMoney(selectedRefundGroup.amount, business.currency)}
                </p>

                <p className="mt-2 text-sm text-zinc-500">
                  {selectedRefundGroup.basis.replaceAll("_", " ")}
                </p>

                {selectedRefundGroup.refunds.length > 1 && (
                  <p className="mt-2 text-xs text-zinc-500">
                    Esta devolución está respaldada internamente por{" "}
                    {selectedRefundGroup.refunds.length} movimientos vinculados
                    a los pagos originales.
                  </p>
                )}
              </div>

              <div className="rounded-lg border border-zinc-200 p-4 text-sm">
                <p>
                  Estado actual:{" "}
                  <span className="font-medium">
                    {selectedRefundGroup.displayStatus === "MIXED"
                      ? "Estados mixtos"
                      : getStatusLabel(selectedRefundGroup.displayStatus)}
                  </span>
                </p>

                <p className="mt-1">
                  Nuevo estado:{" "}
                  <span className="font-medium">
                    {getStatusLabel(refundTargetStatus)}
                  </span>
                </p>
              </div>

              {(refundTargetStatus === "PROCESSING" ||
                refundTargetStatus === "COMPLETED") && (
                <label className="flex flex-col gap-2 text-sm">
                  <span className="font-medium">Referencia externa</span>

                  <input
                    type="text"
                    value={refundExternalReference}
                    onChange={(event) =>
                      setRefundExternalReference(event.target.value)
                    }
                    placeholder="Ej. referencia bancaria (opcional)"
                    className="h-10 rounded-lg border border-zinc-300 px-3"
                  />
                </label>
              )}

              {refundTargetStatus === "COMPLETED" && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  La operación completa será marcada como devuelta. Todos sus
                  movimientos internos se actualizarán dentro de una sola
                  transacción.
                </div>
              )}

              {refundTargetStatus === "CANCELLED" && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  Todos los reembolsos pendientes que componen esta operación
                  quedarán cancelados.
                </div>
              )}

              {refundActionError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">
                  {refundActionError}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 border-t border-zinc-200 px-5 py-4">
              <button
                type="button"
                disabled={refundSubmitting}
                onClick={() => {
                  setRefundDialogOpen(false);
                  setSelectedRefundGroup(null);
                  setRefundTargetStatus(null);
                  setRefundActionError(null);
                }}
                className="h-10 rounded-lg border border-zinc-300 px-4 text-sm font-medium disabled:opacity-50"
              >
                Volver
              </button>

              <button
                type="button"
                disabled={refundSubmitting}
                onClick={() => void handleRefundGroupStatusChange()}
                className="h-10 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white disabled:opacity-50"
              >
                {refundSubmitting ? "Procesando..." : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {cancellationDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
            <div className="border-b border-zinc-200 px-5 py-4">
              <h2 className="font-semibold">Cancelar reserva</h2>

              <p className="mt-1 text-sm text-zinc-500">
                {reservation.confirmationCode}
              </p>
            </div>

            <div className="space-y-5 p-5">
              <div className="rounded-lg bg-zinc-50 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Reserva
                </p>

                <p className="mt-2 font-medium">
                  {customer.firstName} {customer.lastName}
                </p>

                <p className="mt-1 text-sm text-zinc-500">
                  {formatDate(reservation.startAt, business.timezone)}
                  {" → "}
                  {formatDate(reservation.endAt, business.timezone)}
                </p>

                <p className="mt-2 text-sm">
                  Total:{" "}
                  <span className="font-medium">
                    {formatMoney(reservation.total, business.currency)}
                  </span>
                </p>

                <p className="mt-1 text-sm">
                  Pagado neto:{" "}
                  <span className="font-medium">
                    {formatMoney(paymentSummary.netPaid, business.currency)}
                  </span>
                </p>
              </div>

              <label className="flex flex-col gap-2 text-sm">
                <span className="font-medium">
                  ¿Quién solicita la cancelación?
                </span>

                <select
                  value={cancellationInitiator}
                  onChange={(event) => {
                    const value = event.target.value;

                    if (value === "CUSTOMER" || value === "PROVIDER") {
                      setCancellationInitiator(value);
                    }
                  }}
                  className="h-10 rounded-lg border border-zinc-300 bg-white px-3"
                >
                  <option value="CUSTOMER">Cliente</option>

                  <option value="PROVIDER">Negocio / proveedor</option>
                </select>
              </label>

              <label className="flex flex-col gap-2 text-sm">
                <span className="font-medium">Motivo</span>

                <textarea
                  rows={3}
                  value={cancellationReason}
                  onChange={(event) =>
                    setCancellationReason(event.target.value)
                  }
                  placeholder="Ej. solicitud del huésped"
                  className="rounded-lg border border-zinc-300 px-3 py-2"
                />
              </label>

              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-800">
                La clasificación y el importe reembolsable no se determinan
                manualmente. El sistema aplicará automáticamente la política
                vigente, incluyendo retracto o retención administrativa cuando
                corresponda.
              </div>

              {cancellationInitiator === "PROVIDER" && (
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700">
                  Cuando la cancelación es iniciada por el negocio, el sistema
                  aplicará las reglas correspondientes a una cancelación del
                  proveedor.
                </div>
              )}

              {cancellationError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">
                  {cancellationError}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 border-t border-zinc-200 px-5 py-4">
              <button
                type="button"
                disabled={cancellationSubmitting}
                onClick={() => {
                  setCancellationDialogOpen(false);
                  setCancellationError(null);
                }}
                className="h-10 rounded-lg border border-zinc-300 px-4 text-sm font-medium disabled:opacity-50"
              >
                Volver
              </button>

              <button
                type="button"
                disabled={cancellationSubmitting}
                onClick={() => void handleCancelReservation()}
                className="h-10 rounded-lg bg-red-700 px-4 text-sm font-medium text-white disabled:opacity-50"
              >
                {cancellationSubmitting
                  ? "Cancelando..."
                  : "Confirmar cancelación"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
