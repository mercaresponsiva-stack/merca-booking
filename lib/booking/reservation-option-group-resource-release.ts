import {
  resolveReservationOptionResourceRelease,
  type ReservationOptionAssignedResource,
  type ReservationOptionResourceReleaseItem,
  type ReservationOptionResourceRequirement,
  type ReservationOptionResourceTypeRelease,
} from "@/lib/booking/reservation-option-resource-release";

export type ReservationOptionGroupResourceReleaseMember = {
  reservationOptionId: string;

  activeQuantityAfter: number;

  requirements:
    ReservationOptionResourceRequirement[];

  assignments:
    ReservationOptionAssignedResource[];
};

export type ReservationOptionGroupResourceReleaseItem =
  ReservationOptionResourceReleaseItem & {
    reservationOptionId:
      string;
  };

export type ReservationOptionGroupResourceTypeRelease =
  ReservationOptionResourceTypeRelease & {
    reservationOptionId:
      string;
  };

export type ReservationOptionGroupResourceReleaseMemberResult = {
  reservationOptionId: string;

  activeQuantityAfter: number;

  requiredResourcesAfter: number;

  assignedResourcesBefore: number;

  keptResources: number;

  releasedResources: number;

  kept:
    ReservationOptionGroupResourceReleaseItem[];

  released:
    ReservationOptionGroupResourceReleaseItem[];

  resourceTypes:
    ReservationOptionGroupResourceTypeRelease[];
};

export type ReservationOptionGroupResourceReleaseResult = {
  affectedMembers: number;

  requiredResourcesAfter: number;

  assignedResourcesBefore: number;

  keptResources: number;

  releasedResources: number;

  kept:
    ReservationOptionGroupResourceReleaseItem[];

  released:
    ReservationOptionGroupResourceReleaseItem[];

  resourceTypes:
    ReservationOptionGroupResourceTypeRelease[];

  members:
    ReservationOptionGroupResourceReleaseMemberResult[];
};

function addSafeInteger(
  first: number,
  second: number,
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
      "OPTION_GROUP_RESOURCE_RELEASE_OVERFLOW",
    );
  }

  return result;
}

/*
 * Agrega las decisiones de liberación de
 * las líneas ReservationOption afectadas
 * por una única reducción operacional.
 *
 * Cada línea conserva su propia regla de
 * asignaciones y su propio snapshot.
 *
 * Este helper NO:
 *
 * - consulta Prisma
 * - elimina ReservationResource
 * - modifica ReservationOption
 * - incluye líneas no afectadas
 */
export function resolveReservationOptionGroupResourceRelease({
  members,
}: {
  members:
    ReservationOptionGroupResourceReleaseMember[];
}): ReservationOptionGroupResourceReleaseResult {
  if (
    members.length ===
    0
  ) {
    throw new Error(
      "OPTION_GROUP_RESOURCE_RELEASE_MEMBERS_REQUIRED",
    );
  }

  const seenReservationOptionIds =
    new Set<string>();

  const memberResults:
    ReservationOptionGroupResourceReleaseMemberResult[] =
    [];

  const kept:
    ReservationOptionGroupResourceReleaseItem[] =
    [];

  const released:
    ReservationOptionGroupResourceReleaseItem[] =
    [];

  const resourceTypes:
    ReservationOptionGroupResourceTypeRelease[] =
    [];

  let requiredResourcesAfter =
    0;

  let assignedResourcesBefore =
    0;

  let keptResources =
    0;

  let releasedResources =
    0;

  for (
    const member of
    members
  ) {
    const reservationOptionId =
      member
        .reservationOptionId
        .trim();

    if (
      !reservationOptionId
    ) {
      throw new Error(
        "OPTION_GROUP_RESOURCE_RELEASE_MEMBER_ID_REQUIRED",
      );
    }

    if (
      seenReservationOptionIds.has(
        reservationOptionId,
      )
    ) {
      throw new Error(
        "DUPLICATE_OPTION_GROUP_RESOURCE_RELEASE_MEMBER",
      );
    }

    seenReservationOptionIds.add(
      reservationOptionId,
    );

    const release =
      resolveReservationOptionResourceRelease({
        activeQuantityAfter:
          member
            .activeQuantityAfter,

        requirements:
          member
            .requirements,

        assignments:
          member
            .assignments,
      });

    const memberKept =
      release.kept.map(
        (
          item,
        ) => ({
          reservationOptionId,

          ...item,
        }),
      );

    const memberReleased =
      release.released.map(
        (
          item,
        ) => ({
          reservationOptionId,

          ...item,
        }),
      );

    const memberResourceTypes =
      release.resourceTypes.map(
        (
          resourceType,
        ) => ({
          reservationOptionId,

          ...resourceType,
        }),
      );

    memberResults.push({
      reservationOptionId,

      activeQuantityAfter:
        release
          .activeQuantityAfter,

      requiredResourcesAfter:
        release
          .requiredResourcesAfter,

      assignedResourcesBefore:
        release
          .assignedResourcesBefore,

      keptResources:
        release
          .keptResources,

      releasedResources:
        release
          .releasedResources,

      kept:
        memberKept,

      released:
        memberReleased,

      resourceTypes:
        memberResourceTypes,
    });

    kept.push(
      ...memberKept,
    );

    released.push(
      ...memberReleased,
    );

    resourceTypes.push(
      ...memberResourceTypes,
    );

    requiredResourcesAfter =
      addSafeInteger(
        requiredResourcesAfter,

        release
          .requiredResourcesAfter,
      );

    assignedResourcesBefore =
      addSafeInteger(
        assignedResourcesBefore,

        release
          .assignedResourcesBefore,
      );

    keptResources =
      addSafeInteger(
        keptResources,

        release
          .keptResources,
      );

    releasedResources =
      addSafeInteger(
        releasedResources,

        release
          .releasedResources,
      );
  }

  return {
    affectedMembers:
      memberResults.length,

    requiredResourcesAfter,

    assignedResourcesBefore,

    keptResources,

    releasedResources,

    kept,

    released,

    resourceTypes,

    members:
      memberResults,
  };
}