import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

import {
  AuthorizationError,
  requireAuthenticatedUser,
  requireBusinessAccess,
} from "@/lib/auth/business-access";

export const dynamic = "force-dynamic";

function privateJson(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);

  headers.set(
    "Cache-Control",
    "private, no-store, max-age=0, must-revalidate",
  );
  headers.set("Pragma", "no-cache");
  headers.set("Expires", "0");
  headers.set("X-Robots-Tag", "noindex, nofollow");

  return NextResponse.json(body, {
    ...init,
    headers,
  });
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const CANCELLATION_ALLOWED_ROLES = [
  "OWNER",
  "ADMIN",
  "RECEPTIONIST",
] as const;

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
    await requireAuthenticatedUser();

    const { id: reservationId } = await context.params;

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return privateJson(
        {
          success: false,
          code: "INVALID_JSON",
          error: "El cuerpo de la solicitud no contiene JSON válido.",
        },
        {
          status: 400,
        },
      );
    }

    if (!isJsonObject(body)) {
      return privateJson(
        {
          success: false,
          code: "INVALID_JSON",
          error: "El cuerpo de la solicitud debe ser un objeto JSON válido.",
        },
        {
          status: 400,
        },
      );
    }

    const initiator = body.initiator as CancellationInitiator | undefined;

    const reason =
      typeof body.reason === "string" && body.reason.trim()
        ? body.reason.trim()
        : null;

    /*
     * createdById puede seguir llegando por compatibilidad,
     * pero la auditoría siempre usa el usuario de la sesión.
     */

    // ─────────────────────────────────────────────
    // 1. INPUT
    // ─────────────────────────────────────────────

    if (!initiator || !CANCELLATION_INITIATORS.includes(initiator)) {
      return privateJson(
        {
          success: false,
          error: "initiator debe ser CUSTOMER o PROVIDER",
        },
        {
          status: 400,
        },
      );
    }

    // Solo obtenemos el negocio antes de autorizar la operación.
    const reservationScope = await prisma.reservation.findUnique({
      where: {
        id: reservationId,
      },
      select: {
        businessId: true,
      },
    });

    if (!reservationScope) {
      throw new Error("RESERVATION_NOT_FOUND");
    }

    const access = await requireBusinessAccess(
      reservationScope.businessId,
      CANCELLATION_ALLOWED_ROLES,
    );

    const requestedAt = new Date();

    // ─────────────────────────────────────────────
    // 2. SERIALIZABLE TRANSACTION
    // ─────────────────────────────────────────────

    const result = await prisma.$transaction(
      async (tx) => {
        // ─────────────────────────────────────────
        // RESERVATION
        // ─────────────────────────────────────────

        const reservation = await tx.reservation.findFirst({
          where: {
            id: reservationId,
            businessId: access.business.id,
          },

          include: {
            cancellation: {
              select: {
                id: true,
                businessId: true,
                reservationId: true,
              },
            },

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
                    businessId: true,
                    reservationId: true,
                    paymentId: true,
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

        if (
          reservation.cancellation &&
          (
            reservation.cancellation.businessId !== access.business.id ||
            reservation.cancellation.reservationId !== reservation.id
          )
        ) {
          throw new Error("CANCELLATION_RECORD_SCOPE_INVALID");
        }

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

        const actorMembership = await tx.businessMembership.findFirst({
          where: {
            businessId: access.business.id,
            userId: access.user.id,
            isActive: true,
            role: {
              in: [...CANCELLATION_ALLOWED_ROLES],
            },
            user: {
              is: {
                isActive: true,
              },
            },
            business: {
              is: {
                isActive: true,
              },
            },
          },
          select: {
            role: true,
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        });

        if (!actorMembership) {
          throw new Error("CANCELLATION_ACTOR_NOT_VALID");
        }

        const actor = {
          id: actorMembership.user.id,
          name: actorMembership.user.name,
          email: actorMembership.user.email,
          role: actorMembership.role,
        };

        // ─────────────────────────────────────────
        // REFUND POLICY
        //
        // Tomamos la política vigente al momento
        // de solicitar la cancelación.
        // ─────────────────────────────────────────

        const refundPolicy = await tx.refundPolicy.findFirst({
          where: {
            businessId: access.business.id,

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
            businessId: access.business.id,

            reservationId: reservation.id,

            type: classification.basis,

            reason,

            requestedAt,
            cancelledAt: requestedAt,

            createdById: actor.id,
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
          if (
            payment.businessId !== access.business.id ||
            payment.reservationId !== reservation.id ||
            payment.refunds.some(
              (refund) =>
                refund.businessId !== access.business.id ||
                refund.reservationId !== reservation.id ||
                refund.paymentId !== payment.id,
            )
          ) {
            throw new Error("CANCELLATION_FINANCIAL_SCOPE_INVALID");
          }

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
              businessId: access.business.id,

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
            businessId: access.business.id,
          },

          data: {
            status: "CANCELLED",
          },
        });

        // ─────────────────────────────────────────
        // COMPLETE RESULT
        // ─────────────────────────────────────────

        const completeCancellation = await tx.cancellation.findFirstOrThrow({
          where: {
            id: cancellation.id,
            businessId: access.business.id,
            reservationId: reservation.id,
          },

          include: {
            refunds: {
              where: {
                businessId: access.business.id,
                reservationId: reservation.id,
                payment: {
                  is: {
                    businessId: access.business.id,
                    reservationId: reservation.id,
                  },
                },
              },

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
                requestedAt: "desc",
              },
            },
          },
        });

        return {
          reservationId: reservation.id,

          confirmationCode: reservation.confirmationCode,

          cancellation: completeCancellation,

          actor,

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

    return privateJson(
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

          createdBy: result.actor,

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
    if (error instanceof AuthorizationError) {
      return privateJson(
        {
          success: false,
          code: error.code,
          error: error.message,
        },
        {
          status: error.status,
        },
      );
    }

    console.error("POST /api/reservations/[id]/cancel error:", error);

    if (
      (error instanceof Error && error.message === "RESERVATION_NOT_FOUND") ||
      (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2025"
      )
    ) {
      return privateJson(
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
      return privateJson(
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
      return privateJson(
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
      return privateJson(
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
      return privateJson(
        {
          success: false,
          error:
            "El usuario que procesa la cancelación no tiene una membresía activa con un rol permitido en este negocio",
        },
        {
          status: 403,
        },
      );
    }

    if (
      error instanceof Error &&
      [
        "CANCELLATION_RECORD_SCOPE_INVALID",
        "CANCELLATION_FINANCIAL_SCOPE_INVALID",
      ].includes(error.message)
    ) {
      return privateJson(
        {
          success: false,
          error:
            "Los datos relacionados con la reserva no son consistentes con el negocio autorizado",
        },
        {
          status: 500,
        },
      );
    }

    if (
      error instanceof Error &&
      error.message === "REFUND_POLICY_NOT_CONFIGURED"
    ) {
      return privateJson(
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
      return privateJson(
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
      return privateJson(
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
      return privateJson(
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

    return privateJson(
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
