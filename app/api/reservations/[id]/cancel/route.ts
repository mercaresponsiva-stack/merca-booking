import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

import {
  getElapsedFullDays,
  resolveCancellationBasis,
  type CancellationInitiator,
} from "@/lib/booking/cancellation-policy";

import { calculateRefund } from "@/lib/booking/refund-calculator";

import { fromCents, toCents } from "@/lib/booking/money";

import {
  isReservationStatus,
  isReservationTransitionAllowed,
} from "@/lib/booking/reservation-state";

const CANCELLATION_INITIATORS = ["CUSTOMER", "PROVIDER"] as const;

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id: reservationId } = await context.params;

    const body = await request.json();

    const initiator = body.initiator as CancellationInitiator | undefined;

    const reason =
      typeof body.reason === "string" && body.reason.trim()
        ? body.reason.trim()
        : null;

    /*
     * Temporalmente lo recibimos en body.
     *
     * Cuando exista autenticación administrativa,
     * este ID deberá venir de la sesión y no del
     * cliente HTTP.
     */
    const createdById =
      typeof body.createdById === "string" && body.createdById.trim()
        ? body.createdById.trim()
        : null;

    // ─────────────────────────────────────────────
    // 1. INPUT
    // ─────────────────────────────────────────────

    if (!initiator || !CANCELLATION_INITIATORS.includes(initiator)) {
      return NextResponse.json(
        {
          success: false,
          error: "initiator debe ser CUSTOMER o PROVIDER",
        },
        {
          status: 400,
        },
      );
    }

    /*
     * Si el negocio está iniciando la cancelación,
     * exigimos trazabilidad del usuario que
     * ejecutó la acción.
     */
    if (initiator === "PROVIDER" && !createdById) {
      return NextResponse.json(
        {
          success: false,
          error: "Las cancelaciones del proveedor requieren createdById",
        },
        {
          status: 400,
        },
      );
    }

    const requestedAt = new Date();

    // ─────────────────────────────────────────────
    // 2. SERIALIZABLE TRANSACTION
    // ─────────────────────────────────────────────

    const result = await prisma.$transaction(
      async (tx) => {
        // ─────────────────────────────────────────
        // RESERVATION
        // ─────────────────────────────────────────

        const reservation = await tx.reservation.findUnique({
          where: {
            id: reservationId,
          },

          include: {
            cancellation: true,

            payments: {
              where: {
                status: "PAID",
              },

              include: {
                refunds: {
                  where: {
                    status: {
                      in: ["PENDING", "PROCESSING", "COMPLETED"],
                    },
                  },

                  select: {
                    id: true,
                    baseAmount: true,
                    amount: true,
                    status: true,
                  },
                },
              },
            },
          },
        });

        if (!reservation) {
          throw new Error("RESERVATION_NOT_FOUND");
        }

        // ─────────────────────────────────────────
        // EXISTING CANCELLATION
        // ─────────────────────────────────────────

        if (reservation.cancellation) {
          throw new Error("RESERVATION_ALREADY_CANCELLED");
        }

        // ─────────────────────────────────────────
        // RESERVATION STATE
        // ─────────────────────────────────────────

        if (!isReservationStatus(reservation.status)) {
          throw new Error("INVALID_RESERVATION_STATUS");
        }

        if (!isReservationTransitionAllowed(reservation.status, "CANCELLED")) {
          throw new Error("RESERVATION_CANNOT_BE_CANCELLED");
        }

        // ─────────────────────────────────────────
        // ACTOR
        // ─────────────────────────────────────────

        if (createdById) {
          const actor = await tx.user.findFirst({
            where: {
              id: createdById,

              businessId: reservation.businessId,

              isActive: true,
            },

            select: {
              id: true,
            },
          });

          if (!actor) {
            throw new Error("CANCELLATION_ACTOR_NOT_VALID");
          }
        }

        // ─────────────────────────────────────────
        // REFUND POLICY
        //
        // Tomamos la política vigente al momento
        // de solicitar la cancelación.
        // ─────────────────────────────────────────

        const refundPolicy = await tx.refundPolicy.findFirst({
          where: {
            businessId: reservation.businessId,

            isActive: true,

            effectiveFrom: {
              lte: requestedAt,
            },

            OR: [
              {
                effectiveTo: null,
              },

              {
                effectiveTo: {
                  gte: requestedAt,
                },
              },
            ],
          },

          orderBy: {
            effectiveFrom: "desc",
          },
        });

        if (!refundPolicy) {
          throw new Error("REFUND_POLICY_NOT_CONFIGURED");
        }

        const fullRefundDays = refundPolicy.fullRefundDays;

        const annualAdministrativeRate = Number(
          refundPolicy.annualAdministrativeRate,
        );

        // ─────────────────────────────────────────
        // CANCELLATION CLASSIFICATION
        // ─────────────────────────────────────────

        const classification = resolveCancellationBasis({
          initiator,

          retractoEligible: reservation.retractoEligible,

          contractCreatedAt: reservation.createdAt,

          requestedAt,

          serviceStartAt: reservation.startAt,

          fullRefundDays,
        });

        // ─────────────────────────────────────────
        // CREATE CANCELLATION
        // ─────────────────────────────────────────

        const cancellation = await tx.cancellation.create({
          data: {
            businessId: reservation.businessId,

            reservationId: reservation.id,

            type: classification.basis,

            reason,

            requestedAt,
            cancelledAt: requestedAt,

            createdById,
          },
        });

        // ─────────────────────────────────────────
        // CREATE REFUNDS
        //
        // Un Refund se crea por Payment.
        //
        // Si parte de ese Payment ya fue objeto
        // de otro Refund activo/completado,
        // solo puede utilizarse el principal
        // restante.
        // ─────────────────────────────────────────

        const createdRefundIds: string[] = [];

        for (const payment of reservation.payments) {
          if (!payment.paidAt) {
            throw new Error("PAID_PAYMENT_MISSING_PAID_AT");
          }

          const paymentCents = toCents(Number(payment.amount));

          /*
           * baseAmount, no amount.
           *
           * Ejemplo:
           *
           * Pago:                $140
           * Refund base:         $140
           * Retención:          $1.38
           * Refund real:      $138.62
           *
           * Los $1.38 retenidos no deben
           * quedar disponibles para crear
           * un segundo Refund sobre el
           * mismo principal.
           */
          const alreadyReservedBaseCents = payment.refunds.reduce(
            (sum, refund) => sum + toCents(Number(refund.baseAmount)),

            0,
          );

          const refundableBaseCents = Math.max(
            paymentCents - alreadyReservedBaseCents,

            0,
          );

          if (refundableBaseCents === 0) {
            continue;
          }

          const paymentElapsedDays = getElapsedFullDays(
            payment.paidAt,
            requestedAt,
          );

          const calculation = calculateRefund({
            baseAmount: fromCents(refundableBaseCents),

            basis: classification.basis,

            contractElapsedDays: classification.contractElapsedDays,

            paymentElapsedDays,

            fullRefundDays,

            annualAdministrativeRate,
          });

          const refund = await tx.refund.create({
            data: {
              businessId: reservation.businessId,

              reservationId: reservation.id,

              paymentId: payment.id,

              cancellationId: cancellation.id,

              refundPolicyId: refundPolicy.id,

              basis: calculation.basis,

              baseAmount: calculation.baseAmount,

              fullRefundDays: calculation.fullRefundDays,

              annualAdministrativeRate: calculation.annualAdministrativeRate,

              contractElapsedDays: calculation.contractElapsedDays,

              paymentElapsedDays: calculation.paymentElapsedDays,

              maxAdministrativeRetention:
                calculation.maxAdministrativeRetention,

              administrativeRetention: calculation.administrativeRetention,

              amount: calculation.refundAmount,

              status: "PENDING",

              reason,
            },

            select: {
              id: true,
            },
          });

          createdRefundIds.push(refund.id);
        }

        // ─────────────────────────────────────────
        // RESERVATION -> CANCELLED
        // ─────────────────────────────────────────

        await tx.reservation.update({
          where: {
            id: reservation.id,
          },

          data: {
            status: "CANCELLED",
          },
        });

        // ─────────────────────────────────────────
        // COMPLETE RESULT
        // ─────────────────────────────────────────

        const completeCancellation = await tx.cancellation.findUniqueOrThrow({
          where: {
            id: cancellation.id,
          },

          include: {
            createdBy: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
              },
            },

            refunds: {
              include: {
                payment: {
                  select: {
                    id: true,
                    amount: true,
                    method: true,
                    status: true,
                    paidAt: true,
                  },
                },
              },

              orderBy: {
                requestedAt: "asc",
              },
            },
          },
        });

        return {
          reservationId: reservation.id,

          confirmationCode: reservation.confirmationCode,

          cancellation: completeCancellation,

          createdRefundIds,
        };
      },

      {
        isolationLevel: "Serializable",
      },
    );

    // ─────────────────────────────────────────────
    // 3. RESPONSE
    // ─────────────────────────────────────────────

    return NextResponse.json(
      {
        success: true,

        reservation: {
          id: result.reservationId,

          confirmationCode: result.confirmationCode,

          status: "CANCELLED",
        },

        cancellation: {
          id: result.cancellation.id,

          type: result.cancellation.type,

          reason: result.cancellation.reason,

          requestedAt: result.cancellation.requestedAt,

          cancelledAt: result.cancellation.cancelledAt,

          createdBy: result.cancellation.createdBy,

          refunds: result.cancellation.refunds.map((refund) => ({
            id: refund.id,

            paymentId: refund.paymentId,

            basis: refund.basis,

            baseAmount: refund.baseAmount,

            contractElapsedDays: refund.contractElapsedDays,

            paymentElapsedDays: refund.paymentElapsedDays,

            fullRefundDays: refund.fullRefundDays,

            annualAdministrativeRate: refund.annualAdministrativeRate,

            maxAdministrativeRetention: refund.maxAdministrativeRetention,

            administrativeRetention: refund.administrativeRetention,

            amount: refund.amount,

            status: refund.status,

            requestedAt: refund.requestedAt,

            payment: {
              id: refund.payment.id,

              amount: refund.payment.amount,

              method: refund.payment.method,

              paidAt: refund.payment.paidAt,
            },
          })),
        },
      },

      {
        status: 201,
      },
    );
  } catch (error) {
    console.error("POST /api/reservations/[id]/cancel error:", error);

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

    if (
      error instanceof Error &&
      error.message === "RESERVATION_ALREADY_CANCELLED"
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "La reserva ya fue cancelada",
        },
        {
          status: 409,
        },
      );
    }

    if (
      error instanceof Error &&
      error.message === "RESERVATION_CANNOT_BE_CANCELLED"
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "La reserva ya no puede cancelarse en su estado actual",
        },
        {
          status: 409,
        },
      );
    }

    if (
      error instanceof Error &&
      error.message === "CANCELLATION_AFTER_SERVICE_START"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "No puede utilizarse este flujo de cancelación después de iniciado el servicio",
        },
        {
          status: 409,
        },
      );
    }

    if (
      error instanceof Error &&
      error.message === "CANCELLATION_ACTOR_NOT_VALID"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "El usuario que procesa la cancelación no es válido para este negocio",
        },
        {
          status: 400,
        },
      );
    }

    if (
      error instanceof Error &&
      error.message === "REFUND_POLICY_NOT_CONFIGURED"
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "El negocio no tiene una política de reembolso activa",
        },
        {
          status: 500,
        },
      );
    }

    if (
      error instanceof Error &&
      error.message === "PAID_PAYMENT_MISSING_PAID_AT"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Existe un pago PAID sin fecha de pago y no puede calcularse correctamente el reembolso",
        },
        {
          status: 500,
        },
      );
    }

    /*
     * La relación Cancellation.reservationId
     * es UNIQUE. Esto también protege contra
     * dos cancelaciones concurrentes.
     */
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "La reserva ya posee una cancelación registrada",
        },
        {
          status: 409,
        },
      );
    }

    /*
     * Conflicto SERIALIZABLE.
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
            "La reserva cambió mientras se procesaba la cancelación. Intenta nuevamente.",
        },
        {
          status: 409,
        },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: "No fue posible cancelar la reserva",
      },
      {
        status: 500,
      },
    );
  }
}
