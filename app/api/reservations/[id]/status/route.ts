import { getReservationTransitionPolicyViolation } from "@/lib/booking/reservation-policy";
import {
  evaluateAssignedResourcesForInterval,
} from "@/lib/booking/resource-interval-check";
import {
  isReservationStatus,
  isReservationTransitionAllowed,
} from "@/lib/booking/reservation-state";
import { calculatePaymentSummary } from "@/lib/booking/payment-summary";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: NextRequest,
  context: {
    params: Promise<{ id: string }>;
  },
) {
  try {
    const { id } = await context.params;

    const body = await request.json();

    const status = body.status;

    // ─────────────────────────────────────────────
    // 1. VALIDAR STATUS
    // ─────────────────────────────────────────────

    if (!isReservationStatus(status)) {
      return NextResponse.json(
        {
          success: false,
          error: "Estado de reserva inválido",
        },
        {
          status: 400,
        },
      );
    }

    // ─────────────────────────────────────────────
    // 2. TRANSACTION
    // ─────────────────────────────────────────────

    const result = await prisma.$transaction(
      async (tx) => {
        /*
         * Primero cargamos únicamente el estado
         * contractual de Reservation.
         */
        const reservation =
          await tx.reservation.findUnique({
            where: {
              id,
            },
          });

        if (!reservation) {
          throw new Error("RESERVATION_NOT_FOUND");
        }

        // ───────────────────────────────────────
        // 3. MISMO STATUS
        // ───────────────────────────────────────

        if (reservation.status === status) {
          throw new Error("RESERVATION_STATUS_ALREADY_SET");
        }

        // ───────────────────────────────────────
        // 4. STATE MACHINE
        // ───────────────────────────────────────

        if (!isReservationTransitionAllowed(reservation.status, status)) {
          throw new Error("INVALID_RESERVATION_TRANSITION");
        }

        // ───────────────────────────────────────
        // 5. POLICY INPUTS
        //
        // Consultas escalares esperadas de forma
        // secuencial dentro de la transacción.
        // ───────────────────────────────────────

        const reservationServices =
          await tx.reservationService.findMany({
            where: {
              reservationId: reservation.id,
            },
            select: {
              id: true,
              serviceId: true,
              quantity: true,
            },
          });

        const serviceIds = [
          ...new Set(
            reservationServices.map(
              (item) => item.serviceId,
            ),
          ),
        ];

        const serviceResourceTypes =
          serviceIds.length === 0
            ? []
            : await tx.serviceResourceType.findMany({
                where: {
                  serviceId: {
                    in: serviceIds,
                  },
                },
                select: {
                  serviceId: true,
                  resourceTypeId: true,
                  requiredQuantity: true,
                },
              });

        const serviceRequirementsByServiceId =
          new Map<
            string,
            Array<{
              resourceTypeId: string;
              requiredQuantity: number;
            }>
          >();

        for (
          const requirement of
          serviceResourceTypes
        ) {
          const current =
            serviceRequirementsByServiceId.get(
              requirement.serviceId,
            ) ?? [];

          current.push({
            resourceTypeId:
              requirement.resourceTypeId,
            requiredQuantity:
              requirement.requiredQuantity,
          });

          serviceRequirementsByServiceId.set(
            requirement.serviceId,
            current,
          );
        }

        const reservationOptions =
          await tx.reservationOption.findMany({
            where: {
              reservationId: reservation.id,
            },
            select: {
              id: true,
              includedQuantity: true,
              optionalQuantity: true,
              removedOptionalQuantity: true,
              serviceOptionId: true,
            },
          });

        const serviceOptionIds =
          new Set<string>();

        for (
          const option of
          reservationOptions
        ) {
          if (
            option.serviceOptionId
          ) {
            serviceOptionIds.add(
              option.serviceOptionId,
            );
          }
        }

        const serviceOptionResourceTypes =
          serviceOptionIds.size === 0
            ? []
            : await tx.serviceOptionResourceType.findMany({
                where: {
                  serviceOptionId: {
                    in: [
                      ...serviceOptionIds,
                    ],
                  },
                },
                select: {
                  serviceOptionId: true,
                  resourceTypeId: true,
                  requiredQuantity: true,
                },
              });

        const optionRequirementsByServiceOptionId =
          new Map<
            string,
            Array<{
              resourceTypeId: string;
              requiredQuantity: number;
            }>
          >();

        for (
          const requirement of
          serviceOptionResourceTypes
        ) {
          const current =
            optionRequirementsByServiceOptionId.get(
              requirement.serviceOptionId,
            ) ?? [];

          current.push({
            resourceTypeId:
              requirement.resourceTypeId,
            requiredQuantity:
              requirement.requiredQuantity,
          });

          optionRequirementsByServiceOptionId.set(
            requirement.serviceOptionId,
            current,
          );
        }

        const reservationResources =
          await tx.reservationResource.findMany({
            where: {
              reservationId: reservation.id,
            },
            select: {
              reservationServiceId: true,
              reservationOptionId: true,
              resourceId: true,
            },
          });

        const resourceIds = [
          ...new Set(
            reservationResources.map(
              (assignment) =>
                assignment.resourceId,
            ),
          ),
        ];

        const assignedResources =
          resourceIds.length === 0
            ? []
            : await tx.resource.findMany({
                where: {
                  id: {
                    in: resourceIds,
                  },
                },
                select: {
                  id: true,
                  resourceTypeId: true,
                },
              });

        const resourceTypeIdByResourceId =
          new Map<
            string,
            string | null
          >();

        for (
          const resource of
          assignedResources
        ) {
          resourceTypeIdByResourceId.set(
            resource.id,
            resource.resourceTypeId,
          );
        }

        const payments =
          await tx.payment.findMany({
            where: {
              reservationId: reservation.id,
            },
          });

        const paymentIds =
          payments.map(
            (payment) => payment.id,
          );

        const refunds =
          paymentIds.length === 0
            ? []
            : await tx.refund.findMany({
                where: {
                  paymentId: {
                    in: paymentIds,
                  },
                },
                select: {
                  paymentId: true,
                  amount: true,
                  status: true,
                },
              });

        const refundsByPaymentId =
          new Map<
            string,
            typeof refunds
          >();

        for (
          const refund of
          refunds
        ) {
          const current =
            refundsByPaymentId.get(
              refund.paymentId,
            ) ?? [];

          current.push(
            refund,
          );

          refundsByPaymentId.set(
            refund.paymentId,
            current,
          );
        }

        const paymentsForSummary =
          payments.map(
            (payment) => ({
              ...payment,
              refunds:
                refundsByPaymentId.get(
                  payment.id,
                ) ?? [],
            }),
          );

        const servicesForPolicy =
          reservationServices.map(
            (reservationService) => ({
              quantity:
                reservationService.quantity,

              service: {
                resourceTypes:
                  serviceRequirementsByServiceId.get(
                    reservationService.serviceId,
                  ) ?? [],
              },

              resources:
                reservationResources
                  .filter(
                    (assignment) =>
                      assignment.reservationServiceId ===
                      reservationService.id,
                  )
                  .map(
                    (assignment) => ({
                      resource: {
                        resourceTypeId:
                          resourceTypeIdByResourceId.get(
                            assignment.resourceId,
                          ) ?? null,
                      },
                    }),
                  ),
            }),
          );

        const optionsForPolicy =
          reservationOptions.map(
            (reservationOption) => ({
              includedQuantity:
                reservationOption.includedQuantity,

              optionalQuantity:
                reservationOption.optionalQuantity,

              removedOptionalQuantity:
                reservationOption.removedOptionalQuantity,

              serviceOption:
                reservationOption.serviceOptionId
                  ? {
                      resourceTypes:
                        optionRequirementsByServiceOptionId.get(
                          reservationOption.serviceOptionId,
                        ) ?? [],
                    }
                  : null,

              resources:
                reservationResources
                  .filter(
                    (assignment) =>
                      assignment.reservationOptionId ===
                      reservationOption.id,
                  )
                  .map(
                    (assignment) => ({
                      resource: {
                        resourceTypeId:
                          resourceTypeIdByResourceId.get(
                            assignment.resourceId,
                          ) ?? null,
                      },
                    }),
                  ),
            }),
          );

        // ───────────────────────────────────────
        // 6. PAYMENT SUMMARY
        // ───────────────────────────────────────

        const paymentSummary = calculatePaymentSummary({
          total: Number(reservation.total),
          paymentOption: reservation.paymentOption,
          payments: paymentsForSummary,
        });

        // ───────────────────────────────────────
        // 7. PENDING → CONFIRMED
        //
        // No confirmamos una reserva nueva
        // sin haber recibido el pago inicial
        // requerido.
        // ───────────────────────────────────────

        const policyViolation = getReservationTransitionPolicyViolation({
          targetStatus: status,
          paymentSummary,
          services: servicesForPolicy,

          options: optionsForPolicy,
        });

        if (policyViolation) {
          throw new Error(policyViolation);
        }

        // ───────────────────────────────────────
        // 8. CHECK-IN: ASSIGNED RESOURCE INTEGRITY
        //
        // La cantidad contractual ya fue validada.
        //
        // Ahora comprobamos que cada Resource
        // asignado todavía pueda utilizarse:
        //
        // - sigue activo
        // - conserva ResourceType
        // - mantiene vínculo con Service
        // - no tiene conflicto con otra reserva
        // - no fue bloqueado posteriormente
        //
        // Esta operación NO libera assignments.
        // ───────────────────────────────────────

        if (
          status ===
          "CHECKED_IN"
        ) {
          const resourceEvaluation =
            await evaluateAssignedResourcesForInterval({
              businessId:
                reservation.businessId,

              reservationId:
                reservation.id,

              startAt:
                reservation.startAt,

              endAt:
                reservation.endAt,

              db:
                tx,
            });

          if (
            !resourceEvaluation
              .canKeepAll
          ) {
            /*
             * Conservamos diagnóstico operativo
             * en el servidor, pero no modificamos
             * inventario durante el check-in.
             */
            console.warn(
              "CHECK-IN assigned resource integrity violation:",
              {
                reservationId:
                  reservation.id,

                unavailableAssignments:
                  resourceEvaluation
                    .release
                    .map(
                      (
                        assignment,
                      ) => ({
                        assignmentId:
                          assignment
                            .assignmentId,

                        resourceId:
                          assignment
                            .resourceId,

                        serviceId:
                          assignment
                            .serviceId,

                        resourceTypeId:
                          assignment
                            .resourceTypeId,

                        reason:
                          assignment
                            .reason,

                        conflictReservation:
                          assignment
                            .conflictReservation ??
                          null,
                      }),
                    ),
              },
            );

            throw new Error(
              "ASSIGNED_RESOURCES_UNAVAILABLE_FOR_CHECK_IN",
            );
          }
        }

        // ───────────────────────────────────────
        // 10. UPDATE STATUS
        // ───────────────────────────────────────

        const updatedReservation = await tx.reservation.update({
          where: {
            id: reservation.id,
          },

          data: {
            status,
          },

          include: {
            customer: true,

            services: {
              include: {
                service: {
                  include: {
                    resourceTypes: true,
                  },
                },

                resources: {
                  include: {
                    resource: true,
                  },
                },
              },
            },
          },
        });

        return {
          reservation: updatedReservation,
          paymentSummary,
        };
      },

      {
        isolationLevel: "Serializable",
      },
    );

    // ─────────────────────────────────────────────
    // 11. RESPONSE
    // ─────────────────────────────────────────────

    return NextResponse.json({
      success: true,

      reservation: {
        id: result.reservation.id,

        confirmationCode: result.reservation.confirmationCode,

        status: result.reservation.status,

        startAt: result.reservation.startAt,

        endAt: result.reservation.endAt,

        guests: result.reservation.guests,

        adults: result.reservation.adults,

        children: result.reservation.children,

        subtotal: result.reservation.subtotal,

        total: result.reservation.total,

        paymentOption: result.reservation.paymentOption,

        customer: result.reservation.customer,

        services: result.reservation.services.map((item) => ({
          id: item.id,

          serviceId: item.serviceId,

          service: item.service.name,

          quantity: item.quantity,

          resources: item.resources.map((assignment) => ({
            id: assignment.id,

            resourceId: assignment.resourceId,

            name: assignment.resource.name,

            code: assignment.resource.code,

            resourceTypeId: assignment.resource.resourceTypeId,
          })),
        })),
      },

      paymentSummary: result.paymentSummary,
    });
  } catch (error) {
    console.error("PATCH reservation status error:", error);

    // ─────────────────────────────────────────────
    // NOT FOUND
    // ─────────────────────────────────────────────

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
    // SAME STATUS
    // ─────────────────────────────────────────────

    if (
      error instanceof Error &&
      error.message === "RESERVATION_STATUS_ALREADY_SET"
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "La reserva ya tiene ese estado",
        },
        {
          status: 409,
        },
      );
    }

    // ─────────────────────────────────────────────
    // INVALID TRANSITION
    // ─────────────────────────────────────────────

    if (
      error instanceof Error &&
      error.message === "INVALID_RESERVATION_TRANSITION"
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "La transición de estado de la reserva no está permitida",
        },
        {
          status: 409,
        },
      );
    }

    // ─────────────────────────────────────────────
    // PAYMENT REQUIRED FOR CONFIRMATION
    // ─────────────────────────────────────────────

    if (
      error instanceof Error &&
      error.message === "INITIAL_PAYMENT_REQUIRED_FOR_CONFIRMATION"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "La reserva no puede confirmarse hasta que se haya pagado el monto inicial requerido",
        },
        {
          status: 409,
        },
      );
    }

    // ─────────────────────────────────────────────
    // PAYMENT REQUIRED FOR CHECK-IN
    // ─────────────────────────────────────────────

    if (
      error instanceof Error &&
      error.message === "INITIAL_PAYMENT_REQUIRED_FOR_CHECK_IN"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "No se puede realizar el check-in porque el pago inicial requerido no está cubierto",
        },
        {
          status: 409,
        },
      );
    }

    // ─────────────────────────────────────────────
    // RESOURCE REQUIRED FOR CHECK-IN
    // ─────────────────────────────────────────────

    if (
      error instanceof Error &&
      error.message === "RESOURCES_REQUIRED_FOR_CHECK_IN"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "No se puede realizar el check-in hasta asignar todos los recursos físicos requeridos por la reserva",
        },
        {
          status: 409,
        },
      );
    }

    // ─────────────────────────────────────────────
    // OPTION RESOURCE REQUIRED FOR CHECK-IN
    // ─────────────────────────────────────────────

    if (
      error instanceof Error &&
      error.message === "OPTION_RESOURCES_REQUIRED_FOR_CHECK_IN"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "No se puede realizar el check-in hasta asignar todos los recursos físicos requeridos por los complementos activos",
        },
        {
          status: 409,
        },
      );
    }

    // ─────────────────────────────────────────────
    // ASSIGNED RESOURCE UNAVAILABLE FOR CHECK-IN
    // ─────────────────────────────────────────────

    if (
      error instanceof Error &&
      (
        error.message ===
          "ASSIGNED_RESOURCES_UNAVAILABLE_FOR_CHECK_IN" ||
        error.message ===
          "RESERVATION_OPTION_INTERVAL_INCOMPLETE" ||
        error.message ===
          "INVALID_RESERVATION_RESOURCE_EFFECTIVE_INTERVAL"
      )
    ) {
      return NextResponse.json(
        {
          success:
            false,

          code:
            "ASSIGNED_RESOURCES_UNAVAILABLE_FOR_CHECK_IN",

          error:
            "No se puede realizar el check-in porque uno o más recursos asignados ya no están disponibles. Revisa o reasigna los recursos de la reserva.",
        },
        {
          status:
            409,
        },
      );
    }

    // ─────────────────────────────────────────────
    // SERIALIZABLE CONFLICT
    // ─────────────────────────────────────────────

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
            "El estado de la reserva cambió mientras se procesaba la solicitud. Intenta nuevamente.",
        },
        {
          status: 409,
        },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: "No fue posible actualizar el estado de la reserva",
      },
      {
        status: 500,
      },
    );
  }
}
