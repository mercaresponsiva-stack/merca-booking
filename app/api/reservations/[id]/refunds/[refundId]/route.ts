import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

import {
  AuthorizationError,
  requireAuthenticatedUser,
  requireBusinessAccess,
} from "@/lib/auth/business-access";

import {
  isRefundStatus,
  isRefundTargetStatus,
  isRefundTransitionAllowed,
} from "@/lib/booking/refund-state";

export const dynamic = "force-dynamic";

function privateJson(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);

  headers.set("Cache-Control", "private, no-store, max-age=0, must-revalidate");
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

const REFUND_UPDATE_ALLOWED_ROLES = ["OWNER", "ADMIN", "RECEPTIONIST"] as const;

const refundRecordInclude = {
  processedBy: {
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
    },
  },

  payment: {
    select: {
      id: true,
      businessId: true,
      reservationId: true,
      amount: true,
      method: true,
      status: true,
      paidAt: true,
    },
  },

  cancellation: {
    select: {
      id: true,
      businessId: true,
      reservationId: true,
      type: true,
      reason: true,
    },
  },

  reservationChange: {
    select: {
      id: true,
      businessId: true,
      reservationId: true,
      type: true,
      reason: true,
    },
  },
} as const;

type RefundScopeRecord = {
  id: string;

  businessId: string;
  reservationId: string;
  paymentId: string;

  cancellationId: string | null;
  reservationChangeId: string | null;

  basis: string;

  payment: {
    id: string;
    businessId: string;
    reservationId: string;
    status: string;
  };

  cancellation: {
    id: string;
    businessId: string;
    reservationId: string;
  } | null;

  reservationChange: {
    id: string;
    businessId: string;
    reservationId: string;
  } | null;
};

function hasRefundScopeViolation(
  refunds: readonly RefundScopeRecord[],
  businessId: string,
  reservationId: string,
) {
  return refunds.some((refund) => {
    if (
      refund.businessId !== businessId ||
      refund.reservationId !== reservationId ||
      refund.paymentId !== refund.payment.id ||
      refund.payment.businessId !== businessId ||
      refund.payment.reservationId !== reservationId
    ) {
      return true;
    }

    if (refund.cancellationId !== null && refund.reservationChangeId !== null) {
      return true;
    }

    if (refund.cancellationId === null) {
      if (refund.cancellation !== null) {
        return true;
      }
    } else if (
      refund.cancellation === null ||
      refund.cancellation.id !== refund.cancellationId ||
      refund.cancellation.businessId !== businessId ||
      refund.cancellation.reservationId !== reservationId
    ) {
      return true;
    }

    if (refund.reservationChangeId === null) {
      if (refund.reservationChange !== null) {
        return true;
      }
    } else if (
      refund.reservationChange === null ||
      refund.reservationChange.id !== refund.reservationChangeId ||
      refund.reservationChange.businessId !== businessId ||
      refund.reservationChange.reservationId !== reservationId
    ) {
      return true;
    }

    return false;
  });
}

