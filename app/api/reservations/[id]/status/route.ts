import { getReservationTransitionPolicyViolation } from "@/lib/booking/reservation-policy";

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
    // NO-SHOW DEDICADO
    //
    // NO_SHOW libera inventario operativo,
    // deshabilita pagos nuevos y representa
    // una ausencia real del cliente.
    //
    // Debe registrar actor, motivo, momento
    // y auditoría mediante la operación
    // dedicada.
    // ─────────────────────────────────────────────

    if (
      status ===
      "NO_SHOW"
    ) {
      return NextResponse.json(
        {
          success:
            false,

          code:
            "NO_SHOW_REQUIRES_DEDICATED_OPERATION",

          error:
            "La ausencia debe registrarse mediante la operación dedicada de no presentación.",
        },
        {
          status:
            409,
        },
      );
    }

    // ─────────────────────────────────────────────
    // CHECK-IN DEDICADO
    //
    // CHECKED_IN registra actor, hora real,
    // auditoría, pago inicial y recursos.
    //
    // Por eso nunca debe aplicarse mediante
    // el cambio genérico de estado.
    // ─────────────────────────────────────────────

    if (
      status ===
      "CHECKED_IN"
    ) {
      return NextResponse.json(
        {
          success:
            false,

          code:
            "CHECK_IN_REQUIRES_DEDICATED_OPERATION",

          error:
            "El check-in debe registrarse mediante la operación dedicada de ingreso.",
        },
        {
          status:
            409,
        },
      );
    }

    // ─────────────────────────────────────────────
    // CHECK-OUT DEDICADO
    //
    // CHECKED_OUT libera inventario operativo
    // y deshabilita la recepción de pagos.
    //
    // Por eso nunca debe aplicarse mediante
    // el cambio genérico de estado.
    // ─────────────────────────────────────────────

    if (
      status ===
      "CHECKED_OUT"
    ) {
      return NextResponse.json(
        {
          success:
            false,

          code:
            "CHECK_OUT_REQUIRES_DEDICATED_OPERATION",

          error:
            "El check-out debe registrarse mediante la operación dedicada de salida.",
        },
        {
          status:
            409,
        },
      );
    }

    // ─────────────────────────────────────────────
    // COMPLETION DEDICADO
    //
    // COMPLETED representa el cierre
    // administrativo definitivo.
    //
    // Debe registrar actor, auditoría y volver
    // a validar la liquidación financiera
    // mediante la operación dedicada.
    // ─────────────────────────────────────────────

    if (
      status ===
      "COMPLETED"
    ) {
      return NextResponse.json(
        {
          success:
            false,

          code:
            "COMPLETION_REQUIRES_DEDICATED_OPERATION",

          error:
            "La reserva debe completarse mediante la operación dedicada de cierre administrativo.",
        },
        {
          status:
            409,
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
        // 8. TRANSITION POLICY
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
        // 9. UPDATE STATUS
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
    // 10. RESPONSE
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
