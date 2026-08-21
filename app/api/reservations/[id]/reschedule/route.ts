import { allocateRefundAcrossPayments } from "@/lib/booking/refund-allocation";

import { calculatePaymentSummary } from "@/lib/booking/payment-summary";

import { calculateReservationFinancialState } from "@/lib/booking/reservation-financial-state";

import { evaluateAssignedResourcesForInterval } from "@/lib/booking/resource-interval-check";

import {
  assertProspectiveInventoryAvailable,
  evaluateProspectiveInventory,
  type ProspectiveInventoryDemand,
} from "@/lib/booking/prospective-inventory";


import {
  resolveRescheduleFinancialImpact,
  validateReservationForReschedule,
  validateRescheduleInterval,
} from "@/lib/booking/reschedule-policy";

import { getHotelAvailability } from "@/lib/booking/verticals/hotel/availability";

import {
  repriceHotelReservationOptionsForStay,
} from "@/lib/booking/verticals/hotel/reservation-option-repricing";


import { isValidDateOnly, zonedDateTimeToUtc } from "@/lib/booking/datetime";

import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: NextRequest,
  context: {
    params: Promise<{
      id: string;
    }>;
  },
) {
  try {
    const { id } = await context.params;

    // ─────────────────────────────────────────────
    // 1. BODY
    // ─────────────────────────────────────────────

    let body: Record<string, unknown>;

    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: "El cuerpo de la solicitud no es JSON válido",
        },
        {
          status: 400,
        },
      );
    }

    const checkIn = typeof body.checkIn === "string" ? body.checkIn.trim() : "";

    const checkOut =
      typeof body.checkOut === "string" ? body.checkOut.trim() : "";

    /*
     * Temporalmente recibimos el actor
     * desde el body.
     *
     * Cuando integremos autenticación,
     * changedById deberá provenir de
     * la sesión y no del cliente.
     */
    const changedById =
      typeof body.changedById === "string" ? body.changedById.trim() : "";

    const reason =
      typeof body.reason === "string" && body.reason.trim()
        ? body.reason.trim()
        : null;

    if (!checkIn || !checkOut) {
      return NextResponse.json(
        {
          success: false,
          error: "checkIn y checkOut son requeridos",
        },
        {
          status: 400,
        },
      );
    }

    if (!isValidDateOnly(checkIn) || !isValidDateOnly(checkOut)) {
      return NextResponse.json(
        {
          success: false,
          error: "Formato de fecha inválido. Usa YYYY-MM-DD.",
        },
        {
          status: 400,
        },
      );
    }

    if (!changedById) {
      return NextResponse.json(
        {
          success: false,
          error: "changedById es requerido",
        },
        {
          status: 400,
        },
      );
    }

    /*
     * Un único instante para toda
     * la operación.
     */
    const requestedAt = new Date();

    // ─────────────────────────────────────────────
    // 2. TRANSACTION
    // ─────────────────────────────────────────────

    const result = await prisma.$transaction(
      async (tx) => {
        // ───────────────────────────────────────
        // 3. RESERVATION CONTEXT
        // ───────────────────────────────────────

        const reservation = await tx.reservation.findUnique({
          where: {
            id,
          },

          include: {
            business: {
              include: {
                businessType: true,
              },
            },

            services: {
              select: {
                id: true,

                serviceId: true,

                quantity: true,

                unitPrice: true,

                subtotal: true,
              },
            },

            options: {
              select: {
                id: true,

                includedQuantity: true,

                optionalQuantity: true,

                unitPrice: true,

                pricingBase: true,

                pricingFrequency: true,

                startAt: true,

                endAt: true,
              },

              orderBy: {
                createdAt: "asc",
              },
            },

            payments: {
              include: {
                refunds: {
                  select: {
                    baseAmount: true,

                    amount: true,

                    status: true,
                  },
                },
              },

              orderBy: {
                createdAt: "asc",
              },
            },

            refunds: {
              select: {
                id: true,

                status: true,

                basis: true,

                amount: true,
              },
            },
          },
        });

        if (!reservation) {
          throw new Error("RESERVATION_NOT_FOUND");
        }

        // ───────────────────────────────────────
        // 4. ACTOR
        // ───────────────────────────────────────

        const actor = await tx.user.findFirst({
          where: {
            id: changedById,

            businessId: reservation.businessId,

            isActive: true,
          },

          select: {
            id: true,

            name: true,

            role: true,
          },
        });

        if (!actor) {
          throw new Error("RESCHEDULE_ACTOR_NOT_VALID");
        }

        // ───────────────────────────────────────
        // 5. RESCHEDULE POLICY
        // ───────────────────────────────────────

        const hasActiveRefund = reservation.refunds.some(
          (refund) =>
            refund.status === "PENDING" || refund.status === "PROCESSING",
        );

        const rescheduleValidation = validateReservationForReschedule({
          status: reservation.status,

          startAt: reservation.startAt,

          requestedAt,

          hasActiveRefund,
        });

        // ───────────────────────────────────────
        // 6. VERTICAL DISPATCH
        // ───────────────────────────────────────

        const businessType = reservation.business.businessType.slug;

        if (businessType !== "hotel") {
          throw new Error("RESCHEDULE_VERTICAL_NOT_IMPLEMENTED");
        }

        /*
         * Hotel V1 trabaja con:
         *
         * Reservation
         *   └── 1 ReservationService
         *         quantity = 1
         *
         * El Core no impone esta
         * limitación.
         *
         * Es una limitación explícita
         * de esta primera vertical.
         */
        if (
          reservation.services.length !== 1 ||
          reservation.services[0].quantity !== 1
        ) {
          throw new Error("HOTEL_RESCHEDULE_MULTI_SERVICE_NOT_IMPLEMENTED");
        }

        const reservationService = reservation.services[0];

        /*
         * No inventamos una separación
         * adultos / niños para reservas
         * hoteleras históricas que no
         * la tengan registrada.
         */
        if (reservation.adults === null || reservation.children === null) {
          throw new Error("HOTEL_GUEST_BREAKDOWN_REQUIRED");
        }

        // ───────────────────────────────────────
        // 7. HOTEL DATE → UNIVERSAL INTERVAL
        // ───────────────────────────────────────

        const newStartAt = zonedDateTimeToUtc(
          checkIn,

          reservation.business.checkInTime ?? "00:00",

          reservation.business.timezone,
        );

        const newEndAt = zonedDateTimeToUtc(
          checkOut,

          reservation.business.checkOutTime ?? "00:00",

          reservation.business.timezone,
        );

        validateRescheduleInterval({
          currentStartAt: reservation.startAt,

          currentEndAt: reservation.endAt,

          newStartAt,
          newEndAt,
        });

        // ───────────────────────────────────────
        // 8. HOTEL AVAILABILITY + QUOTING
        //
        // La vertical Hotel:
        //
        // - valida capacidad huésped
        // - calcula noches
        // - calcula pricing
        //
        // El Core interno:
        //
        // - calcula inventario físico
        // - excluye esta Reservation
        // ───────────────────────────────────────

        const hotelAvailability = await getHotelAvailability({
          businessId: reservation.businessId,

          startAt: newStartAt,

          endAt: newEndAt,

          checkIn,
          checkOut,

          adults: reservation.adults,

          children: reservation.children,

          serviceIds: [reservationService.serviceId],

          includeInactiveServices: true,

          excludeReservationId: reservation.id,

          db: tx,
        });

        const availableService = hotelAvailability.services.find(
          (service) => service.serviceId === reservationService.serviceId,
        );

        if (!availableService) {
          throw new Error("RESCHEDULE_NO_AVAILABILITY");
        }

        if (availableService.available < reservationService.quantity) {
          throw new Error("RESCHEDULE_NO_AVAILABILITY");
        }
        // ─────────────────────────────────────────────
        // COMPLETE PROSPECTIVE INVENTORY
        //
        // Reemplazamos la demanda persistida de esta
        // Reservation por toda su demanda futura:
        //
        // - Service
        // - ReservationOptions
        //
        // Las demandas que comparten ResourceType
        // se validan conjuntamente.
        // ─────────────────────────────────────────────

        const serviceInventoryConfiguration =
          await tx.service.findFirst({
            where: {
              id:
                reservationService.serviceId,

              businessId:
                reservation.businessId,
            },

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
          });

        if (
          !serviceInventoryConfiguration
        ) {
          throw new Error(
            "RESCHEDULE_SERVICE_NOT_FOUND",
          );
        }

        const optionInventoryConfiguration =
          await tx.reservationOption.findMany({
            where: {
              reservationId:
                reservation.id,
            },

            select: {
              id:
                true,

              quantity:
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
            },
          });

        const prospectiveDemands:
          ProspectiveInventoryDemand[] =
          [];

        /*
         * Demanda obligatoria del Service.
         */
        for (
          const requirement of
          serviceInventoryConfiguration
            .resourceTypes
        ) {
          prospectiveDemands.push({
            resourceTypeId:
              requirement.resourceTypeId,

            startAt:
              newStartAt,

            endAt:
              newEndAt,

            requiredResources:
              Math.max(
                requirement.requiredQuantity,
                1,
              ) *
              reservationService.quantity,

            source:
              `SERVICE:${reservationService.id}`,
          });
        }

        /*
         * Demanda física de ReservationOptions.
         *
         * quantity ya representa:
         *
         * includedQuantity
         * +
         * optionalQuantity
         */
        for (
          const option of
          optionInventoryConfiguration
        ) {
          const hasOwnStart =
            option.startAt !==
            null;

          const hasOwnEnd =
            option.endAt !==
            null;

          if (
            hasOwnStart !==
            hasOwnEnd
          ) {
            throw new Error(
              "RESERVATION_OPTION_INTERVAL_INCOMPLETE",
            );
          }

          if (
            option.quantity < 1
          ) {
            throw new Error(
              "INVALID_RESERVATION_OPTION_QUANTITY",
            );
          }

          for (
            const requirement of
            option.serviceOption
              ?.resourceTypes ??
            []
          ) {
            prospectiveDemands.push({
              resourceTypeId:
                requirement.resourceTypeId,

              startAt:
                option.startAt ??
                newStartAt,

              endAt:
                option.endAt ??
                newEndAt,

              requiredResources:
                option.quantity *
                Math.max(
                  requirement.requiredQuantity,
                  1,
                ),

              source:
                `OPTION:${option.id}`,
            });
          }
        }

        const prospectiveInventory =
          await evaluateProspectiveInventory({
            businessId:
              reservation.businessId,

            serviceId:
              reservationService.serviceId,

            demands:
              prospectiveDemands,

            /*
             * Quitamos la versión persistida de
             * esta Reservation y la sustituimos
             * por toda la demanda nueva.
             */
            excludeReservationId:
              reservation.id,

            db:
              tx,
          });

        assertProspectiveInventoryAvailable(
          prospectiveInventory,
        );


        // ───────────────────────────────────────
        // 9. EXISTING RESOURCE ASSIGNMENTS
        //
        // KEEP:
        // el Resource sigue disponible
        //
        // RELEASE:
        // hay conflicto / block /
        // configuración incompatible
        //
        // Esta función NO modifica datos.
        // ───────────────────────────────────────

        const resourceEvaluation = await evaluateAssignedResourcesForInterval({
          businessId: reservation.businessId,

          reservationId: reservation.id,

          startAt: newStartAt,

          endAt: newEndAt,

          db: tx,
        });

        // ───────────────────────────────────────
        // 10. CURRENT FINANCIAL STATE
        //
        // netPaid no depende del nuevo
        // precio todavía.
        // ───────────────────────────────────────

        const currentPaymentSummary = calculatePaymentSummary({
          total: Number(reservation.total),

          paymentOption: reservation.paymentOption,

          payments: reservation.payments,
        });

        // ───────────────────────────────────────
        // 11. NEW HOTEL PRICE
        // ───────────────────────────────────────

        const newServiceSubtotal =
          availableService.pricing.total;

        /*
         * Los complementos existentes son
         * snapshots contractuales.
         *
         * Conservamos precio, cantidades y
         * modalidad históricas.
         *
         * Solo recalculamos billingUnits
         * cuando dependen de las nuevas fechas.
         */
        const optionRepricing =
          repriceHotelReservationOptionsForStay({
            checkIn,

            checkOut,

            timezone:
              reservation.business.timezone,

            options: reservation.options.map(
              (option) => ({
                id:
                  option.id,

                includedQuantity:
                  option.includedQuantity,

                optionalQuantity:
                  option.optionalQuantity,

                unitPrice:
                  option.unitPrice.toString(),

                pricingBase:
                  option.pricingBase,

                pricingFrequency:
                  option.pricingFrequency,

                startAt:
                  option.startAt,

                endAt:
                  option.endAt,
              }),
            ),
          });

        const newOptionSubtotal =
          optionRepricing.subtotal;

        const newSubtotal =
          Math.round(
            (
              newServiceSubtotal +
              newOptionSubtotal +
              Number.EPSILON
            ) *
              100,
          ) / 100;

        const newTotal =
          newSubtotal;

        // ───────────────────────────────────────
        // 12. FINANCIAL IMPACT
        //
        // Universal:
        //
        // - nuevo saldo
        // - sobrepago
        // - anticipo requerido
        // - CONFIRMED -> PENDING
        //   si ya no cubre el anticipo
        // ───────────────────────────────────────

        const financialImpact = resolveRescheduleFinancialImpact({
          currentStatus: rescheduleValidation.currentStatus,

          paymentOption: reservation.paymentOption,

          currentTotal: Number(reservation.total),

          newTotal,

          netPaid: currentPaymentSummary.netPaid,
        });

        // ───────────────────────────────────────
        // 13. REFUND ALLOCATION
        //
        // Calculamos antes de modificar
        // la reserva.
        //
        // Si no hay sobrepago:
        // allocations = []
        //
        // Si existe:
        // se distribuye entre Payments PAID.
        // ───────────────────────────────────────

        const refundAllocation = allocateRefundAcrossPayments({
          amount: financialImpact.overpayment,

          payments: reservation.payments,
        });

        // ───────────────────────────────────────
        // 14. RESERVATION CHANGE
        //
        // Auditoría completa del contrato.
        // ───────────────────────────────────────

        const change = await tx.reservationChange.create({
          data: {
            businessId: reservation.businessId,

            reservationId: reservation.id,

            type: "RESCHEDULE",

            changedById: actor.id,

            reason,

            oldStartAt: reservation.startAt,

            newStartAt,

            oldEndAt: reservation.endAt,

            newEndAt,

            oldSubtotal: reservation.subtotal,

            newSubtotal,

            oldTotal: reservation.total,

            newTotal,

            oldStatus: reservation.status,

            newStatus: financialImpact.nextStatus,

            details: {
              vertical: "hotel",

              checkIn,

              checkOut,

              nights: hotelAvailability.nights,

              pricing: {
                nightlyPrices:
                  availableService.pricing.nightlyPrices,

                serviceSubtotal:
                  newServiceSubtotal,

                optionSubtotal:
                  newOptionSubtotal,

                total:
                  newTotal,
              },

              financial: {
                priceDifference: financialImpact.priceDifference,

                netPaid: financialImpact.netPaid,

                balance: financialImpact.balance,

                overpayment: financialImpact.overpayment,

                requiredInitialPayment: financialImpact.requiredInitialPayment,

                initialPaymentShortfall:
                  financialImpact.initialPaymentShortfall,
              },

              resources: {
                prospectiveInventory: {
                  available:
                    prospectiveInventory.available,

                  segments:
                    prospectiveInventory.segments.map(
                      (segment) => ({
                        resourceTypeId:
                          segment.resourceTypeId,

                        startAt:
                          segment.startAt,

                        endAt:
                          segment.endAt,

                        prospectiveDemand:
                          segment.prospectiveDemand,

                        availableBeforeDemand:
                          segment.availableBeforeDemand,

                        availableAfterDemand:
                          segment.availableAfterDemand,

                        sufficient:
                          segment.sufficient,

                        sources:
                          segment.sources,
                      }),
                    ),
                },

                kept: resourceEvaluation.keep.map((assignment) => ({
                  assignmentId: assignment.assignmentId,

                  resourceId: assignment.resourceId,

                  serviceId: assignment.serviceId,

                  resourceTypeId: assignment.resourceTypeId,
                })),

                released: resourceEvaluation.release.map((assignment) => ({
                  assignmentId: assignment.assignmentId,

                  resourceId: assignment.resourceId,

                  serviceId: assignment.serviceId,

                  resourceTypeId: assignment.resourceTypeId,

                  reason: assignment.reason,
                })),
              },
            },
          },
        });

        // ───────────────────────────────────────
        // 15. UPDATE RESERVATION
        //
        // NO cambiamos:
        //
        // confirmationCode
        // customerId
        // createdAt
        // retractoEligible
        // source
        // paymentOption
        // ───────────────────────────────────────

        await tx.reservation.update({
          where: {
            id: reservation.id,
          },

          data: {
            startAt: newStartAt,

            endAt: newEndAt,

            subtotal: newSubtotal,

            total: newTotal,

            status: financialImpact.nextStatus,
          },
        });

        // ───────────────────────────────────────
        // 16. UPDATE RESERVATION SERVICE
        //
        // Hotel V1:
        //
        // unitPrice = promedio por noche
        // subtotal  = suma exacta
        // ───────────────────────────────────────

        await tx.reservationService.update({
          where: {
            id: reservationService.id,
          },

          data: {
            unitPrice:
              newServiceSubtotal /
              hotelAvailability.nights,

            subtotal:
              newServiceSubtotal,
          },
        });

        /*
         * Actualizamos únicamente los valores
         * derivados del intervalo.
         *
         * El resto del snapshot permanece
         * histórico.
         */
        for (
          const optionItem of
          optionRepricing.items
        ) {
          await tx.reservationOption.update({
            where: {
              id:
                optionItem.id,
            },

            data: {
              billingUnits:
                optionItem.billingUnits,

              subtotal:
                optionItem.subtotal,
            },
          });
        }


        // ───────────────────────────────────────
        // 17. RELEASE INVALID RESOURCES
        //
        // Solo eliminamos asignaciones
        // que no pueden mantenerse.
        //
        // No reasignamos automáticamente
        // otro Resource físico.
        // ───────────────────────────────────────

        const releasedAssignmentIds = resourceEvaluation.release.map(
          (assignment) => assignment.assignmentId,
        );

        if (releasedAssignmentIds.length > 0) {
          await tx.reservationResource.deleteMany({
            where: {
              id: {
                in: releasedAssignmentIds,
              },

              reservationId: reservation.id,
            },
          });
        }

        // ───────────────────────────────────────
        // 18. PRICE ADJUSTMENT REFUNDS
        //
        // Una reducción de precio solamente
        // crea Refund si existe dinero
        // efectivamente pagado por encima
        // del nuevo total.
        //
        // Payment permanece PAID.
        // ───────────────────────────────────────

        const createdRefunds = [];

        for (const allocation of refundAllocation.allocations) {
          const refund = await tx.refund.create({
            data: {
              businessId: reservation.businessId,

              reservationId: reservation.id,

              paymentId: allocation.paymentId,

              reservationChangeId: change.id,

              basis: "PRICE_ADJUSTMENT",

              baseAmount: allocation.baseAmount,

              maxAdministrativeRetention: 0,

              administrativeRetention: 0,

              amount: allocation.amount,

              status: "PENDING",

              reason: reason
                ? `Ajuste de precio por reprogramación: ${reason}`
                : "Ajuste de precio por reprogramación",

              requestedAt,
            },
          });

          createdRefunds.push(refund);
        }

        // ───────────────────────────────────────
        // 19. FINAL RESERVATION
        // ───────────────────────────────────────

        const updatedReservation = await tx.reservation.findUniqueOrThrow({
          where: {
            id: reservation.id,
          },

          include: {
            customer: true,

            services: {
              include: {
                service: true,

                resources: {
                  include: {
                    resource: true,
                  },
                },
              },
            },

            payments: {
              include: {
                refunds: {
                  select: {
                    id: true,

                    basis: true,

                    baseAmount: true,

                    amount: true,

                    status: true,
                  },
                },
              },

              orderBy: {
                createdAt: "asc",
              },
            },
          },
        });

        // ───────────────────────────────────────
        // 20. NEW PAYMENT SUMMARY
        //
        // Los PRICE_ADJUSTMENT recién
        // creados están PENDING:
        //
        // refundPending aumenta,
        // netPaid todavía no disminuye
        // hasta COMPLETED.
        // ───────────────────────────────────────

        const paymentSummary = calculatePaymentSummary({
          total: Number(updatedReservation.total),

          paymentOption: updatedReservation.paymentOption,

          payments: updatedReservation.payments,
        });

        const financialState = calculateReservationFinancialState({
          status: updatedReservation.status,

          paymentSummary,
        });

        return {
          reservation: updatedReservation,

          change,

          pricing: {
            nights:
              hotelAvailability.nights,

            nightlyPrices:
              availableService.pricing.nightlyPrices,

            serviceSubtotal:
              newServiceSubtotal,

            optionSubtotal:
              newOptionSubtotal,

            total:
              newTotal,
          },

          resourceEvaluation,

          prospectiveInventory,

          financialImpact,

          paymentSummary,

          financialState,

          createdRefunds,
        };
      },

      {
        isolationLevel: "Serializable",
      },
    );

    // ─────────────────────────────────────────────
    // 21. RESPONSE
    // ─────────────────────────────────────────────

    return NextResponse.json({
      success: true,

      reservation: {
        id: result.reservation.id,

        confirmationCode: result.reservation.confirmationCode,

        status: result.reservation.status,

        startAt: result.reservation.startAt,

        endAt: result.reservation.endAt,

        subtotal: Number(result.reservation.subtotal),

        total: Number(result.reservation.total),

        paymentOption: result.reservation.paymentOption,

        customer: result.reservation.customer,

        services: result.reservation.services.map((item) => ({
          id: item.id,

          serviceId: item.serviceId,

          service: item.service.name,

          quantity: item.quantity,

          unitPrice: Number(item.unitPrice),

          subtotal: Number(item.subtotal),

          resources: item.resources.map((assignment) => ({
            assignmentId: assignment.id,

            resourceId: assignment.resourceId,

            name: assignment.resource.name,

            code: assignment.resource.code,
          })),
        })),
      },

      pricing: result.pricing,

      change: {
        id: result.change.id,

        type: result.change.type,

        oldStartAt: result.change.oldStartAt,

        newStartAt: result.change.newStartAt,

        oldEndAt: result.change.oldEndAt,

        newEndAt: result.change.newEndAt,

        oldTotal:
          result.change.oldTotal !== null
            ? Number(result.change.oldTotal)
            : null,

        newTotal:
          result.change.newTotal !== null
            ? Number(result.change.newTotal)
            : null,

        oldStatus: result.change.oldStatus,

        newStatus: result.change.newStatus,

        reason: result.change.reason,

        createdAt: result.change.createdAt,
      },

      resources: {
        kept:
          result.resourceEvaluation.keep,

        released:
          result.resourceEvaluation.release,
      },

      inventory: {
        available:
          result.prospectiveInventory.available,

        segments:
          result.prospectiveInventory.segments,

        shortages:
          result.prospectiveInventory.shortages,
      },
      financialImpact: result.financialImpact,

      paymentSummary: result.paymentSummary,

      financialState: result.financialState,

      refunds: result.createdRefunds.map((refund) => ({
        id: refund.id,

        paymentId: refund.paymentId,

        basis: refund.basis,

        baseAmount: Number(refund.baseAmount),

        amount: Number(refund.amount),

        status: refund.status,

        reservationChangeId: refund.reservationChangeId,
      })),
    });
  } catch (error) {
    console.error("PATCH reservation reschedule error:", error);

    // ─────────────────────────────────────────────
    // NOT FOUND
    // ─────────────────────────────────────────────

    if (
      error instanceof Error &&
      error.message ===
        "PROSPECTIVE_INVENTORY_NOT_AVAILABLE"
    ) {
      return NextResponse.json(
        {
          success: false,

          code:
            "PROSPECTIVE_INVENTORY_NOT_AVAILABLE",

          error:
            "No hay inventario suficiente para reprogramar la reserva con todos sus complementos.",
        },
        {
          status:
            409,
        },
      );
    }
    if (error instanceof Error && error.message === "RESERVATION_NOT_FOUND") {
      return NextResponse.json(
        {
          success: false,
          error: "Reserva no encontrada",
        },
        {
          status: 404,
        },
      );
    }

    // ─────────────────────────────────────────────
    // ACTOR
    // ─────────────────────────────────────────────

    if (
      error instanceof Error &&
      error.message === "RESCHEDULE_ACTOR_NOT_VALID"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "El usuario que realiza la reprogramación no existe, está inactivo o pertenece a otro negocio",
        },
        {
          status: 403,
        },
      );
    }

    // ─────────────────────────────────────────────
    // RESERVATION STATE
    // ─────────────────────────────────────────────

    if (
      error instanceof Error &&
      error.message === "RESERVATION_NOT_RESCHEDULABLE"
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "La reserva no puede reprogramarse desde su estado actual",
        },
        {
          status: 409,
        },
      );
    }

    if (
      error instanceof Error &&
      error.message === "RESCHEDULE_AFTER_SERVICE_START"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "La reserva no puede reprogramarse después de iniciado el servicio",
        },
        {
          status: 409,
        },
      );
    }

    if (
      error instanceof Error &&
      error.message === "RESCHEDULE_ACTIVE_REFUND"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "La reserva tiene un reembolso pendiente o en procesamiento. Debe resolverse antes de reprogramar.",
        },
        {
          status: 409,
        },
      );
    }

    // ─────────────────────────────────────────────
    // INTERVAL
    // ─────────────────────────────────────────────

    if (
      error instanceof Error &&
      error.message === "INVALID_RESCHEDULE_INTERVAL"
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "El nuevo intervalo de reserva no es válido",
        },
        {
          status: 400,
        },
      );
    }

    if (
      error instanceof Error &&
      error.message === "RESCHEDULE_SAME_INTERVAL"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Las nuevas fechas son iguales a las fechas actuales. No existe una reprogramación que aplicar.",
        },
        {
          status: 409,
        },
      );
    }

    // ─────────────────────────────────────────────
    // VERTICAL
    // ─────────────────────────────────────────────

    if (
      error instanceof Error &&
      error.message === "RESCHEDULE_VERTICAL_NOT_IMPLEMENTED"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "La reprogramación todavía no está implementada para este tipo de negocio",
        },
        {
          status: 501,
        },
      );
    }

    if (
      error instanceof Error &&
      error.message === "HOTEL_RESCHEDULE_MULTI_SERVICE_NOT_IMPLEMENTED"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Hotel V1 todavía no admite reprogramar reservas con múltiples servicios o cantidades superiores a una unidad",
        },
        {
          status: 409,
        },
      );
    }

    if (
      error instanceof Error &&
      error.message === "HOTEL_GUEST_BREAKDOWN_REQUIRED"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "La reserva hotelera no tiene configurada la distribución de adultos y niños necesaria para validar la nueva disponibilidad",
        },
        {
          status: 409,
        },
      );
    }

    // ─────────────────────────────────────────────
    // AVAILABILITY / RATES
    // ─────────────────────────────────────────────

    if (
      error instanceof Error &&
      error.message === "RESCHEDULE_NO_AVAILABILITY"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "El servicio reservado no tiene disponibilidad suficiente para las nuevas fechas",
        },
        {
          status: 409,
        },
      );
    }

    if (error instanceof Error && error.message === "RATE_NOT_AVAILABLE") {
      return NextResponse.json(
        {
          success: false,
          error:
            "No existe una tarifa configurada para todas las nuevas fechas solicitadas",
        },
        {
          status: 409,
        },
      );
    }

    if (
      error instanceof Error &&
      error.message === "INVALID_NUMBER_OF_NIGHTS"
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "La cantidad de noches resultante no es válida",
        },
        {
          status: 400,
        },
      );
    }

    // ─────────────────────────────────────────────
    // FINANCIAL INTEGRITY
    // ─────────────────────────────────────────────

    if (
      error instanceof Error &&
      error.message === "INSUFFICIENT_REFUNDABLE_PAYMENT_PRINCIPAL"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "El sistema detectó un sobrepago, pero no existe suficiente principal de pagos disponible para respaldar el reembolso",
        },
        {
          status: 409,
        },
      );
    }

    if (
      error instanceof Error &&
      error.message === "PAID_PAYMENT_WITHOUT_PAID_AT"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Existe un pago marcado como pagado sin fecha de pago. La reprogramación no puede continuar.",
        },
        {
          status: 409,
        },
      );
    }

    /*
     * Prisma Serializable conflict.
     *
     * El cliente puede repetir la operación
     * después de volver a consultar estado.
     */
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2034"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "La reserva cambió mientras se procesaba la reprogramación. Intenta nuevamente.",
        },
        {
          status: 409,
        },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: "Error al reprogramar la reserva",
      },
      {
        status: 500,
      },
    );
  }
}
