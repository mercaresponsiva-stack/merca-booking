import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

import { calculatePaymentSummary } from "@/lib/booking/payment-summary";

import { calculateReservationFinancialState } from "@/lib/booking/reservation-financial-state";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;

    const reservation = await prisma.reservation.findUnique({
      where: {
        id,
      },

      include: {
        business: {
          include: {
            businessType: true,
          },
        },

        customer: true,

        services: {
          include: {
            service: true,

            resources: {
              include: {
                resource: {
                  include: {
                    resourceType: true,
                  },
                },
              },
            },
          },
        },

        options: {
          include: {
            resources: {
              include: {
                resource: {
                  include: {
                    resourceType: true,
                  },
                },
              },
            },
          },

          orderBy: {
            createdAt: "asc",
          },
        },

        payments: {
          include: {
            verifiedBy: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
              },
            },

            refunds: {
              include: {
                processedBy: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                    role: true,
                  },
                },
              },

              orderBy: {
                requestedAt: "desc",
              },
            },
          },

          orderBy: {
            createdAt: "desc",
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

            processedBy: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
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

          orderBy: {
            requestedAt: "desc",
          },
        },

        cancellation: {
          include: {
            createdBy: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
              },
            },
          },
        },

        changes: {
          include: {
            changedBy: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
              },
            },

            refunds: {
              select: {
                id: true,
                basis: true,
                amount: true,
                status: true,
              },
            },
          },

          orderBy: {
            createdAt: "desc",
          },
        },
      },
    });

    if (!reservation) {
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
    // FINANCIAL STATE
    // ─────────────────────────────────────────────

    const paymentSummary = calculatePaymentSummary({
      total: Number(reservation.total),

      paymentOption: reservation.paymentOption,

      payments: reservation.payments,
    });

    const financialState = calculateReservationFinancialState({
      status: reservation.status,

      paymentSummary,
    });

    // ─────────────────────────────────────────────
    // RESPONSE
    // ─────────────────────────────────────────────

    return NextResponse.json({
      success: true,

      reservation: {
        id: reservation.id,

        confirmationCode: reservation.confirmationCode,

        status: reservation.status,

        source: reservation.source,

        startAt: reservation.startAt,

        endAt: reservation.endAt,

        guests: reservation.guests,

        adults: reservation.adults,

        children: reservation.children,

        subtotal: Number(reservation.subtotal),

        total: Number(reservation.total),

        paymentOption: reservation.paymentOption,

        retractoEligible: reservation.retractoEligible,

        specialRequests: reservation.specialRequests,

        createdAt: reservation.createdAt,

        updatedAt: reservation.updatedAt,
      },

      business: {
        id: reservation.business.id,

        name: reservation.business.name,

        slug: reservation.business.slug,

        type: {
          id: reservation.business.businessType.id,

          name: reservation.business.businessType.name,

          slug: reservation.business.businessType.slug,
        },

        currency: reservation.business.currency,

        timezone: reservation.business.timezone,

        checkInTime: reservation.business.checkInTime,

        checkOutTime: reservation.business.checkOutTime,
      },

      customer: {
        id: reservation.customer.id,

        firstName: reservation.customer.firstName,

        lastName: reservation.customer.lastName,

        email: reservation.customer.email,

        phone: reservation.customer.phone,

        createdAt: reservation.customer.createdAt,

        updatedAt: reservation.customer.updatedAt,
      },

      services: reservation.services.map((item) => ({
        id: item.id,

        serviceId: item.serviceId,

        name: item.service.name,

        slug: item.service.slug,

        quantity: item.quantity,

        unitPrice: Number(item.unitPrice),

        subtotal: Number(item.subtotal),

        resources: item.resources.map((assignment) => ({
          assignmentId: assignment.id,

          resourceId: assignment.resourceId,

          name: assignment.resource.name,

          code: assignment.resource.code,

          floor: assignment.resource.floor,

          resourceType: assignment.resource.resourceType
            ? {
                id: assignment.resource.resourceType.id,

                name: assignment.resource.resourceType.name,
              }
            : null,

          createdAt: assignment.createdAt,
        })),
      })),

      options: reservation.options.map((item) => ({
        id: item.id,

        reservationServiceId:
          item.reservationServiceId,

        optionId:
          item.optionId,

        serviceOptionId:
          item.serviceOptionId,

        name:
          item.name,

        description:
          item.description,

        quantity:
          item.quantity,

        includedQuantity:
          item.includedQuantity,

        optionalQuantity:
          item.optionalQuantity,

        unitPrice:
          Number(item.unitPrice),

        pricingBase:
          item.pricingBase,

        pricingFrequency:
          item.pricingFrequency,

        billingUnits:
          Number(item.billingUnits),

        subtotal:
          Number(item.subtotal),

        startAt:
          item.startAt,

        endAt:
          item.endAt,

        resources:
          item.resources.map((assignment) => ({
            assignmentId:
              assignment.id,

            resourceId:
              assignment.resourceId,

            name:
              assignment.resource.name,

            code:
              assignment.resource.code,

            floor:
              assignment.resource.floor,

            resourceType:
              assignment.resource.resourceType
                ? {
                    id:
                      assignment.resource.resourceType.id,

                    name:
                      assignment.resource.resourceType.name,

                    slug:
                      assignment.resource.resourceType.slug,
                  }
                : null,

            createdAt:
              assignment.createdAt,
          })),

        createdAt:
          item.createdAt,

        updatedAt:
          item.updatedAt,
      })),

      paymentSummary,

      financialState,

      payments: reservation.payments.map((payment) => ({
        id: payment.id,

        amount: Number(payment.amount),

        method: payment.method,

        status: payment.status,

        externalReference: payment.externalReference,

        paymentUrl: payment.paymentUrl,

        proofUrl: payment.proofUrl,

        verifiedAt: payment.verifiedAt,

        verifiedBy: payment.verifiedBy,

        paidAt: payment.paidAt,

        createdAt: payment.createdAt,

        updatedAt: payment.updatedAt,

        refunds: payment.refunds.map((refund) => ({
          id: refund.id,

          basis: refund.basis,

          baseAmount: Number(refund.baseAmount),

          amount: Number(refund.amount),

          status: refund.status,

          requestedAt: refund.requestedAt,

          processedAt: refund.processedAt,

          externalReference: refund.externalReference,

          processedBy: refund.processedBy,
        })),
      })),

      refunds: reservation.refunds.map((refund) => ({
        id: refund.id,

        paymentId: refund.paymentId,

        cancellationId: refund.cancellationId,

        reservationChangeId: refund.reservationChangeId,

        basis: refund.basis,

        baseAmount: Number(refund.baseAmount),

        contractElapsedDays: refund.contractElapsedDays,

        paymentElapsedDays: refund.paymentElapsedDays,

        fullRefundDays: refund.fullRefundDays,

        annualAdministrativeRate:
          refund.annualAdministrativeRate !== null
            ? Number(refund.annualAdministrativeRate)
            : null,

        maxAdministrativeRetention: Number(refund.maxAdministrativeRetention),

        administrativeRetention: Number(refund.administrativeRetention),

        amount: Number(refund.amount),

        status: refund.status,

        reason: refund.reason,

        requestedAt: refund.requestedAt,

        processedAt: refund.processedAt,

        externalReference: refund.externalReference,

        processedBy: refund.processedBy,

        payment: {
          id: refund.payment.id,

          amount: Number(refund.payment.amount),

          method: refund.payment.method,

          status: refund.payment.status,

          paidAt: refund.payment.paidAt,
        },

        cancellation: refund.cancellation,

        reservationChange: refund.reservationChange,
      })),

      cancellation: reservation.cancellation
        ? {
            id: reservation.cancellation.id,

            type: reservation.cancellation.type,

            reason: reservation.cancellation.reason,

            requestedAt: reservation.cancellation.requestedAt,

            cancelledAt: reservation.cancellation.cancelledAt,

            createdBy: reservation.cancellation.createdBy,
          }
        : null,

      changes: reservation.changes.map((change) => ({
        id: change.id,

        type: change.type,

        reason: change.reason,

        oldStartAt: change.oldStartAt,

        newStartAt: change.newStartAt,

        oldEndAt: change.oldEndAt,

        newEndAt: change.newEndAt,

        oldSubtotal:
          change.oldSubtotal !== null ? Number(change.oldSubtotal) : null,

        newSubtotal:
          change.newSubtotal !== null ? Number(change.newSubtotal) : null,

        oldTotal: change.oldTotal !== null ? Number(change.oldTotal) : null,

        newTotal: change.newTotal !== null ? Number(change.newTotal) : null,

        oldStatus: change.oldStatus,

        newStatus: change.newStatus,

        details: change.details,

        changedBy: change.changedBy,

        refunds: change.refunds.map((refund) => ({
          id: refund.id,

          basis: refund.basis,

          amount: Number(refund.amount),

          status: refund.status,
        })),

        createdAt: change.createdAt,
      })),
    });
  } catch (error) {
    console.error("GET /api/reservations/[id] error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "No fue posible obtener la reserva",
      },
      {
        status: 500,
      },
    );
  }
}
