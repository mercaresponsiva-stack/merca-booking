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
  resolveReservationOptionRemoval,
} from "@/lib/booking/reservation-option-removal";

import {
  resolveReservationOptionResourceRelease,
} from "@/lib/booking/reservation-option-resource-release";

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
    const {
      id,
      reservationOptionId,
    } =
      await context.params;

    // ─────────────────────────────────────────────
    // 1. BODY
    // ─────────────────────────────────────────────

    let body:
      Record<
        string,
        unknown
      >;

    try {
      body =
        (
          await request.json()
        ) as Record<
          string,
          unknown
        >;
    } catch {
      return NextResponse.json(
        {
          success:
            false,

          code:
            "INVALID_JSON_BODY",

          error:
            "El cuerpo de la solicitud no es JSON válido.",
        },
        {
          status:
            400,
        },
      );
    }

    const changedById =
      typeof body.changedById ===
        "string"
        ? body.changedById.trim()
        : "";

    const removeOptionalQuantity =
      body.removeOptionalQuantity;

    const reason =
      typeof body.reason ===
        "string" &&
      body.reason.trim()
        ? body.reason.trim()
        : null;

    if (
      !changedById
    ) {
      return NextResponse.json(
        {
          success:
            false,

          code:
            "CHANGED_BY_ID_REQUIRED",

          error:
            "changedById es requerido.",
        },
        {
          status:
            400,
        },
      );
    }

    if (
      !isPositiveInteger(
        removeOptionalQuantity,
      )
    ) {
      return NextResponse.json(
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
                  changedById,

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
          // 6. RESERVATION OPTION SNAPSHOT
          // ─────────────────────────────────────────

          const reservationOption =
            await tx.reservationOption.findFirst({
              where: {
                id:
                  reservationOptionId,

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
            });

          if (
            !reservationOption
          ) {
            throw new Error(
              "RESERVATION_OPTION_NOT_FOUND",
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
          // 8. OPTION REMOVAL
          // ─────────────────────────────────────────

          const removal =
            resolveReservationOptionRemoval({
              includedQuantity:
                reservationOption
                  .includedQuantity,

              optionalQuantity:
                reservationOption
                  .optionalQuantity,

              removedOptionalQuantity:
                reservationOption
                  .removedOptionalQuantity,

              removeOptionalQuantity,

              unitPrice:
                reservationOption
                  .unitPrice
                  .toString(),

              pricingBase:
                reservationOption
                  .pricingBase,

              pricingFrequency:
                reservationOption
                  .pricingFrequency,

              billingUnits:
                Number(
                  reservationOption
                    .billingUnits,
                ),

              currentSubtotal:
                Number(
                  reservationOption
                    .subtotal,
                ),
            });

          // ─────────────────────────────────────────
          // ─────────────────────────────────────────
          // 9. PHYSICAL RESOURCE RELEASE
          //
          // OPTION_REMOVED solo REDUCE demanda.
          //
          // Nunca asignamos recursos nuevos aquí.
          // Solamente determinamos qué assignments
          // existentes ya sobran.
          // ─────────────────────────────────────────

          const hasAssignedResources =
            reservationOption
              .resources
              .length >
            0;

          /*
           * Si todavía queda cantidad activa y
           * existen assignments físicos, necesitamos
           * conocer los requisitos vigentes para
           * decidir qué conservar.
           *
           * ReservationOption todavía no snapshottea
           * los ResourceType requirements históricos,
           * por lo que no inventamos esa información
           * si ServiceOption ya no existe.
           *
           * Si activeQuantityAfter = 0 podemos liberar
           * todo de forma segura aun sin configuración.
           */
          if (
            removal
              .activeQuantityAfter >
              0 &&
            hasAssignedResources &&
            !reservationOption
              .serviceOption
          ) {
            throw new Error(
              "OPTION_REMOVE_RESOURCE_CONFIGURATION_UNAVAILABLE",
            );
          }

          const resourceRequirements =
            removal
              .activeQuantityAfter ===
              0
              ? []
              : reservationOption
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

          const resourceRelease =
            resolveReservationOptionResourceRelease({
              activeQuantityAfter:
                removal
                  .activeQuantityAfter,

              requirements:
                resourceRequirements,

              assignments:
                reservationOption
                  .resources
                  .map(
                    (
                      assignment,
                    ) => {
                      const resourceTypeId =
                        assignment
                          .resource
                          .resourceTypeId;

                      /*
                       * No podemos decidir qué
                       * assignment conservar o
                       * liberar si el Resource
                       * físico no declara su tipo.
                       */
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

                  reservationOptionId:
                    reservationOption.id,

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

                  originalQuantity:
                    reservationOption
                      .quantity,

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

                  unitPrice:
                    removal
                      .unitPrice,

                  pricingBase:
                    removal
                      .pricingBase,

                  pricingFrequency:
                    removal
                      .pricingFrequency,

                  billingUnits:
                    removal
                      .billingUnits,

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

                  resources: {
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
                  },

                  requestedAt:
                    requestedAt
                      .toISOString(),
                },
              },
            });

          // ─────────────────────────────────────────
          // 12. UPDATE RESERVATION OPTION
          //
          // quantity y optionalQuantity originales
          // permanecen INTACTOS.
          // ─────────────────────────────────────────

          const updatedOption =
            await tx.reservationOption.update({
              where: {
                id:
                  reservationOption.id,
              },

              data: {
                removedOptionalQuantity:
                  removal
                    .removedOptionalQuantityAfter,

                subtotal:
                  removal
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

          // ─────────────────────────────────────────
          // ─────────────────────────────────────────
          // 13. RELEASE PHYSICAL ASSIGNMENTS
          //
          // Solo eliminamos ReservationResource
          // pertenecientes a ESTA ReservationOption.
          //
          // No tocamos recursos del Service ni
          // de otros complementos.
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

                reservationOptionId:
                  reservationOption.id,
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

            removal,

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

    return NextResponse.json({
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
      return NextResponse.json(
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
      return NextResponse.json(
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
      return NextResponse.json(
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
      return NextResponse.json(
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
      return NextResponse.json(
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
      return NextResponse.json(
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

    return NextResponse.json(
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