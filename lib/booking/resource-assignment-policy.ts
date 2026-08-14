export type ResourceAssignmentPolicyViolation =
  | "RESOURCE_NOT_ALLOWED_FOR_SERVICE"
  | "RESERVATION_SERVICE_NOT_VALID"
  | "RESERVATION_SERVICE_REQUIRED";

type ResourceRequirement = {
  resourceTypeId: string;
  requiredQuantity: number;
};

type AssignedResource = {
  resource: {
    resourceTypeId: string | null;
  };
};

export type ReservationServiceForResourceAssignment = {
  id: string;
  serviceId: string;
  quantity: number;

  service: {
    resourceTypes: ResourceRequirement[];
  };

  resources: AssignedResource[];
};

type ResolveReservationServiceInput<
  T extends ReservationServiceForResourceAssignment,
> = {
  services: T[];

  resourceTypeId: string;

  requestedReservationServiceId: string | null;
};

type ResolveReservationServiceResult<
  T extends ReservationServiceForResourceAssignment,
> =
  | {
      ok: true;

      reservationService: T;

      requiredResourceCount: number;
    }
  | {
      ok: false;

      violation: ResourceAssignmentPolicyViolation;
    };

export function resolveReservationServiceForResource<
  T extends ReservationServiceForResourceAssignment,
>({
  services,
  resourceTypeId,
  requestedReservationServiceId,
}: ResolveReservationServiceInput<T>): ResolveReservationServiceResult<T> {
  // ─────────────────────────────────────────────
  // 1. SERVICIOS COMPATIBLES
  // ─────────────────────────────────────────────

  const eligibleServices = services.filter((reservationService) =>
    reservationService.service.resourceTypes.some(
      (requirement) => requirement.resourceTypeId === resourceTypeId,
    ),
  );

  if (eligibleServices.length === 0) {
    return {
      ok: false,
      violation: "RESOURCE_NOT_ALLOWED_FOR_SERVICE",
    };
  }

  let reservationService: T;

  // ─────────────────────────────────────────────
  // 2. RESERVATION SERVICE EXPLÍCITO
  // ─────────────────────────────────────────────

  if (requestedReservationServiceId) {
    const requested = eligibleServices.find(
      (item) => item.id === requestedReservationServiceId,
    );

    if (!requested) {
      return {
        ok: false,
        violation: "RESERVATION_SERVICE_NOT_VALID",
      };
    }

    reservationService = requested;
  } else {
    // Si más de un servicio acepta el mismo
    // ResourceType, necesitamos saber a cuál
    // pertenece la asignación.

    if (eligibleServices.length > 1) {
      return {
        ok: false,
        violation: "RESERVATION_SERVICE_REQUIRED",
      };
    }

    const firstEligible = eligibleServices[0];

    if (!firstEligible) {
      return {
        ok: false,
        violation: "RESOURCE_NOT_ALLOWED_FOR_SERVICE",
      };
    }

    reservationService = firstEligible;
  }

  // ─────────────────────────────────────────────
  // 3. REQUIREMENT
  // ─────────────────────────────────────────────

  const requirement = reservationService.service.resourceTypes.find(
    (item) => item.resourceTypeId === resourceTypeId,
  );

  if (!requirement) {
    return {
      ok: false,
      violation: "RESOURCE_NOT_ALLOWED_FOR_SERVICE",
    };
  }

  const requiredResourceCount = Math.max(
    1,
    reservationService.quantity * requirement.requiredQuantity,
  );

  return {
    ok: true,
    reservationService,
    requiredResourceCount,
  };
}

export function isResourceRequirementSatisfied(
  reservationService: ReservationServiceForResourceAssignment,
  resourceTypeId: string,
  requiredResourceCount: number,
) {
  const assignedCount = reservationService.resources.filter(
    (assignment) => assignment.resource.resourceTypeId === resourceTypeId,
  ).length;

  return assignedCount >= requiredResourceCount;
}
