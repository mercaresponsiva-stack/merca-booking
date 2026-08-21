export type ReservationOptionResourceRequirement = {
  resourceTypeId: string;
  requiredQuantity: number;
};

export type ReservationOptionAssignedResource = {
  assignmentId: string;
  resourceId: string;
  resourceTypeId: string;
  createdAt: Date;
};

export type ReservationOptionResourceReleaseItem = {
  assignmentId: string;
  resourceId: string;
  resourceTypeId: string;
};

export type ReservationOptionResourceTypeRelease = {
  resourceTypeId: string;

  requiredQuantity: number;

  activeQuantityAfter: number;

  requiredResourcesAfter: number;

  assignedResourcesBefore: number;

  keptResources: number;

  releasedResources: number;

  keptAssignmentIds: string[];

  releasedAssignmentIds: string[];
};

export type ReservationOptionResourceReleaseResult = {
  activeQuantityAfter: number;

  requiredResourcesAfter: number;

  assignedResourcesBefore: number;

  keptResources: number;

  releasedResources: number;

  kept: ReservationOptionResourceReleaseItem[];

  released: ReservationOptionResourceReleaseItem[];

  resourceTypes:
    ReservationOptionResourceTypeRelease[];
};

type ResolveReservationOptionResourceReleaseInput = {
  activeQuantityAfter: number;

  requirements:
    ReservationOptionResourceRequirement[];

  assignments:
    ReservationOptionAssignedResource[];
};

function assertNonNegativeInteger(
  value: number,
  errorCode: string,
) {
  if (
    !Number.isInteger(
      value,
    ) ||
    value < 0
  ) {
    throw new Error(
      errorCode,
    );
  }
}

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
 * Decide qué ReservationResource de una
 * ReservationOption pueden conservarse
 * después de disminuir su cantidad activa.
 *
 * Este helper NO:
 *
 * - consulta Prisma
 * - elimina filas
 * - asigna recursos nuevos
 * - valida disponibilidad
 *
 * OPTION_REMOVED solamente reduce demanda,
 * por lo que nunca necesita conseguir
 * inventario adicional.
 */
export function resolveReservationOptionResourceRelease({
  activeQuantityAfter,

  requirements,

  assignments,
}: ResolveReservationOptionResourceReleaseInput): ReservationOptionResourceReleaseResult {
  assertNonNegativeInteger(
    activeQuantityAfter,
    "INVALID_OPTION_ACTIVE_QUANTITY_AFTER",
  );

  const requirementsByType =
    new Map<
      string,
      ReservationOptionResourceRequirement
    >();

  for (
    const requirement of
    requirements
  ) {
    if (
      !requirement.resourceTypeId
    ) {
      throw new Error(
        "OPTION_RESOURCE_TYPE_ID_REQUIRED",
      );
    }

    assertPositiveInteger(
      requirement.requiredQuantity,
      "INVALID_OPTION_RESOURCE_REQUIRED_QUANTITY",
    );

    if (
      requirementsByType.has(
        requirement.resourceTypeId,
      )
    ) {
      throw new Error(
        "DUPLICATE_OPTION_RESOURCE_TYPE_REQUIREMENT",
      );
    }

    requirementsByType.set(
      requirement.resourceTypeId,
      requirement,
    );
  }

  /*
   * Orden determinista.
   *
   * Conservamos primero las asignaciones
   * más antiguas y liberamos las sobrantes.
   *
   * createdAt + assignmentId evita que la
   * selección cambie entre ejecuciones.
   */
  const orderedAssignments =
    [...assignments]
      .sort(
        (
          first,
          second,
        ) => {
          const timeDifference =
            first.createdAt.getTime() -
            second.createdAt.getTime();

          if (
            timeDifference !==
            0
          ) {
            return timeDifference;
          }

          return first.assignmentId.localeCompare(
            second.assignmentId,
          );
        },
      );

  const assignmentsByType =
    new Map<
      string,
      ReservationOptionAssignedResource[]
    >();

  for (
    const assignment of
    orderedAssignments
  ) {
    if (
      !assignment.assignmentId ||
      !assignment.resourceId ||
      !assignment.resourceTypeId ||
      Number.isNaN(
        assignment.createdAt.getTime(),
      )
    ) {
      throw new Error(
        "INVALID_OPTION_RESOURCE_ASSIGNMENT",
      );
    }

    const current =
      assignmentsByType.get(
        assignment.resourceTypeId,
      ) ??
      [];

    current.push(
      assignment,
    );

    assignmentsByType.set(
      assignment.resourceTypeId,
      current,
    );
  }

  /*
   * Incluimos también ResourceTypes que
   * aparezcan únicamente en assignments.
   *
   * Una asignación para un tipo que ya no
   * tiene requisito vigente es stale y se
   * puede liberar.
   */
  const resourceTypeIds =
    new Set<string>([
      ...requirementsByType.keys(),
      ...assignmentsByType.keys(),
    ]);

  const kept:
    ReservationOptionResourceReleaseItem[] =
    [];

  const released:
    ReservationOptionResourceReleaseItem[] =
    [];

  const resourceTypes:
    ReservationOptionResourceTypeRelease[] =
    [];

  let requiredResourcesAfter =
    0;

  for (
    const resourceTypeId of
    resourceTypeIds
  ) {
    const requirement =
      requirementsByType.get(
        resourceTypeId,
      );

    const requiredQuantity =
      requirement
        ?.requiredQuantity ??
      0;

    const requiredForType =
      requiredQuantity ===
      0
        ? 0
        : multiplySafe(
            activeQuantityAfter,
            requiredQuantity,
          );

    const assignedForType =
      assignmentsByType.get(
        resourceTypeId,
      ) ??
      [];

    const keepForType =
      assignedForType.slice(
        0,
        requiredForType,
      );

    const releaseForType =
      assignedForType.slice(
        requiredForType,
      );

    requiredResourcesAfter +=
      requiredForType;

    for (
      const assignment of
      keepForType
    ) {
      kept.push({
        assignmentId:
          assignment.assignmentId,

        resourceId:
          assignment.resourceId,

        resourceTypeId:
          assignment.resourceTypeId,
      });
    }

    for (
      const assignment of
      releaseForType
    ) {
      released.push({
        assignmentId:
          assignment.assignmentId,

        resourceId:
          assignment.resourceId,

        resourceTypeId:
          assignment.resourceTypeId,
      });
    }

    resourceTypes.push({
      resourceTypeId,

      requiredQuantity,

      activeQuantityAfter,

      requiredResourcesAfter:
        requiredForType,

      assignedResourcesBefore:
        assignedForType.length,

      keptResources:
        keepForType.length,

      releasedResources:
        releaseForType.length,

      keptAssignmentIds:
        keepForType.map(
          (
            assignment,
          ) =>
            assignment.assignmentId,
        ),

      releasedAssignmentIds:
        releaseForType.map(
          (
            assignment,
          ) =>
            assignment.assignmentId,
        ),
    });
  }

  return {
    activeQuantityAfter,

    requiredResourcesAfter,

    assignedResourcesBefore:
      assignments.length,

    keptResources:
      kept.length,

    releasedResources:
      released.length,

    kept,

    released,

    resourceTypes,
  };
}