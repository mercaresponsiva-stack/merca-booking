"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: string;
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

type RegisterablePaymentMethod = "BANK_TRANSFER" | "CASH";

type PaymentTargetStatus = "PAID" | "FAILED";

const TEMP_RECEPTION_USER_ID = "cmsr1xt2e0000x8vwk6i0sawb";

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

  const loadReservation = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
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

      setData(result as ReservationDetailResponse);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "No fue posible cargar la reserva",
      );
    } finally {
      setLoading(false);
    }
  }, [reservationId]);

  useEffect(() => {
    void loadReservation();
  }, [loadReservation]);

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
            onClick={() => void loadReservation()}
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
            disabled
            className="h-10 cursor-not-allowed rounded-lg border border-zinc-300 bg-white px-4 text-sm font-medium opacity-50"
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

          {data.refunds.length > 0 && (
            <section className="rounded-xl border border-zinc-200 bg-white">
              <div className="border-b border-zinc-200 px-5 py-4">
                <h2 className="font-semibold">Devoluciones</h2>
              </div>

              <div className="divide-y divide-zinc-100">
                {data.refunds.map((refund) => (
                  <div key={refund.id} className="p-5">
                    <div className="flex justify-between gap-3">
                      <div>
                        <p className="font-medium">
                          {refund.basis.replaceAll("_", " ")}
                        </p>

                        <p className="mt-1 text-xs text-zinc-500">
                          {getStatusLabel(refund.status)}
                        </p>
                      </div>

                      <p className="font-semibold">
                        {formatMoney(refund.amount, business.currency)}
                      </p>
                    </div>
                  </div>
                ))}
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
    </div>
  );
}