type RouteContext = {
  params: Promise<{
    id: string;
    refundId: string;
  }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    await requireAuthenticatedUser();

    const { id: reservationId, refundId } = await context.params;

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

    const targetStatus = body.status;

    if (!isRefundTargetStatus(targetStatus)) {
      return privateJson(
        {
          success: false,
          error: "Estado de reembolso inválido",
        },
        {
          status: 400,
        },
      );
    }

    if (
      body.externalReference !== undefined &&
      body.externalReference !== null &&
      typeof body.externalReference !== "string"
    ) {
      return privateJson(
        {
          success: false,
          error: "La referencia externa debe ser texto",
        },
        {
          status: 400,
        },
      );
    }

    const externalReference =
      typeof body.externalReference === "string" &&
      body.externalReference.trim().length > 0
        ? body.externalReference.trim()
        : undefined;

    /*
     * processedById puede seguir llegando por
     * compatibilidad.
     *
     * El servidor utiliza exclusivamente al
     * usuario autenticado.
     */

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
      REFUND_UPDATE_ALLOWED_ROLES,
    );

    const now = new Date();

    const result = await prisma.$transaction(
      async (tx) => {
        const reservation = await tx.reservation.findFirst({
          where: {
            id: reservationId,
            businessId: access.business.id,
          },
          select: {
            id: true,
            businessId: true,
            confirmationCode: true,
            status: true,
          },
        });

        if (!reservation) {
          throw new Error("RESERVATION_NOT_FOUND");
        }

        const actorMembership = await tx.businessMembership.findFirst({
          where: {
            businessId: access.business.id,
            userId: access.user.id,
            isActive: true,
            role: {
              in: [...REFUND_UPDATE_ALLOWED_ROLES],
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
            user: {
              select: {
                id: true,
              },
            },
          },
        });

        if (!actorMembership) {
          throw new Error("REFUND_ACTOR_NOT_VALID");
        }

        const refund = await tx.refund.findFirst({
          where: {
            id: refundId,
            reservationId: reservation.id,
          },
          include: refundRecordInclude,
        });

        if (!refund) {
          throw new Error("REFUND_NOT_FOUND");
        }

        if (
          hasRefundScopeViolation([refund], access.business.id, reservation.id)
        ) {
          throw new Error("REFUND_FINANCIAL_SCOPE_INVALID");
        }

        /*
         * Una devolución vinculada a una causa
         * con varios movimientos debe procesarse
         * mediante /refunds/group.
         */
        let relatedRefunds = [refund];

        if (refund.cancellationId !== null) {
          relatedRefunds = await tx.refund.findMany({
            where: {
              cancellationId: refund.cancellationId,
            },
            include: refundRecordInclude,
          });
        } else if (refund.reservationChangeId !== null) {
          relatedRefunds = await tx.refund.findMany({
            where: {
              reservationChangeId: refund.reservationChangeId,
            },
            include: refundRecordInclude,
          });
        }

        if (
          hasRefundScopeViolation(
            relatedRefunds,
            access.business.id,
            reservation.id,
          )
        ) {
          throw new Error("REFUND_FINANCIAL_SCOPE_INVALID");
        }

        const relatedOperationIsConsistent = relatedRefunds.every(
          (relatedRefund) =>
            relatedRefund.basis === refund.basis &&
            relatedRefund.cancellationId === refund.cancellationId &&
            relatedRefund.reservationChangeId === refund.reservationChangeId,
        );

        if (!relatedOperationIsConsistent) {
          throw new Error("REFUND_RELATED_OPERATION_INVALID");
        }

        if (relatedRefunds.length > 1) {
          throw new Error("REFUND_REQUIRES_GROUP_OPERATION");
        }

        if (!isRefundStatus(refund.status)) {
          throw new Error("INVALID_REFUND_STATUS");
        }

        if (refund.status === targetStatus) {
          throw new Error("REFUND_STATUS_ALREADY_SET");
        }

        if (!isRefundTransitionAllowed(refund.status, targetStatus)) {
          throw new Error("REFUND_TRANSITION_NOT_ALLOWED");
        }

        if (refund.payment.status !== "PAID") {
          throw new Error("REFUND_PAYMENT_NOT_PAID");
        }

        const updateData: {
          status: "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELLED";
          processedById: string;
          externalReference?: string;
          processedAt?: Date;
        } = {
          status: targetStatus,
          processedById: actorMembership.user.id,
        };

        if (externalReference !== undefined) {
          updateData.externalReference = externalReference;
        }

        if (targetStatus === "COMPLETED") {
          updateData.processedAt = now;
        }

        const updatedRefund = await tx.refund.update({
          where: {
            id: refund.id,
            businessId: access.business.id,
            reservationId: reservation.id,
          },
          data: updateData,
          include: refundRecordInclude,
        });

        if (
          hasRefundScopeViolation(
            [updatedRefund],
            access.business.id,
            reservation.id,
          )
        ) {
          throw new Error("REFUND_FINANCIAL_SCOPE_INVALID");
        }

        return {
          reservation,
          refund: updatedRefund,
        };
      },
      {
        isolationLevel: "Serializable",
      },
    );

    return privateJson({
      success: true,

      reservation: {
        id: result.reservation.id,
        confirmationCode: result.reservation.confirmationCode,
        status: result.reservation.status,
      },

      refund: {
        id: result.refund.id,

        paymentId: result.refund.paymentId,

        cancellationId: result.refund.cancellationId,

        reservationChangeId: result.refund.reservationChangeId,

        basis: result.refund.basis,

        baseAmount: Number(result.refund.baseAmount),

        contractElapsedDays: result.refund.contractElapsedDays,

        paymentElapsedDays: result.refund.paymentElapsedDays,

        fullRefundDays: result.refund.fullRefundDays,

        annualAdministrativeRate:
          result.refund.annualAdministrativeRate !== null
            ? Number(result.refund.annualAdministrativeRate)
            : null,

        maxAdministrativeRetention: Number(
          result.refund.maxAdministrativeRetention,
        ),

        administrativeRetention: Number(result.refund.administrativeRetention),

        amount: Number(result.refund.amount),

        status: result.refund.status,

        reason: result.refund.reason,

        requestedAt: result.refund.requestedAt,

        processedAt: result.refund.processedAt,

        externalReference: result.refund.externalReference,

        processedBy: result.refund.processedBy,

        payment: {
          id: result.refund.payment.id,
          amount: Number(result.refund.payment.amount),
          method: result.refund.payment.method,
          status: result.refund.payment.status,
          paidAt: result.refund.payment.paidAt,
        },

        cancellation: result.refund.cancellation
          ? {
              id: result.refund.cancellation.id,
              type: result.refund.cancellation.type,
              reason: result.refund.cancellation.reason,
            }
          : null,

        reservationChange: result.refund.reservationChange
          ? {
              id: result.refund.reservationChange.id,
              type: result.refund.reservationChange.type,
              reason: result.refund.reservationChange.reason,
            }
          : null,
      },
    });
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

    console.error(
      "PATCH /api/reservations/[id]/refunds/[refundId] error:",
      error,
    );

    if (error instanceof Error && error.message === "RESERVATION_NOT_FOUND") {
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

    if (error instanceof Error && error.message === "REFUND_NOT_FOUND") {
      return privateJson(
        {
          success: false,
          error: "Reembolso no encontrado",
        },
        {
          status: 404,
        },
      );
    }

    if (
      error instanceof Error &&
      error.message === "REFUND_REQUIRES_GROUP_OPERATION"
    ) {
      return privateJson(
        {
          success: false,
          error:
            "Este reembolso pertenece a una devolución con varios movimientos y debe procesarse como grupo",
        },
        {
          status: 409,
        },
      );
    }

    if (
      error instanceof Error &&
      error.message === "REFUND_STATUS_ALREADY_SET"
    ) {
      return privateJson(
        {
          success: false,
          error: "El reembolso ya tiene el estado solicitado",
        },
        {
          status: 409,
        },
      );
    }

    if (
      error instanceof Error &&
      error.message === "REFUND_TRANSITION_NOT_ALLOWED"
    ) {
      return privateJson(
        {
          success: false,
          error: "La transición del reembolso no está permitida",
        },
        {
          status: 409,
        },
      );
    }

    if (error instanceof Error && error.message === "REFUND_ACTOR_NOT_VALID") {
      return privateJson(
        {
          success: false,
          error:
            "El usuario que procesa el reembolso no tiene una membresía activa con un rol permitido en este negocio",
        },
        {
          status: 403,
        },
      );
    }

    if (error instanceof Error && error.message === "REFUND_PAYMENT_NOT_PAID") {
      return privateJson(
        {
          success: false,
          error: "El pago original no permite procesar este reembolso",
        },
        {
          status: 409,
        },
      );
    }

    if (
      error instanceof Error &&
      [
        "REFUND_FINANCIAL_SCOPE_INVALID",
        "REFUND_RELATED_OPERATION_INVALID",
      ].includes(error.message)
    ) {
      return privateJson(
        {
          success: false,
          error:
            "Los datos financieros del reembolso no son consistentes con el negocio autorizado",
        },
        {
          status: 500,
        },
      );
    }

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
            "El reembolso cambió mientras se procesaba. Intenta nuevamente.",
        },
        {
          status: 409,
        },
      );
    }

    return privateJson(
      {
        success: false,
        error: "No fue posible procesar el reembolso",
      },
      {
        status: 500,
      },
    );
  }
}
