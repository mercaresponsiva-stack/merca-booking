import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

import {
  isRefundStatus,
  isRefundTargetStatus,
  isRefundTransitionAllowed,
} from "@/lib/booking/refund-state";

type RouteContext = {
  params: Promise<{
    id: string;
    refundId: string;
  }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id: reservationId, refundId } = await context.params;

    const body = await request.json();

    const targetStatus = body.status;

    /*
     * Por ahora lo recibimos desde body.
     *
     * Cuando tengamos autenticación
     * administrativa deberá salir
     * de la sesión.
     */
    const processedById =
      typeof body.processedById === "string" && body.processedById.trim()
        ? body.processedById.trim()
        : null;

    const externalReference =
      typeof body.externalReference === "string" &&
      body.externalReference.trim()
        ? body.externalReference.trim()
        : null;

    // ─────────────────────────────────────────────
    // 1. INPUT
    // ─────────────────────────────────────────────

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

    /*
     * Este endpoint representa una
     * actuación administrativa.
     *
     * Los webhooks de una pasarela futura
     * tendrán su propio flujo y no deberán
     * confiar en processedById enviado
     * por un cliente HTTP.
     */
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

    // ─────────────────────────────────────────────
    // 2. SERIALIZABLE TRANSACTION
    // ─────────────────────────────────────────────

    const result = await prisma.$transaction(
      async (tx) => {
        // ───────────────────────────────────────
        // REFUND
        // ───────────────────────────────────────

        const refund = await tx.refund.findFirst({
          where: {
            id: refundId,

            reservationId,
          },

          include: {
            reservation: {
              select: {
                id: true,
                businessId: true,
                confirmationCode: true,
                status: true,
              },
            },

            payment: {
              select: {
                id: true,
                amount: true,
                method: true,
                status: true,
                paidAt: true,
              },
            },

            processedBy: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        });

        if (!refund) {
          throw new Error("REFUND_NOT_FOUND");
        }

        // ───────────────────────────────────────
        // CURRENT STATE
        // ───────────────────────────────────────

        if (!isRefundStatus(refund.status)) {
          throw new Error("INVALID_REFUND_STATUS");
        }

        if (!isRefundTransitionAllowed(refund.status, targetStatus)) {
          throw new Error("REFUND_TRANSITION_NOT_ALLOWED");
        }

        // ───────────────────────────────────────
        // ACTOR
        // ───────────────────────────────────────

        const actor = await tx.user.findFirst({
          where: {
            id: processedById,

            businessId: refund.businessId,

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

        // ───────────────────────────────────────
        // PAYMENT INTEGRITY
        //
        // Refund solo puede existir contra
        // dinero que originalmente sí entró.
        // ───────────────────────────────────────

        if (refund.payment.status !== "PAID") {
          throw new Error("REFUND_PAYMENT_NOT_PAID");
        }

        // ───────────────────────────────────────
        // UPDATE
        // ───────────────────────────────────────

        const updateData: {
          status: "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELLED";

          processedById: string;

          externalReference?: string;

          processedAt?: Date | null;
        } = {
          status: targetStatus,

          processedById: actor.id,
        };

        if (externalReference) {
          updateData.externalReference = externalReference;
        }

        /*
         * processedAt representa el momento
         * en el que la devolución se realizó
         * efectivamente.
         */
        if (targetStatus === "COMPLETED") {
          updateData.processedAt = now;
        }

        const updatedRefund = await tx.refund.update({
          where: {
            id: refund.id,
          },

          data: updateData,

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
                paidAt: true,
              },
            },

            cancellation: {
              select: {
                id: true,
                type: true,
                reason: true,
              },
            },

            reservationChange: {
              select: {
                id: true,
                type: true,
                reason: true,
              },
            },
          },
        });

        return {
          reservation: refund.reservation,

          refund: updatedRefund,
        };
      },

      {
        isolationLevel: "Serializable",
      },
    );

    // ─────────────────────────────────────────────
    // 3. RESPONSE
    // ─────────────────────────────────────────────

    return NextResponse.json({
      success: true,

      reservation: {
        id: result.reservation.id,

        confirmationCode: result.reservation.confirmationCode,

        status: result.reservation.status,
      },

      refund: {
        id: result.refund.id,

        basis: result.refund.basis,

        baseAmount: result.refund.baseAmount,

        maxAdministrativeRetention: result.refund.maxAdministrativeRetention,

        administrativeRetention: result.refund.administrativeRetention,

        amount: result.refund.amount,

        status: result.refund.status,

        requestedAt: result.refund.requestedAt,

        processedAt: result.refund.processedAt,

        externalReference: result.refund.externalReference,

        processedBy: result.refund.processedBy,

        payment: result.refund.payment,

        cancellation: result.refund.cancellation,

        reservationChange: result.refund.reservationChange,
      },
    });
  } catch (error) {
    console.error(
      "PATCH /api/reservations/[id]/refunds/[refundId] error:",
      error,
    );

    if (error instanceof Error && error.message === "REFUND_NOT_FOUND") {
      return NextResponse.json(
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
      error.message === "REFUND_TRANSITION_NOT_ALLOWED"
    ) {
      return NextResponse.json(
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
      return NextResponse.json(
        {
          success: false,
          error:
            "El usuario que procesa el reembolso no es válido para este negocio",
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
          error: "El pago original no permite procesar este reembolso",
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
            "El reembolso cambió mientras se procesaba. Intenta nuevamente.",
        },
        {
          status: 409,
        },
      );
    }

    return NextResponse.json(
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
