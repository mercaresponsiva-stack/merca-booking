import {
  isRefundStatus,
  isRefundTargetStatus,
  isRefundTransitionAllowed,
} from "@/lib/booking/refund-state";

import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id: reservationId } = await context.params;

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

    const refundIds = Array.isArray(body.refundIds)
      ? body.refundIds.filter(
          (value): value is string =>
            typeof value === "string" && value.trim().length > 0,
        )
      : [];

    const targetStatus = body.status;

    const processedById =
      typeof body.processedById === "string" && body.processedById.trim()
        ? body.processedById.trim()
        : null;

    const externalReference =
      typeof body.externalReference === "string" &&
      body.externalReference.trim()
        ? body.externalReference.trim()
        : null;

    if (refundIds.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Debes indicar al menos un reembolso",
        },
        {
          status: 400,
        },
      );
    }

    /*
     * Evitamos IDs repetidos enviados
     * accidentalmente desde el cliente.
     */
    const uniqueRefundIds = [...new Set(refundIds)];

    if (!isRefundTargetStatus(targetStatus)) {
      return NextResponse.json(
        {
          success: false,
          error: "Estado de reembolso inválido",
        },
        {
          status: 400,
        },
      );
    }

    if (!processedById) {
      return NextResponse.json(
        {
          success: false,
          error: "processedById es obligatorio",
        },
        {
          status: 400,
        },
      );
    }

    const now = new Date();

    const result = await prisma.$transaction(
      async (tx) => {
        /*
         * Todos los Refund deben pertenecer
         * a esta Reservation.
         */
        const refunds = await tx.refund.findMany({
          where: {
            id: {
              in: uniqueRefundIds,
            },

            reservationId,
          },

          include: {
            payment: {
              select: {
                id: true,
                status: true,
              },
            },
          },

          orderBy: {
            requestedAt: "desc",
          },
        });

        if (refunds.length !== uniqueRefundIds.length) {
          throw new Error("REFUND_GROUP_NOT_FOUND");
        }

        const firstRefund = refunds[0];

        /*
         * Una operación agrupada debe
         * provenir de una sola causa.
         *
         * Cancelación:
         * cancellationId
         *
         * Reprogramación:
         * reservationChangeId
         *
         * Refund sin causa agrupable:
         * solamente puede procesarse solo.
         */
        const sameBasis = refunds.every(
          (refund) => refund.basis === firstRefund.basis,
        );

        if (!sameBasis) {
          throw new Error("REFUND_GROUP_INVALID");
        }

        if (firstRefund.cancellationId) {
          const sameCancellation = refunds.every(
            (refund) => refund.cancellationId === firstRefund.cancellationId,
          );

          if (!sameCancellation) {
            throw new Error("REFUND_GROUP_INVALID");
          }
        } else if (firstRefund.reservationChangeId) {
          const sameChange = refunds.every(
            (refund) =>
              refund.reservationChangeId === firstRefund.reservationChangeId,
          );

          if (!sameChange) {
            throw new Error("REFUND_GROUP_INVALID");
          }
        } else if (refunds.length !== 1) {
          throw new Error("REFUND_GROUP_INVALID");
        }

        /*
         * Validamos todos los estados antes
         * de modificar uno solo.
         */
        for (const refund of refunds) {
          if (!isRefundStatus(refund.status)) {
            throw new Error("INVALID_REFUND_STATUS");
          }

          if (!isRefundTransitionAllowed(refund.status, targetStatus)) {
            throw new Error("REFUND_TRANSITION_NOT_ALLOWED");
          }

          /*
           * Refund solamente puede
           * procesarse contra dinero
           * originalmente cobrado.
           */
          if (refund.payment.status !== "PAID") {
            throw new Error("REFUND_PAYMENT_NOT_PAID");
          }
        }

        const actor = await tx.user.findFirst({
          where: {
            id: processedById,

            businessId: firstRefund.businessId,

            isActive: true,
          },

          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        });

        if (!actor) {
          throw new Error("REFUND_ACTOR_NOT_VALID");
        }

        const updateData: {
          status: "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELLED";

          processedById: string;

          processedAt?: Date;

          externalReference?: string;
        } = {
          status: targetStatus,
          processedById: actor.id,
        };

        if (targetStatus === "COMPLETED") {
          updateData.processedAt = now;
        }

        if (externalReference) {
          updateData.externalReference = externalReference;
        }

        /*
         * Un solo UPDATE dentro de la misma
         * transacción.
         *
         * Ningún Refund queda procesado a
         * medias si la operación falla.
         */
        await tx.refund.updateMany({
          where: {
            id: {
              in: uniqueRefundIds,
            },

            reservationId,
          },

          data: updateData,
        });

        const updatedRefunds = await tx.refund.findMany({
          where: {
            id: {
              in: uniqueRefundIds,
            },

            reservationId,
          },

          include: {
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
                amount: true,
                method: true,
                status: true,
              },
            },
          },

          orderBy: {
            requestedAt: "desc",
          },
        });

        return {
          refunds: updatedRefunds,
        };
      },
      {
        isolationLevel: "Serializable",
      },
    );

    const totalAmount = result.refunds.reduce(
      (sum, refund) => sum + Number(refund.amount),
      0,
    );

    return NextResponse.json({
      success: true,

      operation: {
        status: targetStatus,

        refundCount: result.refunds.length,

        totalAmount,

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
    console.error("PATCH refund group error:", error);

    if (error instanceof Error && error.message === "REFUND_GROUP_NOT_FOUND") {
      return NextResponse.json(
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
      return NextResponse.json(
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

    if (
      error instanceof Error &&
      error.message === "REFUND_TRANSITION_NOT_ALLOWED"
    ) {
      return NextResponse.json(
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
      return NextResponse.json(
        {
          success: false,
          error:
            "El usuario que procesa la devolución no es válido para este negocio",
        },
        {
          status: 400,
        },
      );
    }

    if (error instanceof Error && error.message === "REFUND_PAYMENT_NOT_PAID") {
      return NextResponse.json(
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
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2034"
    ) {
      return NextResponse.json(
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

    return NextResponse.json(
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
