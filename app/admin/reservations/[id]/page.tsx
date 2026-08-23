"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { zonedDateTimeToUtc } from "@/lib/booking/datetime";

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
    guests: number;
    adults: number | null;
    children: number | null;
    subtotal: number;
    total: number;
    paymentOption: string | null;
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
    paymentOption: string | null;
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
    paymentOption: string | null;
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

type RegisterablePaymentMethod = "BANK_TRANSFER" | "CASH";

type PaymentTargetStatus = "PAID" | "FAILED";

import { DEV_RECEPTION_USER_ID as TEMP_RECEPTION_USER_ID } from "@/lib/config/dev-context";

type ResourceAvailability =
  | "AVAILABLE"
  | "ASSIGNED"
  | "OCCUPIED"
  | "BLOCKED"
  | "UNAVAILABLE";

type ResourceRequirement = {
  reservationServiceId: string;
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

  resources: Array<{
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
  }>;
};

type ReservationResourcesResponse = {
  success: true;

  reservation: {
    id: string;
    confirmationCode: string;
    status: string;
    startAt: string;
    endAt: string;
  };

  requirements: ResourceRequirement[];
};

type ReservationOperationalStatus =
  | "PENDING"
  | "CONFIRMED"
  | "CANCELLED"
  | "NO_SHOW"
  | "CHECKED_IN"
  | "CHECKED_OUT"
  | "COMPLETED";

const STATUS_TRANSITIONS: Record<
  ReservationOperationalStatus,
  ReservationOperationalStatus[]
> = {
  PENDING: ["CONFIRMED"],

  CONFIRMED: ["CHECKED_IN", "NO_SHOW"],

  CANCELLED: [],

  NO_SHOW: [],

  CHECKED_IN: ["CHECKED_OUT"],

  CHECKED_OUT: ["COMPLETED"],

  COMPLETED: [],
};

