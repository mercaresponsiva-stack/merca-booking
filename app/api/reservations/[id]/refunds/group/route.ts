import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

import {
  AuthorizationError,
  requireAuthenticatedUser,
  requireBusinessAccess,
} from "@/lib/auth/business-access";

import { fromCents, toCents } from "@/lib/booking/money";

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

const refundOperationInclude = {
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
    },
  },

  cancellation: {
    select: {
      id: true,
      businessId: true,
      reservationId: true,
    },
  },

  reservationChange: {
    select: {
      id: true,
      businessId: true,
      reservationId: true,
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
  status: string;

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

    /*
     * Una devolución solamente puede tener
     * una causa agrupable.
     */
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
  }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    /*
     * Autenticamos antes de consultar el alcance
     * de cualquier reserva.
     */
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

    const rawRefundIds = body.refundIds;

    if (
      !Array.isArray(rawRefundIds) ||
      rawRefundIds.length === 0 ||
      rawRefundIds.some(
        (value) => typeof value !== "string" || value.trim().length === 0,
      )
    ) {
      return privateJson(
        {
          success: false,
          error: "Debes indicar al menos un reembolso válido",
        },
        {
          status: 400,
        },
      );
    }

    const refundIds = rawRefundIds as string[];

    /*
     * Eliminamos duplicados y normalizamos
     * espacios sin descartar valores inválidos
     * silenciosamente.
     */
    const uniqueRefundIds = [
      ...new Set(refundIds.map((refundId) => refundId.trim())),
    ];

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
     * compatibilidad con la interfaz actual.
     *
     * El servidor siempre utiliza al usuario
     * autenticado y nunca confía en ese campo.
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
          },
        });

        if (!reservation) {
          throw new Error("RESERVATION_NOT_FOUND");
        }

        /*
         * La membresía se vuelve a comprobar
         * dentro de la transacción.
         */
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

        /*
         * Primero cargamos exactamente los IDs
         * solicitados para comprobar existencia,
         * alcance y causa.
         */
        const requestedRefunds = await tx.refund.findMany({
          where: {
            id: {
              in: uniqueRefundIds,
            },
            reservationId: reservation.id,
          },
          include: refundOperationInclude,
          orderBy: {
            requestedAt: "desc",
          },
        });

        if (requestedRefunds.length !== uniqueRefundIds.length) {
          throw new Error("REFUND_GROUP_NOT_FOUND");
        }

        if (
          hasRefundScopeViolation(
            requestedRefunds,
            access.business.id,
            reservation.id,
          )
        ) {
          throw new Error("REFUND_GROUP_FINANCIAL_SCOPE_INVALID");
        }

        const firstRefund = requestedRefunds[0];

        const cancellationId = firstRefund.cancellationId;
        const reservationChangeId = firstRefund.reservationChangeId;

        /*
         * Todos los IDs solicitados deben compartir
         * exactamente la misma causa y base.
         */
        const requestedGroupIsConsistent = requestedRefunds.every(
          (refund) =>
            refund.basis === firstRefund.basis &&
            refund.cancellationId === cancellationId &&
            refund.reservationChangeId === reservationChangeId,
        );

        if (!requestedGroupIsConsistent) {
          throw new Error("REFUND_GROUP_INVALID");
        }

        /*
         * Un Refund sin causa solamente puede formar
         * un grupo consigo mismo.
         */
        if (
          cancellationId === null &&
          reservationChangeId === null &&
          requestedRefunds.length !== 1
        ) {
          throw new Error("REFUND_GROUP_INVALID");
        }

        /*
         * El servidor reconstruye el conjunto causal
         * completo. No confía en que el cliente haya
         * enviado todos sus integrantes.
         */
        let completeRefunds = requestedRefunds;

        if (cancellationId !== null) {
          completeRefunds = await tx.refund.findMany({
            where: {
              cancellationId,
            },
            include: refundOperationInclude,
            orderBy: {
              requestedAt: "desc",
            },
          });
        } else if (reservationChangeId !== null) {
          completeRefunds = await tx.refund.findMany({
            where: {
              reservationChangeId,
            },
            include: refundOperationInclude,
            orderBy: {
              requestedAt: "desc",
            },
          });
        }

        if (
          hasRefundScopeViolation(
            completeRefunds,
            access.business.id,
            reservation.id,
          )
        ) {
          throw new Error("REFUND_GROUP_FINANCIAL_SCOPE_INVALID");
        }

        const completeGroupIsConsistent = completeRefunds.every(
          (refund) =>
            refund.basis === firstRefund.basis &&
            refund.cancellationId === cancellationId &&
            refund.reservationChangeId === reservationChangeId,
        );

        if (!completeGroupIsConsistent) {
          throw new Error("REFUND_GROUP_INVALID");
        }

        const requestedIdSet = new Set(uniqueRefundIds);

        const completeGroupWasProvided =
          completeRefunds.length === requestedIdSet.size &&
          completeRefunds.every((refund) => requestedIdSet.has(refund.id));

        if (!completeGroupWasProvided) {
          throw new Error("REFUND_GROUP_INCOMPLETE");
        }

        /*
         * Todos los estados se validan antes de
         * modificar un solo Refund.
         */
        for (const refund of completeRefunds) {
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
        }

        const updateData: {
          status: "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELLED";
          processedById: string;
          processedAt?: Date;
          externalReference?: string;
        } = {
          status: targetStatus,
          processedById: actorMembership.user.id,
        };

        if (targetStatus === "COMPLETED") {
          updateData.processedAt = now;
        }

        if (externalReference !== undefined) {
          updateData.externalReference = externalReference;
        }

        const updateResult = await tx.refund.updateMany({
          where: {
            id: {
              in: completeRefunds.map((refund) => refund.id),
            },
            reservationId: reservation.id,
            businessId: access.business.id,
          },
          data: updateData,
        });

        if (updateResult.count !== completeRefunds.length) {
          throw new Error("REFUND_GROUP_UPDATE_INCOMPLETE");
        }

        const updatedRefunds = await tx.refund.findMany({
          where: {
            id: {
              in: completeRefunds.map((refund) => refund.id),
            },
            reservationId: reservation.id,
            businessId: access.business.id,
          },
          include: refundOperationInclude,
          orderBy: {
            requestedAt: "desc",
          },
        });

        if (
          updatedRefunds.length !== completeRefunds.length ||
          hasRefundScopeViolation(
            updatedRefunds,
            access.business.id,
            reservation.id,
          )
        ) {
          throw new Error("REFUND_GROUP_FINANCIAL_SCOPE_INVALID");
        }

        return {
          refunds: updatedRefunds,
        };
      },
      {
        isolationLevel: "Serializable",
      },
    );

    const totalAmountCents = result.refunds.reduce(
      (sum, refund) => sum + toCents(Number(refund.amount)),
      0,
    );

    return privateJson({
      success: true,

      operation: {
        status: targetStatus,

        refundCount: result.refunds.length,

        totalAmount: fromCents(totalAmountCents),

        refunds: result.refunds.map((refund) => ({
          id: refund.id,

          paymentId: refund.paymentId,

          cancellationId: refund.cancellationId,

          reservationChangeId: refund.reservationChangeId,

          basis: refund.basis,

          amount: Number(refund.amount),

          status: refund.status,

          requestedAt: refund.requestedAt,

          processedAt: refund.processedAt,

          externalReference: refund.externalReference,

          processedBy: refund.processedBy,

          payment: {
            id: refund.payment.id,

            amount: Number(refund.payment.amount),

            method: refund.payment.method,

            status: refund.payment.status,
          },
        })),
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

    console.error("PATCH refund group error:", error);

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

    if (error instanceof Error && error.message === "REFUND_GROUP_NOT_FOUND") {
      return privateJson(
        {
          success: false,
          error: "Uno o más reembolsos no existen para esta reserva",
        },
        {
          status: 404,
        },
      );
    }

    if (error instanceof Error && error.message === "REFUND_GROUP_INVALID") {
      return privateJson(
        {
          success: false,
          error:
            "Los reembolsos seleccionados no pertenecen a la misma operación",
        },
        {
          status: 409,
        },
      );
    }

    if (error instanceof Error && error.message === "REFUND_GROUP_INCOMPLETE") {
      return privateJson(
        {
          success: false,
          error:
            "La devolución cambió o no contiene todos sus movimientos. Actualiza la reserva e intenta nuevamente.",
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
          error: "Uno o más reembolsos ya tienen el estado solicitado",
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
          error:
            "La transición no está permitida para todos los reembolsos de esta operación",
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
            "El usuario que procesa la devolución no tiene una membresía activa con un rol permitido en este negocio",
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
          error:
            "Uno de los pagos originales ya no permite procesar esta devolución",
        },
        {
          status: 409,
        },
      );
    }

    if (
      error instanceof Error &&
      [
        "REFUND_GROUP_FINANCIAL_SCOPE_INVALID",
        "REFUND_GROUP_UPDATE_INCOMPLETE",
      ].includes(error.message)
    ) {
      return privateJson(
        {
          success: false,
          error:
            "Los datos financieros de la devolución no son consistentes con el negocio autorizado",
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
            "La devolución cambió mientras se procesaba. Intenta nuevamente.",
        },
        {
          status: 409,
        },
      );
    }

    return privateJson(
      {
        success: false,
        error: "No fue posible procesar la devolución",
      },
      {
        status: 500,
      },
    );
  }
}
