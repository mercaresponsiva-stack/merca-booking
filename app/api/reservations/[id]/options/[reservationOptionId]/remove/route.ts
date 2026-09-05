import {
  allocateRefundAcrossPayments,
} from "@/lib/booking/refund-allocation";

import {
  calculatePaymentSummary,
} from "@/lib/booking/payment-summary";

import {
  calculateReservationFinancialState,
} from "@/lib/booking/reservation-financial-state";

import {
  resolveReservationOptionGroupRemoval,
} from "@/lib/booking/reservation-option-group-removal";

import {
  getReservationOptionOperationalGroupKey,
} from "@/lib/booking/reservation-option-operational-group";

import {
  resolveReservationOptionGroupResourceRelease,
} from "@/lib/booking/reservation-option-group-resource-release";

import {
  resolveReservationPriceDecrease,
} from "@/lib/booking/reservation-price-decrease";

import {
  isReservationActive,
} from "@/lib/booking/reservation-state";

import {
  NextRequest,
  NextResponse,
} from "next/server";

import { prisma } from "@/lib/prisma";

import {
  AuthorizationError,
  requireAuthenticatedUser,
  requireBusinessAccess,
} from "@/lib/auth/business-access";

export const dynamic =
  "force-dynamic";

const RESERVATION_OPTION_WRITE_ALLOWED_ROLES = [
  "OWNER",
  "ADMIN",
  "RECEPTIONIST",
] as const;

function privateJson(
  body: unknown,
  init: ResponseInit = {},
) {
  const headers =
    new Headers(
      init.headers,
    );

  headers.set(
    "Cache-Control",
    "private, no-store, max-age=0, must-revalidate",
  );
  headers.set(
    "Pragma",
    "no-cache",
  );
  headers.set(
    "Expires",
    "0",
  );
  headers.set(
    "X-Robots-Tag",
    "noindex, nofollow",
  );

  return NextResponse.json(
    body,
    {
      ...init,
      headers,
    },
  );
}

function isJsonObject(
  value: unknown,
): value is Record<
  string,
  unknown
> {
  return (
    typeof value ===
      "object" &&
    value !==
      null &&
    !Array.isArray(
      value,
    )
  );
}

function isPositiveInteger(
  value: unknown,
): value is number {
  return (
    typeof value ===
      "number" &&
    Number.isInteger(
      value,
    ) &&
    value >
      0
  );
}

function isRemovalConflict(
  code: string,
) {
  return (
    code ===
      "OPTION_REMOVE_RESERVATION_STATUS_NOT_ALLOWED" ||
    code ===
      "OPTION_REMOVE_ACTIVE_REFUND_EXISTS" ||
    code ===
      "OPTION_REMOVE_RESOURCE_CONFIGURATION_UNAVAILABLE" ||
    code ===
      "OPTION_REMOVE_ASSIGNED_RESOURCE_TYPE_REQUIRED" ||
    code ===
      "RESERVATION_OPTION_HAS_NO_ACTIVE_OPTIONAL_QUANTITY" ||
    code ===
      "RESERVATION_OPTION_REMOVE_QUANTITY_EXCEEDS_ACTIVE" ||
    code ===
      "RESERVATION_OPTION_REMOVAL_INCREASES_SUBTOTAL" ||
    code ===
      "RESERVATION_PRICE_DECREASE_EXCEEDS_CONTRACT" ||
    code ===
      "INSUFFICIENT_REFUNDABLE_PAYMENT_PRINCIPAL"
  );
}