function isOperationalStatus(
  value: string,
): value is ReservationOperationalStatus {
  return value in STATUS_TRANSITIONS;
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

export default function ReservationDetailPage() {
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

  const [statusDialogOpen, setStatusDialogOpen] = useState(false);

  const [targetStatus, setTargetStatus] = useState<
    ReservationOperationalStatus | ""
  >("");

  const [statusSubmitting, setStatusSubmitting] = useState(false);

  const [statusError, setStatusError] = useState<string | null>(null);

  const [statusSuccess, setStatusSuccess] = useState<string | null>(null);

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

  async function handleStatusChange() {
    if (!targetStatus) {
      setStatusError("Selecciona el nuevo estado.");
      return;
    }

    setStatusSubmitting(true);
    setStatusError(null);
    setStatusSuccess(null);

    try {
      const response = await fetch(
        `/api/reservations/${reservationId}/status`,
        {
          method: "PATCH",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            status: targetStatus,
          }),
        },
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof result.error === "string"
            ? result.error
            : "No fue posible cambiar el estado de la reserva",
        );
      }

      const newStatus = result.reservation?.status ?? targetStatus;

      setStatusDialogOpen(false);
      setTargetStatus("");

      setStatusSuccess(`Estado actualizado a ${getStatusLabel(newStatus)}.`);

      await loadReservation();
    } catch (error) {
      setStatusError(
        error instanceof Error
          ? error.message
          : "No fue posible cambiar el estado de la reserva",
      );
    } finally {
      setStatusSubmitting(false);
    }
  }

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

      const options = result as ReservationResourcesResponse;

      setResourceOptions(options);

      const firstPendingRequirement = options.requirements.find(
        (requirement) =>
          !requirement.satisfied &&
          requirement.resources.some((resource) => resource.available),
      );

      if (firstPendingRequirement) {
        const requirementKey = `${firstPendingRequirement.reservationServiceId}:${firstPendingRequirement.resourceType.id}`;

        const firstAvailableResource = firstPendingRequirement.resources.find(
          (resource) => resource.available,
        );

        setSelectedRequirementKey(requirementKey);

        setSelectedResourceId(firstAvailableResource?.id ?? "");
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

    const selectedRequirement = resourceOptions.requirements.find(
      (requirement) =>
        `${requirement.reservationServiceId}:${requirement.resourceType.id}` ===
        selectedRequirementKey,
    );

    if (!selectedRequirement) {
      setResourceError("No fue posible determinar el requisito seleccionado.");

      return;
    }

    setResourceSubmitting(true);
    setResourceError(null);

    try {
      const response = await fetch(`/api/reservations/${reservationId}/room`, {
        method: "PATCH",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          resourceId: selectedResourceId,

          reservationServiceId: selectedRequirement.reservationServiceId,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof result.error === "string"
            ? result.error
            : "No fue posible asignar el recurso",
        );
      }

      const assignedResource = result.reservation?.resource;

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
      data.options.find(
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

    setOptionRemoveDialogOpen(true);
  }

  async function handleRemoveReservationOption() {
    if (!data) {
      return;
    }

    const option =
      data.options.find(
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
        option.activeOptionalQuantity;

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

  const selectedReservationOption =
    data.options.find(
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

    if (reservation.paymentOption === "DEPOSIT_50") {
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
      : reservation.paymentOption === "DEPOSIT_50"
        ? (paymentSummary.initialPaymentRemaining ?? 0)
        : financialState.amountDue;

  const availableStatusTransitions = isOperationalStatus(reservation.status)
    ? STATUS_TRANSITIONS[reservation.status]
    : [];

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

  const selectedRequirement =
    resourceOptions?.requirements.find(
      (requirement) =>
        `${requirement.reservationServiceId}:${requirement.resourceType.id}` ===
        selectedRequirementKey,
    ) ?? null;

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
          </div>

          <p className="mt-2 text-sm text-zinc-500">
            Creada {formatDateTime(reservation.createdAt, business.timezone)}
          </p>
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

          <button
            type="button"
            disabled={!canAssignResources}
            onClick={() => void openResourceDialog()}
            className="h-10 rounded-lg border border-zinc-300 bg-white px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
          >
            {resourceActionLabel}
          </button>

          <button
            type="button"
            disabled={availableStatusTransitions.length === 0}
            onClick={() => {
              setStatusError(null);
              setStatusSuccess(null);

              setTargetStatus(availableStatusTransitions[0] ?? "");

              setStatusDialogOpen(true);
            }}
            className="h-10 rounded-lg border border-zinc-300 bg-white px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
          >
            Cambiar estado
          </button>

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

      {statusSuccess && (
        <div className="mt-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-800">
          {statusSuccess}
        </div>
      )}

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
                  {reservation.paymentOption ?? "Histórica"}
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

            {data.options.filter((option) => option.activeQuantity > 0).length === 0 ? (
              <p className="p-5 text-sm text-zinc-500">
                Esta reserva no tiene complementos registrados.
              </p>
            ) : (
              <div className="divide-y divide-zinc-100">
                {data.options.filter((option) => option.activeQuantity > 0).map((option) => (
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
                        complemento. La línea histórica permanecerá en la
                        reserva.
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
                        ? "Quitar complemento"
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
                          {change.type.replaceAll("_", " ")}
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
      {statusDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
            <div className="border-b border-zinc-200 px-5 py-4">
              <h2 className="font-semibold">Cambiar estado</h2>

              <p className="mt-1 text-sm text-zinc-500">
                Reserva {reservation.confirmationCode}
              </p>
            </div>

            <div className="p-5">
              <div className="rounded-lg bg-zinc-50 p-4 text-sm">
                <p className="text-zinc-500">Estado actual</p>

                <p className="mt-1 font-medium">
                  {getStatusLabel(reservation.status)}
                </p>
              </div>

              <label className="mt-5 flex flex-col gap-2 text-sm">
                <span className="font-medium">Nuevo estado</span>

                <select
                  value={targetStatus}
                  onChange={(event) => {
                    const value = event.target.value;

                    if (isOperationalStatus(value)) {
                      setTargetStatus(value);
                    }
                  }}
                  className="h-10 rounded-lg border border-zinc-300 bg-white px-3"
                >
                  {availableStatusTransitions.map((status) => (
                    <option key={status} value={status}>
                      {getStatusLabel(status)}
                    </option>
                  ))}
                </select>
              </label>

              {targetStatus === "CHECKED_IN" && (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  El check-in requiere que el pago inicial esté cubierto y todos
                  los recursos físicos requeridos estén asignados.
                </div>
              )}

              {targetStatus === "NO_SHOW" && (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  Esta acción marcará al huésped como no presentado.
                </div>
              )}

              {statusError && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">
                  {statusError}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 border-t border-zinc-200 px-5 py-4">
              <button
                type="button"
                disabled={statusSubmitting}
                onClick={() => {
                  setStatusDialogOpen(false);
                  setStatusError(null);
                }}
                className="h-10 rounded-lg border border-zinc-300 px-4 text-sm font-medium disabled:opacity-50"
              >
                Cancelar
              </button>

              <button
                type="button"
                disabled={!targetStatus || statusSubmitting}
                onClick={() => void handleStatusChange()}
                className="h-10 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white disabled:opacity-50"
              >
                {statusSubmitting ? "Actualizando..." : "Confirmar cambio"}
              </button>
            </div>
          </div>
        </div>
      )}

      {resourceDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-xl">
            <div className="border-b border-zinc-200 px-5 py-4">
              <h2 className="font-semibold">{resourceActionLabel}</h2>

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
                  {resourceOptions.requirements.length === 0 ? (
                    <div className="rounded-lg bg-zinc-50 p-4 text-sm text-zinc-500">
                      El servicio no requiere recursos físicos.
                    </div>
                  ) : (
                    <>
                      <div className="space-y-3">
                        {resourceOptions.requirements.map((requirement) => {
                          const requirementKey = `${requirement.reservationServiceId}:${requirement.resourceType.id}`;

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
                                  <p className="font-medium">
                                    {requirement.service.name}
                                  </p>

                                  <p className="mt-1 text-sm text-zinc-500">
                                    {requirement.resourceType.name}
                                  </p>

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
                              No hay recursos disponibles para este requisito en
                              las fechas de la reserva.
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
                {resourceSubmitting ? "Asignando..." : resourceActionLabel}
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
                    {reservation.paymentOption}
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
