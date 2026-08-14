export type AvailabilityBlock = {
  serviceId: string | null;
  resourceTypeId: string | null;
  resourceId: string | null;
};

export function getOverlapWhere(startAt: Date, endAt: Date) {
  return {
    startAt: {
      lt: endAt,
    },

    endAt: {
      gt: startAt,
    },
  };
}

export function isBusinessBlocked(blocks: AvailabilityBlock[]) {
  return blocks.some(
    (block) =>
      block.serviceId === null &&
      block.resourceTypeId === null &&
      block.resourceId === null,
  );
}

export function isServiceBlocked(
  blocks: AvailabilityBlock[],
  serviceId: string,
) {
  return blocks.some(
    (block) =>
      block.serviceId === serviceId &&
      block.resourceTypeId === null &&
      block.resourceId === null,
  );
}

export function isResourceTypeBlocked(
  blocks: AvailabilityBlock[],
  serviceId: string,
  resourceTypeId: string,
) {
  return blocks.some(
    (block) =>
      block.resourceId === null &&
      block.resourceTypeId === resourceTypeId &&
      (block.serviceId === null || block.serviceId === serviceId),
  );
}

export function getBlockedResourceIds(
  blocks: AvailabilityBlock[],
  resourceIds: Set<string>,
) {
  return new Set(
    blocks
      .filter(
        (block) =>
          block.resourceId !== null && resourceIds.has(block.resourceId),
      )
      .map((block) => block.resourceId as string),
  );
}

export function isResourceBlocked(
  blocks: AvailabilityBlock[],
  input: {
    serviceId: string;
    resourceTypeId: string;
    resourceId: string;
  },
) {
  const { serviceId, resourceTypeId, resourceId } = input;

  if (isBusinessBlocked(blocks)) {
    return true;
  }

  if (isServiceBlocked(blocks, serviceId)) {
    return true;
  }

  if (isResourceTypeBlocked(blocks, serviceId, resourceTypeId)) {
    return true;
  }

  return blocks.some((block) => block.resourceId === resourceId);
}