export async function PATCH(
  request: NextRequest,

  context: {
    params: Promise<{
      id: string;
      reservationOptionId: string;
    }>;
  },
) {
  try {
    await requireAuthenticatedUser();

    const {
      id,
      reservationOptionId,
    } =
      await context.params;

    // ─────────────────────────────────────────────
    // 1. BODY
    // ─────────────────────────────────────────────

    let parsedBody:
      unknown;

    try {
      parsedBody =
        await request.json();
    } catch {
      return privateJson(
        {
          success:
            false,

          code:
            "INVALID_JSON",

          error:
            "El cuerpo de la solicitud no es JSON válido.",
        },
        {
          status:
            400,
        },
      );
    }

    if (
      !isJsonObject(
        parsedBody,
      )
    ) {
      return privateJson(
        {
          success:
            false,

          code:
            "INVALID_RESERVATION_OPTION_REMOVE_BODY",

          error:
            "El cuerpo de la solicitud debe ser un objeto JSON válido.",
        },
        {
          status:
            400,
        },
      );
    }

    const body =
      parsedBody;

    // El changedById recibido por compatibilidad no se usa para auditoría.

    const removeOptionalQuantity =
      body.removeOptionalQuantity;

    const reason =
      typeof body.reason ===
        "string" &&
      body.reason.trim()
        ? body.reason.trim()
        : null;

    if (
      !isPositiveInteger(
        removeOptionalQuantity,
      )
    ) {
      return privateJson(
        {
          success:
            false,

          code:
            "INVALID_RESERVATION_OPTION_REMOVE_QUANTITY",

          error:
            "La cantidad a retirar debe ser un entero mayor que cero.",
        },
        {
          status:
            400,
        },
      );
    }

    // Solo averiguamos el negocio antes de autorizar la operación.
    const reservationScope =
      await prisma.reservation.findUnique({
        where: {
          id,
        },

        select: {
          businessId:
            true,
        },
      });

    if (
      !reservationScope
    ) {
      throw new Error(
        "RESERVATION_NOT_FOUND",
      );
    }

    const access =
      await requireBusinessAccess(
        reservationScope.businessId,

        RESERVATION_OPTION_WRITE_ALLOWED_ROLES,
      );

    const requestedAt =
      new Date();

    // ─────────────────────────────────────────────
    // 2. SERIALIZABLE TRANSACTION
    // ─────────────────────────────────────────────

    const result =
      await prisma.$transaction(
        async (
          tx,
        ) => {
          // ─────────────────────────────────────────
          // 3. RESERVATION
          // ─────────────────────────────────────────

          const reservation =
            await tx.reservation.findUnique({
              where: {
                id,
              },

              include: {
                business: {
                  select: {
                    id:
                      true,

                    isActive:
                      true,
                  },
                },

                payments: {
                  include: {
                    refunds: {
                      select: {
                        baseAmount:
                          true,

                        amount:
                          true,

                        status:
                          true,
                      },
                    },
                  },

                  orderBy: {
                    createdAt:
                      "asc",
                  },
                },

                refunds: {
                  select: {
                    id:
                      true,

                    status:
                      true,
                  },
                },
              },
            });

          if (
            !reservation
          ) {
            throw new Error(
              "RESERVATION_NOT_FOUND",
            );
          }

          if (
            !reservation
              .business
              .isActive
          ) {
            throw new Error(
              "BUSINESS_NOT_ACTIVE",
            );
          }

          // ─────────────────────────────────────────
          // 4. ACTOR
          // ─────────────────────────────────────────

          const actor =
            await tx.user.findFirst({
              where: {
                id:
                  access.user.id,

                businessId:
                  reservation
                    .businessId,

                isActive:
                  true,
              },

              select: {
                id:
                  true,

                name:
                  true,

                role:
                  true,
              },
            });

          if (
            !actor
          ) {
            throw new Error(
              "OPTION_REMOVE_ACTOR_NOT_VALID",
            );
          }

          // ─────────────────────────────────────────
          // 5. RESERVATION STATE
          // ─────────────────────────────────────────

          if (
            !isReservationActive(
              reservation.status,
            )
          ) {
            throw new Error(
              "OPTION_REMOVE_RESERVATION_STATUS_NOT_ALLOWED",
            );
          }

          /*
           * Igual que OPTION_ADDED y RESCHEDULE:
           *
           * no modificamos el contrato mientras
           * exista una devolución todavía en curso.
           */
          const hasActiveRefund =
            reservation.refunds.some(
              (
                refund,
              ) =>
                refund.status ===
                  "PENDING" ||
                refund.status ===
                  "PROCESSING",
            );

          if (
            hasActiveRefund
          ) {
            throw new Error(
              "OPTION_REMOVE_ACTIVE_REFUND_EXISTS",
            );
          }

          // ─────────────────────────────────────────
          // 6. RESERVATION OPTION SNAPSHOTS
          //
          // Recuperamos todas las líneas de la
          // reserva y resolvemos en memoria el
          // grupo operacional del ID solicitado.
          //
          // Las filas siguen siendo independientes:
          // solamente se agrupan para esta operación.
          // ─────────────────────────────────────────

          const reservationOptions =
            await tx.reservationOption.findMany({
              where: {
                reservationId:
                  reservation.id,
              },

              select: {
                id:
                  true,

                reservationId:
                  true,

                reservationServiceId:
                  true,

                optionId:
                  true,

                serviceOptionId:
                  true,

                name:
                  true,

                description:
                  true,

                quantity:
                  true,

                includedQuantity:
                  true,

                optionalQuantity:
                  true,

                removedOptionalQuantity:
                  true,

                unitPrice:
                  true,

                pricingBase:
                  true,

                pricingFrequency:
                  true,

                billingUnits:
                  true,

                subtotal:
                  true,

                startAt:
                  true,

                endAt:
                  true,

                createdAt:
                  true,

                serviceOption: {
                  select: {
                    resourceTypes: {
                      select: {
                        resourceTypeId:
                          true,

                        requiredQuantity:
                          true,
                      },
                    },
                  },
                },

                resources: {
                  select: {
                    id:
                      true,

                    resourceId:
                      true,

                    createdAt:
                      true,

                    resource: {
                      select: {
                        resourceTypeId:
                          true,
                      },
                    },
                  },

                  orderBy: [
                    {
                      createdAt:
                        "asc",
                    },
                    {
                      id:
                        "asc",
                    },
                  ],
                },
              },

              orderBy: [
                {
                  createdAt:
                    "asc",
                },
                {
                  id:
                    "asc",
                },
              ],
            });

          const reservationOption =
            reservationOptions.find(
              (
                option,
              ) =>
                option.id ===
                reservationOptionId,
            ) ??
            null;

          if (
            !reservationOption
          ) {
            throw new Error(
              "RESERVATION_OPTION_NOT_FOUND",
            );
          }

          const operationalGroupKey =
            getReservationOptionOperationalGroupKey({
              reservationId:
                reservationOption
                  .reservationId,

              reservationOptionId:
                reservationOption
                  .id,

              reservationServiceId:
                reservationOption
                  .reservationServiceId,

              serviceOptionId:
                reservationOption
                  .serviceOptionId,

              optionId:
                reservationOption
                  .optionId,

              startAt:
                reservationOption
                  .startAt,

              endAt:
                reservationOption
                  .endAt,
            });

          const groupReservationOptions =
            reservationOptions.filter(
              (
                option,
              ) =>
                getReservationOptionOperationalGroupKey({
                  reservationId:
                    option
                      .reservationId,

                  reservationOptionId:
                    option.id,

                  reservationServiceId:
                    option
                      .reservationServiceId,

                  serviceOptionId:
                    option
                      .serviceOptionId,

                  optionId:
                    option
                      .optionId,

                  startAt:
                    option
                      .startAt,

                  endAt:
                    option
                      .endAt,
                }) ===
                operationalGroupKey,
            );

          if (
            groupReservationOptions
              .length ===
            0
          ) {
            throw new Error(
              "RESERVATION_OPTION_GROUP_MEMBERS_REQUIRED",
            );
          }

          // ─────────────────────────────────────────
          // 7. CURRENT FINANCIAL STATE
          // ─────────────────────────────────────────

          const currentPaymentSummary =
            calculatePaymentSummary({
              total:
                Number(
                  reservation
                    .total,
                ),

              paymentOption:
                reservation
                  .paymentOption,

              payments:
                reservation
                  .payments,
            });

          // ─────────────────────────────────────────
          // 8. OPERATIONAL GROUP REMOVAL
          //
          // La cantidad solicitada se distribuye
          // desde las compras más recientes hacia
          // las más antiguas.
          // ─────────────────────────────────────────

          const removal =
            resolveReservationOptionGroupRemoval({
              members:
                groupReservationOptions.map(
                  (
                    option,
                  ) => ({
                    reservationOptionId:
                      option.id,

                    createdAt:
                      option
                        .createdAt,

                    includedQuantity:
                      option
                        .includedQuantity,

                    optionalQuantity:
                      option
                        .optionalQuantity,

                    removedOptionalQuantity:
                      option
                        .removedOptionalQuantity,

                    unitPrice:
                      option
                        .unitPrice
                        .toString(),

                    pricingBase:
                      option
                        .pricingBase,

                    pricingFrequency:
                      option
                        .pricingFrequency,

                    billingUnits:
                      Number(
                        option
                          .billingUnits,
                      ),

                    currentSubtotal:
                      Number(
                        option
                          .subtotal,
                      ),
                  }),
                ),

              removeOptionalQuantity,
            });

          const groupOptionsById =
            new Map(
              groupReservationOptions.map(
                (
                  option,
                ) => [
                  option.id,
                  option,
                ] as const,
              ),
            );

          const affectedReservationOptions =
            removal
              .affectedMembers
              .map(
                (
                  affectedMember,
                ) => {
                  const option =
                    groupOptionsById.get(
                      affectedMember
                        .reservationOptionId,
                    );

                  if (
                    !option
                  ) {
                    throw new Error(
                      "RESERVATION_OPTION_GROUP_MEMBER_NOT_FOUND",
                    );
                  }

                  return {
                    reservationOption:
                      option,

                    removal:
                      affectedMember
                        .removal,
                  };
                },
              );

          const primaryAffectedReservationOption =
            affectedReservationOptions[0];

          if (
            !primaryAffectedReservationOption
          ) {
            throw new Error(
              "RESERVATION_OPTION_GROUP_REMOVAL_NOT_FULLY_ALLOCATED",
            );
          }

          // ─────────────────────────────────────────
          // 9. PHYSICAL RESOURCE RELEASE
          //
          // Solo evaluamos las líneas afectadas.
          // Una línea no afectada conserva todas
          // sus asignaciones intactas.
          // ─────────────────────────────────────────

          const resourceRelease =
            resolveReservationOptionGroupResourceRelease({
              members:
                affectedReservationOptions.map(
                  ({
                    reservationOption:
                      affectedOption,

                    removal:
                      affectedRemoval,
                  }) => {
                    const hasAssignedResources =
                      affectedOption
                        .resources
                        .length >
                      0;

                    if (
                      affectedRemoval
                        .activeQuantityAfter >
                        0 &&
                      hasAssignedResources &&
                      !affectedOption
                        .serviceOption
                    ) {
                      throw new Error(
                        "OPTION_REMOVE_RESOURCE_CONFIGURATION_UNAVAILABLE",
                      );
                    }

                    const resourceRequirements =
                      affectedRemoval
                        .activeQuantityAfter ===
                        0
                        ? []
                        : affectedOption
                            .serviceOption
                            ?.resourceTypes
                            .map(
                              (
                                requirement,
                              ) => ({
                                resourceTypeId:
                                  requirement
                                    .resourceTypeId,

                                requiredQuantity:
                                  requirement
                                    .requiredQuantity,
                              }),
                            ) ??
                          [];

                    const assignments =
                      affectedOption
                        .resources
                        .map(
                          (
                            assignment,
                          ) => {
                            const resourceTypeId =
                              assignment
                                .resource
                                .resourceTypeId;

                            if (
                              !resourceTypeId
                            ) {
                              throw new Error(
                                "OPTION_REMOVE_ASSIGNED_RESOURCE_TYPE_REQUIRED",
                              );
                            }

                            return {
                              assignmentId:
                                assignment.id,

                              resourceId:
                                assignment
                                  .resourceId,

                              resourceTypeId,

                              createdAt:
                                assignment
                                  .createdAt,
                            };
                          },
                        );

                    return {
                      reservationOptionId:
                        affectedOption.id,

                      activeQuantityAfter:
                        affectedRemoval
                          .activeQuantityAfter,

                      requirements:
                        resourceRequirements,

                      assignments,
                    };
                  },
                ),
            });

          // ─────────────────────────────────────────
          // 10. RESERVATION PRICE DECREASE
          // ─────────────────────────────────────────

          const financialImpact =
            resolveReservationPriceDecrease({
              currentSubtotal:
                Number(
                  reservation
                    .subtotal,
                ),

              currentTotal:
                Number(
                  reservation
                    .total,
                ),

              priceReduction:
                removal
                  .priceReduction,

              netPaid:
                currentPaymentSummary
                  .netPaid,
            });

          // ─────────────────────────────────────────
          // 10. REFUND ALLOCATION
          //
          // Calculamos ANTES de modificar nada.
          //
          // Si overpayment = 0:
          // allocations = [].
          //
          // Si existe sobrepago:
          // se distribuye entre Payment PAID.
          // ─────────────────────────────────────────

          const refundAllocation =
            allocateRefundAcrossPayments({
              amount:
                financialImpact
                  .overpayment,

              payments:
                reservation
                  .payments,
            });

          // ─────────────────────────────────────────
          // 11. AUDIT
          // ─────────────────────────────────────────

          const change =
            await tx.reservationChange.create({
              data: {
                businessId:
                  reservation
                    .businessId,

                reservationId:
                  reservation.id,

                type:
                  "OPTION_REMOVED",

                changedById:
                  actor.id,

                reason,

                oldSubtotal:
                  reservation
                    .subtotal,

                newSubtotal:
                  financialImpact
                    .newSubtotal,

                oldTotal:
                  reservation
                    .total,

                newTotal:
                  financialImpact
                    .newTotal,

                oldStatus:
                  reservation
                    .status,

                newStatus:
                  reservation
                    .status,

                details: {
                  action:
                    "OPTION_REMOVED",

                  operationalGroupKey,

                  representativeReservationOptionId:
                    reservationOption.id,

                  reservationOptionIds:
                    groupReservationOptions.map(
                      (
                        option,
                      ) =>
                        option.id,
                    ),

                  affectedReservationOptionIds:
                    removal
                      .affectedReservationOptionIds,

                  reservationServiceId:
                    reservationOption
                      .reservationServiceId,

                  optionId:
                    reservationOption
                      .optionId,

                  serviceOptionId:
                    reservationOption
                      .serviceOptionId,

                  name:
                    reservationOption.name,

                  groupMemberCount:
                    groupReservationOptions
                      .length,

                  affectedMemberCount:
                    removal
                      .affectedMembers
                      .length,

                  originalQuantity:
                    removal
                      .originalQuantity,

                  includedQuantity:
                    removal
                      .includedQuantity,

                  originalOptionalQuantity:
                    removal
                      .originalOptionalQuantity,

                  removedOptionalQuantityBefore:
                    removal
                      .removedOptionalQuantityBefore,

                  removeOptionalQuantity:
                    removal
                      .removeOptionalQuantity,

                  removedOptionalQuantityAfter:
                    removal
                      .removedOptionalQuantityAfter,

                  activeOptionalQuantityBefore:
                    removal
                      .activeOptionalQuantityBefore,

                  activeOptionalQuantityAfter:
                    removal
                      .activeOptionalQuantityAfter,

                  activeQuantityBefore:
                    removal
                      .activeQuantityBefore,

                  activeQuantityAfter:
                    removal
                      .activeQuantityAfter,

                  oldOptionSubtotal:
                    removal
                      .oldSubtotal,

                  newOptionSubtotal:
                    removal
                      .newSubtotal,

                  priceReduction:
                    removal
                      .priceReduction,

                  isFullyRemovedAfter:
                    removal
                      .isFullyRemovedAfter,

                  refundRequired:
                    financialImpact
                      .overpayment,

                  memberRemovals:
                    affectedReservationOptions.map(
                      ({
                        reservationOption:
                          affectedOption,

                        removal:
                          affectedRemoval,
                      }) => ({
                        reservationOptionId:
                          affectedOption.id,

                        createdAt:
                          affectedOption
                            .createdAt
                            .toISOString(),

                        originalQuantity:
                          affectedOption
                            .quantity,

                        includedQuantity:
                          affectedRemoval
                            .includedQuantity,

                        originalOptionalQuantity:
                          affectedRemoval
                            .originalOptionalQuantity,

                        removedOptionalQuantityBefore:
                          affectedRemoval
                            .removedOptionalQuantityBefore,

                        removeOptionalQuantity:
                          affectedRemoval
                            .removeOptionalQuantity,

                        removedOptionalQuantityAfter:
                          affectedRemoval
                            .removedOptionalQuantityAfter,

                        activeOptionalQuantityBefore:
                          affectedRemoval
                            .activeOptionalQuantityBefore,

                        activeOptionalQuantityAfter:
                          affectedRemoval
                            .activeOptionalQuantityAfter,

                        activeQuantityBefore:
                          affectedRemoval
                            .activeQuantityBefore,

                        activeQuantityAfter:
                          affectedRemoval
                            .activeQuantityAfter,

                        unitPrice:
                          affectedRemoval
                            .unitPrice,

                        pricingBase:
                          affectedRemoval
                            .pricingBase,

                        pricingFrequency:
                          affectedRemoval
                            .pricingFrequency,

                        billingUnits:
                          affectedRemoval
                            .billingUnits,

                        oldSubtotal:
                          affectedRemoval
                            .oldSubtotal,

                        newSubtotal:
                          affectedRemoval
                            .newSubtotal,

                        priceReduction:
                          affectedRemoval
                            .priceReduction,

                        isFullyRemovedAfter:
                          affectedRemoval
                            .isFullyRemovedAfter,
                      }),
                    ),

                  resources: {
                    affectedMembers:
                      resourceRelease
                        .affectedMembers,

                    requiredResourcesAfter:
                      resourceRelease
                        .requiredResourcesAfter,

                    assignedResourcesBefore:
                      resourceRelease
                        .assignedResourcesBefore,

                    keptResources:
                      resourceRelease
                        .keptResources,

                    releasedResources:
                      resourceRelease
                        .releasedResources,

                    kept:
                      resourceRelease
                        .kept,

                    released:
                      resourceRelease
                        .released,

                    resourceTypes:
                      resourceRelease
                        .resourceTypes,

                    members:
                      resourceRelease
                        .members,
                  },

                  requestedAt:
                    requestedAt
                      .toISOString(),
                },
              },
            });

          // ─────────────────────────────────────────
          // 12. UPDATE RESERVATION OPTIONS
          //
          // quantity y optionalQuantity originales
          // permanecen intactos en cada snapshot.
          // ─────────────────────────────────────────

          const updatedOptions =
            [];

          for (
            const affected of
            affectedReservationOptions
          ) {
            const updatedOption =
              await tx.reservationOption.update({
                where: {
                  id:
                    affected
                      .reservationOption
                      .id,
                },

                data: {
                  removedOptionalQuantity:
                    affected
                      .removal
                      .removedOptionalQuantityAfter,

                  subtotal:
                    affected
                      .removal
                      .newSubtotal,
                },

                select: {
                  id:
                    true,

                  name:
                    true,

                  quantity:
                    true,

                  includedQuantity:
                    true,

                  optionalQuantity:
                    true,

                  removedOptionalQuantity:
                    true,

                  unitPrice:
                    true,

                  pricingBase:
                    true,

                  pricingFrequency:
                    true,

                  billingUnits:
                    true,

                  subtotal:
                    true,

                  startAt:
                    true,

                  endAt:
                    true,

                  updatedAt:
                    true,
                },
              });

            updatedOptions.push(
              updatedOption,
            );
          }

          const updatedOption =
            updatedOptions[0];

          if (
            !updatedOption
          ) {
            throw new Error(
              "RESERVATION_OPTION_GROUP_UPDATE_REQUIRED",
            );
          }

          const primaryRemoval =
            primaryAffectedReservationOption
              .removal;

          // ─────────────────────────────────────────
          // 13. RELEASE PHYSICAL ASSIGNMENTS
          //
          // Solo eliminamos los IDs decididos por
          // los helpers y pertenecientes a alguna
          // de las líneas afectadas.
          // ─────────────────────────────────────────

          const releasedAssignmentIds =
            resourceRelease
              .released
              .map(
                (
                  assignment,
                ) =>
                  assignment
                    .assignmentId,
              );

          if (
            releasedAssignmentIds
              .length >
            0
          ) {
            await tx.reservationResource.deleteMany({
              where: {
                id: {
                  in:
                    releasedAssignmentIds,
                },

                reservationId:
                  reservation.id,

                reservationOptionId: {
                  in:
                    removal
                      .affectedReservationOptionIds,
                },
              },
            });
          }

          // ─────────────────────────────────────────
          // 14. UPDATE RESERVATION CONTRACT
          // ─────────────────────────────────────────

          await tx.reservation.update({
            where: {
              id:
                reservation.id,
            },

            data: {
              subtotal:
                financialImpact
                  .newSubtotal,

              total:
                financialImpact
                  .newTotal,
            },
          });

          // ─────────────────────────────────────────
          // 14. PRICE ADJUSTMENT REFUNDS
          //
          // Payment permanece PAID.
          //
          // Los Refund recién creados quedan
          // PENDING y pertenecen al mismo
          // ReservationChange, por lo que el
          // administrador puede tratarlos como
          // una sola operación lógica.
          // ─────────────────────────────────────────

          const createdRefunds =
            [];

          for (
            const allocation of
            refundAllocation
              .allocations
          ) {
            const refund =
              await tx.refund.create({
                data: {
                  businessId:
                    reservation
                      .businessId,

                  reservationId:
                    reservation
                      .id,

                  paymentId:
                    allocation
                      .paymentId,

                  reservationChangeId:
                    change.id,

                  basis:
                    "PRICE_ADJUSTMENT",

                  baseAmount:
                    allocation
                      .baseAmount,

                  maxAdministrativeRetention:
                    0,

                  administrativeRetention:
                    0,

                  amount:
                    allocation
                      .amount,

                  status:
                    "PENDING",

                  reason:
                    reason
                      ? `Ajuste de precio por retiro de complemento: ${reason}`
                      : "Ajuste de precio por retiro de complemento",

                  requestedAt,
                },
              });

            createdRefunds.push(
              refund,
            );
          }

          // ─────────────────────────────────────────
          // 15. FINAL RESERVATION
          //
          // Reconsultamos porque cualquier Refund
          // PENDING recién creado debe aparecer en
          // el nuevo paymentSummary.
          // ─────────────────────────────────────────

          const updatedReservation =
            await tx.reservation.findUniqueOrThrow({
              where: {
                id:
                  reservation.id,
              },

              include: {
                payments: {
                  include: {
                    refunds: {
                      select: {
                        id:
                          true,

                        basis:
                          true,

                        baseAmount:
                          true,

                        amount:
                          true,

                        status:
                          true,
                      },
                    },
                  },

                  orderBy: {
                    createdAt:
                      "asc",
                  },
                },
              },
            });

          // ─────────────────────────────────────────
          // 16. NEW FINANCIAL STATE
          //
          // Refund PENDING:
          //
          // refundPending aumenta,
          // netPaid todavía NO disminuye.
          // ─────────────────────────────────────────

          const paymentSummary =
            calculatePaymentSummary({
              total:
                Number(
                  updatedReservation
                    .total,
                ),

              paymentOption:
                updatedReservation
                  .paymentOption,

              payments:
                updatedReservation
                  .payments,
            });

          const financialState =
            calculateReservationFinancialState({
              status:
                updatedReservation
                  .status,

              paymentSummary,
            });

          return {
            reservation:
              updatedReservation,

            option:
              updatedOption,

            options:
              updatedOptions,

            removal:
              primaryRemoval,

            groupRemoval:
              removal,

            operationalGroupKey,

            reservationOptionIds:
              groupReservationOptions.map(
                (
                  option,
                ) =>
                  option.id,
              ),

            resourceRelease,

            financialImpact,

            refundAllocation,

            createdRefunds,

            change,

            paymentSummary,

            financialState,
          };
        },

        {
          isolationLevel:
            "Serializable",
        },
      );

    // ─────────────────────────────────────────────
    // 17. RESPONSE
    // ─────────────────────────────────────────────

    return privateJson({
      success:
        true,

      reservation: {
        id:
          result
            .reservation
            .id,

        confirmationCode:
          result
            .reservation
            .confirmationCode,

        status:
          result
            .reservation
            .status,

        subtotal:
          Number(
            result
              .reservation
              .subtotal,
          ),

        total:
          Number(
            result
              .reservation
              .total,
          ),

        paymentOption:
          result
            .reservation
            .paymentOption,

        updatedAt:
          result
            .reservation
            .updatedAt,
      },

      option: {
        id:
          result
            .option
            .id,

        name:
          result
            .option
            .name,

        /*
         * Snapshot original.
         */
        quantity:
          result
            .option
            .quantity,

        includedQuantity:
          result
            .option
            .includedQuantity,

        optionalQuantity:
          result
            .option
            .optionalQuantity,

        /*
         * Estado de retiro acumulado.
         */
        removedOptionalQuantity:
          result
            .option
            .removedOptionalQuantity,

        activeOptionalQuantity:
          result
            .removal
            .activeOptionalQuantityAfter,

        activeQuantity:
          result
            .removal
            .activeQuantityAfter,

        unitPrice:
          Number(
            result
              .option
              .unitPrice,
          ),

        pricingBase:
          result
            .option
            .pricingBase,

        pricingFrequency:
          result
            .option
            .pricingFrequency,

        billingUnits:
          Number(
            result
              .option
              .billingUnits,
          ),

        subtotal:
          Number(
            result
              .option
              .subtotal,
          ),

        isFullyRemoved:
          result
            .removal
            .isFullyRemovedAfter,
      },

      removal: {
        removeOptionalQuantity:
          result
            .removal
            .removeOptionalQuantity,

        activeOptionalQuantityBefore:
          result
            .removal
            .activeOptionalQuantityBefore,

        activeOptionalQuantityAfter:
          result
            .removal
            .activeOptionalQuantityAfter,

        oldOptionSubtotal:
          result
            .removal
            .oldSubtotal,

        newOptionSubtotal:
          result
            .removal
            .newSubtotal,

        priceReduction:
          result
            .removal
            .priceReduction,
      },

      optionGroup: {
        operationalGroupKey:
          result
            .operationalGroupKey,

        reservationOptionIds:
          result
            .reservationOptionIds,

        affectedReservationOptionIds:
          result
            .groupRemoval
            .affectedReservationOptionIds,

        removeOptionalQuantity:
          result
            .groupRemoval
            .removeOptionalQuantity,

        originalQuantity:
          result
            .groupRemoval
            .originalQuantity,

        includedQuantity:
          result
            .groupRemoval
            .includedQuantity,

        originalOptionalQuantity:
          result
            .groupRemoval
            .originalOptionalQuantity,

        removedOptionalQuantityBefore:
          result
            .groupRemoval
            .removedOptionalQuantityBefore,

        removedOptionalQuantityAfter:
          result
            .groupRemoval
            .removedOptionalQuantityAfter,

        activeOptionalQuantityBefore:
          result
            .groupRemoval
            .activeOptionalQuantityBefore,

        activeOptionalQuantityAfter:
          result
            .groupRemoval
            .activeOptionalQuantityAfter,

        activeQuantityBefore:
          result
            .groupRemoval
            .activeQuantityBefore,

        activeQuantityAfter:
          result
            .groupRemoval
            .activeQuantityAfter,

        oldSubtotal:
          result
            .groupRemoval
            .oldSubtotal,

        newSubtotal:
          result
            .groupRemoval
            .newSubtotal,

        priceReduction:
          result
            .groupRemoval
            .priceReduction,

        isFullyRemovedAfter:
          result
            .groupRemoval
            .isFullyRemovedAfter,

        members:
          result
            .groupRemoval
            .affectedMembers
            .map(
              (
                member,
              ) => ({
                reservationOptionId:
                  member
                    .reservationOptionId,

                createdAt:
                  member
                    .createdAt,

                removal:
                  member
                    .removal,
              }),
            ),
      },

      change: {
        id:
          result
            .change
            .id,

        type:
          result
            .change
            .type,

        reason:
          result
            .change
            .reason,

        oldSubtotal:
          result
            .change
            .oldSubtotal !==
          null
            ? Number(
                result
                  .change
                  .oldSubtotal,
              )
            : null,

        newSubtotal:
          result
            .change
            .newSubtotal !==
          null
            ? Number(
                result
                  .change
                  .newSubtotal,
              )
            : null,

        oldTotal:
          result
            .change
            .oldTotal !==
          null
            ? Number(
                result
                  .change
                  .oldTotal,
              )
            : null,

        newTotal:
          result
            .change
            .newTotal !==
          null
            ? Number(
                result
                  .change
                  .newTotal,
              )
            : null,

        oldStatus:
          result
            .change
            .oldStatus,

        newStatus:
          result
            .change
            .newStatus,

        details:
          result
            .change
            .details,

        createdAt:
          result
            .change
            .createdAt,
      },

      resources: {
        requiredResourcesAfter:
          result
            .resourceRelease
            .requiredResourcesAfter,

        assignedResourcesBefore:
          result
            .resourceRelease
            .assignedResourcesBefore,

        keptResources:
          result
            .resourceRelease
            .keptResources,

        releasedResources:
          result
            .resourceRelease
            .releasedResources,

        kept:
          result
            .resourceRelease
            .kept,

        released:
          result
            .resourceRelease
            .released,

        resourceTypes:
          result
            .resourceRelease
            .resourceTypes,
      },

      financialImpact:
        result
          .financialImpact,

      refundAllocation:
        result
          .refundAllocation,

      refunds:
        result
          .createdRefunds
          .map(
            (
              refund,
            ) => ({
              id:
                refund.id,

              paymentId:
                refund
                  .paymentId,

              reservationChangeId:
                refund
                  .reservationChangeId,

              basis:
                refund
                  .basis,

              baseAmount:
                Number(
                  refund
                    .baseAmount,
                ),

              amount:
                Number(
                  refund
                    .amount,
                ),

              status:
                refund
                  .status,

              reason:
                refund
                  .reason,

              requestedAt:
                refund
                  .requestedAt,
            }),
          ),

      paymentSummary:
        result
          .paymentSummary,

      financialState:
        result
          .financialState,
    });
  } catch (
    error
  ) {
    if (
      error instanceof
        AuthorizationError
    ) {
      return privateJson(
        {
          success:
            false,

          code:
            error.code,

          error:
            error.message,
        },
        {
          status:
            error.status,
        },
      );
    }

    console.error(
      "PATCH reservation option remove error:",
      error,
    );

    const code =
      error instanceof
        Error
        ? error.message
        : "UNKNOWN_ERROR";

    if (
      code ===
      "RESERVATION_NOT_FOUND"
    ) {
      return privateJson(
        {
          success:
            false,

          code,

          error:
            "Reserva no encontrada.",
        },
        {
          status:
            404,
        },
      );
    }

    if (
      code ===
      "RESERVATION_OPTION_NOT_FOUND"
    ) {
      return privateJson(
        {
          success:
            false,

          code,

          error:
            "El complemento de la reserva no fue encontrado.",
        },
        {
          status:
            404,
        },
      );
    }

    if (
      code ===
      "OPTION_REMOVE_ACTOR_NOT_VALID"
    ) {
      return privateJson(
        {
          success:
            false,

          code,

          error:
            "El usuario no está autorizado para modificar esta reserva.",
        },
        {
          status:
            403,
        },
      );
    }

    if (
      code ===
      "BUSINESS_NOT_ACTIVE"
    ) {
      return privateJson(
        {
          success:
            false,

          code,

          error:
            "El negocio no está activo.",
        },
        {
          status:
            409,
        },
      );
    }

    if (
      code ===
      "INVALID_RESERVATION_OPTION_REMOVE_QUANTITY"
    ) {
      return privateJson(
        {
          success:
            false,

          code,

          error:
            "La cantidad a retirar no es válida.",
        },
        {
          status:
            400,
        },
      );
    }

    if (
      isRemovalConflict(
        code,
      )
    ) {
      return privateJson(
        {
          success:
            false,

          code,

          error:
            "El complemento no puede retirarse en el estado actual de la reserva.",
        },
        {
          status:
            409,
        },
      );
    }

    return privateJson(
      {
        success:
          false,

        code,

        error:
          "No fue posible retirar el complemento de la reserva.",
      },
      {
        status:
          500,
      },
    );
  }
}