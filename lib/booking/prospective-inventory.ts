import {
  getResourceTypeInventoryState,
  type ResourceTypeInventoryDb,
} from "@/lib/booking/resource-type-inventory";

import { prisma } from "@/lib/prisma";

export type ProspectiveInventoryDemand = {
  resourceTypeId: string;

  startAt: Date;
  endAt: Date;

  /*
   * Cantidad física absoluta de Resources
   * que esta nueva compra necesita.
   *
   * Ejemplos:
   *
   * Habitación:
   * requiredQuantity = 1
   *
   * 2 camas extra:
   * requiredResources = 2
   */
  requiredResources: number;

  /*
   * Solo sirve para diagnóstico.
   *
   * No participa en el cálculo.
   */
  source?: string;
};

export type ProspectiveInventorySegment = {
  resourceTypeId: string;

  startAt: Date;
  endAt: Date;

  prospectiveDemand: number;

  availableBeforeDemand: number;
  availableAfterDemand: number;

  sufficient: boolean;

  sources: string[];
};

export type ProspectiveInventoryEvaluation = {
  available: boolean;

  segments:
    ProspectiveInventorySegment[];

  shortages:
    ProspectiveInventorySegment[];
};

type EvaluateProspectiveInventoryInput = {
  businessId: string;

  /*
   * Service que intenta consumir
   * el inventario.
   *
   * Se usa para respetar Blocks
   * específicos del Service.
   */
  serviceId?: string;

  demands:
    ProspectiveInventoryDemand[];

  excludeReservationId?: string;

  db?: ResourceTypeInventoryDb;
};

function validateDemand(
  demand:
    ProspectiveInventoryDemand,
) {
  if (
    demand.endAt <=
    demand.startAt
  ) {
    throw new Error(
      "INVALID_PROSPECTIVE_INVENTORY_INTERVAL",
    );
  }

  if (
    !Number.isInteger(
      demand.requiredResources,
    ) ||
    demand.requiredResources <
      1
  ) {
    throw new Error(
      "INVALID_PROSPECTIVE_INVENTORY_QUANTITY",
    );
  }
}

export async function evaluateProspectiveInventory({
  businessId,

  serviceId,

  demands,

  excludeReservationId,

  db = prisma,
}: EvaluateProspectiveInventoryInput): Promise<ProspectiveInventoryEvaluation> {
  for (
    const demand of
    demands
  ) {
    validateDemand(
      demand,
    );
  }

  /*
   * Cada ResourceType es un pool
   * físico independiente.
   */
  const demandByResourceType =
    new Map<
      string,
      ProspectiveInventoryDemand[]
    >();

  for (
    const demand of
    demands
  ) {
    const current =
      demandByResourceType.get(
        demand.resourceTypeId,
      ) ?? [];

    current.push(
      demand,
    );

    demandByResourceType.set(
      demand.resourceTypeId,
      current,
    );
  }

  const segments:
    ProspectiveInventorySegment[] =
    [];

  /*
   * Para cada ResourceType dividimos
   * el tiempo en segmentos atómicos.
   *
   * Ejemplo:
   *
   * Base:
   * |----------------|
   *
   * Option A:
   * |------|
   *
   * Option B:
   *        |---------|
   *
   * No podemos simplemente sumar A+B
   * durante toda la reserva.
   */
  for (
    const [
      resourceTypeId,
      resourceTypeDemands,
    ] of demandByResourceType
  ) {
    const boundaries = [
      ...new Set(
        resourceTypeDemands
          .flatMap(
            (demand) => [
              demand.startAt.getTime(),
              demand.endAt.getTime(),
            ],
          ),
      ),
    ].sort(
      (first, second) =>
        first - second,
    );

    for (
      let index = 0;
      index <
      boundaries.length - 1;
      index++
    ) {
      const segmentStartAt =
        new Date(
          boundaries[index],
        );

      const segmentEndAt =
        new Date(
          boundaries[index + 1],
        );

      if (
        segmentEndAt <=
        segmentStartAt
      ) {
        continue;
      }

      const activeDemands =
        resourceTypeDemands.filter(
          (demand) =>
            demand.startAt <
              segmentEndAt &&
            demand.endAt >
              segmentStartAt,
        );

      if (
        activeDemands.length ===
        0
      ) {
        continue;
      }

      const prospectiveDemand =
        activeDemands.reduce(
          (
            total,
            demand,
          ) =>
            total +
            demand.requiredResources,

          0,
        );

      /*
       * Inventario disponible antes
       * de insertar la nueva reserva.
       *
       * Este cálculo ya contempla:
       *
       * - ReservationService existentes
       * - ReservationOption existentes
       * - assignments
       * - demanda sin asignar
       * - Blocks
       */
      const inventory =
        await getResourceTypeInventoryState({
          businessId,

          resourceTypeId,

          startAt:
            segmentStartAt,

          endAt:
            segmentEndAt,

          serviceId,

          excludeReservationId,

          db,
        });

      const availableBeforeDemand =
        inventory
          .availableResourceCount;

      const availableAfterDemand =
        Math.max(
          availableBeforeDemand -
            prospectiveDemand,

          0,
        );

      const sufficient =
        availableBeforeDemand >=
        prospectiveDemand;

      segments.push({
        resourceTypeId,

        startAt:
          segmentStartAt,

        endAt:
          segmentEndAt,

        prospectiveDemand,

        availableBeforeDemand,

        availableAfterDemand,

        sufficient,

        sources:
          activeDemands
            .map(
              (demand) =>
                demand.source ??
                "UNKNOWN",
            ),
      });
    }
  }

  const shortages =
    segments.filter(
      (segment) =>
        !segment.sufficient,
    );

  return {
    available:
      shortages.length ===
      0,

    segments,

    shortages,
  };
}

export function assertProspectiveInventoryAvailable(
  evaluation:
    ProspectiveInventoryEvaluation,
) {
  if (
    !evaluation.available
  ) {
    throw new Error(
      "PROSPECTIVE_INVENTORY_NOT_AVAILABLE",
    );
  }
}
