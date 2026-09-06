import "server-only";

import {
  randomUUID,
} from "node:crypto";

import type {
  PaymentOption,
} from "@/generated/prisma/client";

import {
  calculateHotelPrice,
} from "@/lib/booking/verticals/hotel/pricing";

import {
  quoteHotelServiceOptions,
  type HotelOptionSelection,
} from "@/lib/booking/verticals/hotel/option-quote";

import {
  assertProspectiveInventoryAvailable,
  evaluateProspectiveInventory,
  type ProspectiveInventoryDemand,
} from "@/lib/booking/prospective-inventory";

import {
  getResourceTypeInventoryState,
} from "@/lib/booking/resource-type-inventory";

import {
  calculatePendingReservationExpiresAt,
} from "@/lib/booking/reservation-expiration-deadline";

import {
  prisma,
} from "@/lib/prisma";

export const RESERVATION_SOURCES = [
  "WEBSITE",
  "WHATSAPP",
  "PHONE",
  "WALK_IN",
  "AIRBNB",
  "OTHER",
] as const;

export type ReservationSource =
  (typeof RESERVATION_SOURCES)[number];

export type CreateHotelReservationInput = {
  business: {
    id:
      string;

    pendingReservationHoldMinutes:
      number;
  };

  idempotency?: {
    key:
      string;

    fingerprint:
      string;
  };

  serviceId:
    string;

  customerId:
    string;

  firstName:
    string;

  lastName:
    string;

  email:
    string | null;

  phone:
    string | null;

  checkIn:
    string;

  checkOut:
    string;

  startAt:
    Date;

  endAt:
    Date;

  adults:
    number;

  children:
    number;

  guests:
    number;

  specialRequests:
    string | null;

  paymentOption:
    PaymentOption;

  source:
    ReservationSource;

  optionSelections:
    HotelOptionSelection[];
};

function generateConfirmationCode() {
  const random =
    randomUUID()
      .replaceAll(
        "-",
        "",
      )
      .slice(
        0,
        8,
      )
      .toUpperCase();

  return "MB-" + random;
}

export async function createHotelReservation({
  business,

  idempotency,

  serviceId,

  customerId,

  firstName,
  lastName,

  email,
  phone,

  checkIn,
  checkOut,

  startAt,
  endAt,

  adults,
  children,
  guests,

  specialRequests,

  paymentOption,

  source,

  optionSelections,
}: CreateHotelReservationInput) {
    const result = await prisma.$transaction(
      async (tx) => {
        /*
         * La modalidad se valida contra la configuración
         * vigente solamente al crear la reserva.
         *
         * Una vez guardada, Reservation.paymentOption es
         * la instantánea contractual que conservarán los
         * flujos posteriores aunque el negocio cambie su
         * configuración para nuevas reservas.
         */
        const paymentConfiguration =
          await tx.business.findFirst({
            where: {
              id: business.id,
              isActive: true,

              enabledPaymentOptions: {
                has: paymentOption,
              },
            },

            select: {
              id: true,
            },
          });

        if (!paymentConfiguration) {
          throw new Error(
            "PAYMENT_OPTION_NOT_ENABLED",
          );
        }

        // ─────────────────────────────────────────
        // SERVICE
        //
        // Hotel:
        // Service = Habitación Standard
        // ─────────────────────────────────────────

        const service = await tx.service.findFirst({
          where: {
            id: serviceId,
            businessId: business.id,
            isActive: true,
          },

          include: {
            rates: {
              where: {
                isActive: true,

                startDate: {
                  lte: endAt,
                },

                endDate: {
                  gte: startAt,
                },
              },

              orderBy: {
                startDate: "desc",
              },
            },

            resourceTypes: {
              include: {
                resourceType: {
                  include: {
                    resources: {
                      where: {
                        isActive: true,
                      },

                      orderBy: {
                        name: "asc",
                      },
                    },
                  },
                },
              },
            },
          },
        });

        if (!service) {
          throw new Error("SERVICE_NOT_FOUND");
        }

        // ─────────────────────────────────────────
        // 7. CAPACITY
        // ─────────────────────────────────────────

        if (guests > service.maxPeople) {
          throw new Error("SERVICE_CAPACITY_EXCEEDED");
        }

        if (service.maxAdults !== null && adults > service.maxAdults) {
          throw new Error("SERVICE_CAPACITY_EXCEEDED");
        }

        if (service.maxChildren !== null && children > service.maxChildren) {
          throw new Error("SERVICE_CAPACITY_EXCEEDED");
        }

        // ─────────────────────────────────────────
        // 8. PRICING
        //
        // La lógica continúa siendo hotelera:
        // weekday / weekend por noche.
        // ─────────────────────────────────────────

        /*
         * ─────────────────────────────────────────
         * 8. SERVICE PRICING
         * ─────────────────────────────────────────
         */

        const pricing = calculateHotelPrice(
          checkIn,
          checkOut,
          service.rates,
        );

        const serviceSubtotal =
          pricing.total;

        /*
         * ─────────────────────────────────────────
         * 9. OPTION QUOTE
         *
         * Toda la configuración monetaria
         * proviene de la base de datos.
         * ─────────────────────────────────────────
         */

        const optionQuote =
          await quoteHotelServiceOptions({
            businessId:
              business.id,

            serviceId:
              service.id,

            checkIn,
            checkOut,

            guests,

            selections:
              optionSelections,

            db:
              tx,
          });

        const optionSubtotal =
          optionQuote.subtotal;

        const subtotal =
          Math.round(
            (
              serviceSubtotal +
              optionSubtotal +
              Number.EPSILON
            ) *
              100,
          ) / 100;

        const total =
          subtotal;

        /*
         * Hotel V1 necesita al menos
         * un ResourceType obligatorio
         * para representar la habitación.
         */
        if (
          service.resourceTypes.length ===
          0
        ) {
          throw new Error(
            "SERVICE_RESOURCE_NOT_CONFIGURED",
          );
        }

        /*
         * ─────────────────────────────────────────
         * 10. PROSPECTIVE INVENTORY DEMAND
         *
         * Sumamos la demanda NUEVA antes
         * de persistir la reserva.
         *
         * Esto evita validar Service y Options
         * de forma independiente cuando comparten
         * el mismo ResourceType.
         * ─────────────────────────────────────────
         */

        const prospectiveDemands:
          ProspectiveInventoryDemand[] =
          [];

        /*
         * Demanda obligatoria del Service.
         *
         * ReservationService.quantity será 1.
         */
        for (
          const requirement of
          service.resourceTypes
        ) {
          prospectiveDemands.push({
            resourceTypeId:
              requirement
                .resourceTypeId,

            startAt,
            endAt,

            requiredResources:
              Math.max(
                requirement
                  .requiredQuantity,
                1,
              ),

            source:
              `SERVICE:${service.id}`,
          });
        }

        /*
         * Demanda física de Options.
         *
         * Si ReservationOption tiene
         * intervalo propio, usamos ese.
         *
         * Si no, hereda la reserva.
         */
        for (
          const optionItem of
          optionQuote.items
        ) {
          for (
            const requirement of
            optionItem.resourceTypes
          ) {
            prospectiveDemands.push({
              resourceTypeId:
                requirement
                  .resourceTypeId,

              startAt:
                optionItem.startAt ??
                startAt,

              endAt:
                optionItem.endAt ??
                endAt,

              requiredResources:
                requirement
                  .requiredResources,

              source:
                `OPTION:${optionItem.serviceOptionId}`,
            });
          }
        }

        const prospectiveInventory =
          await evaluateProspectiveInventory({
            businessId:
              business.id,

            serviceId:
              service.id,

            demands:
              prospectiveDemands,

            db:
              tx,
          });

        assertProspectiveInventoryAvailable(
          prospectiveInventory,
        );

        /*
         * ─────────────────────────────────────────
         * 11. AUTOMATIC SERVICE RESOURCE
         *
         * Conservamos la regla existente:
         *
         * Solo autoasignamos cuando el
         * ResourceType tiene exactamente
         * un Resource físico activo y el
         * Service necesita exactamente uno.
         *
         * Las Options NO se autoasignan aquí.
         * ─────────────────────────────────────────
         */

        const autoAssignResourceIds:
          string[] =
          [];

        for (
          const requirement of
          service.resourceTypes
        ) {
          const resourceType =
            requirement.resourceType;

          const requiredQuantity =
            Math.max(
              requirement
                .requiredQuantity,
              1,
            );

          if (
            requiredQuantity !== 1 ||
            resourceType
              .resources
              .length !== 1
          ) {
            continue;
          }

          const onlyResource =
            resourceType
              .resources[0];

          const inventory =
            await getResourceTypeInventoryState({
              businessId:
                business.id,

              resourceTypeId:
                resourceType.id,

              startAt,
              endAt,

              serviceId:
                service.id,

              db:
                tx,
            });

          if (
            inventory
              .availableResourceIds
              .includes(
                onlyResource.id,
              )
          ) {
            autoAssignResourceIds.push(
              onlyResource.id,
            );
          }
        }

        /*
         * ─────────────────────────────────────────
         * 12. CUSTOMER
         * ─────────────────────────────────────────
         */
        const customer = customerId
          ? await tx.customer.findFirst({
              where: {
                id: customerId,
                businessId: business.id,
              },
            })
          : await tx.customer.create({
              data: {
                businessId: business.id,

                firstName,
                lastName,

                email: email || null,
                phone: phone || null,
              },
            });

        if (!customer) {
          throw new Error("CUSTOMER_NOT_FOUND");
        }

        // ─────────────────────────────────────────
        // 14. RESERVATION
        // ─────────────────────────────────────────

        const reservationCreatedAt =
          new Date();

        const reservationExpiresAt =
          calculatePendingReservationExpiresAt(
            {
              createdAt:
                reservationCreatedAt,

              holdMinutes:
                business
                  .pendingReservationHoldMinutes,
            },
          );

        const reservation = await tx.reservation.create({
          data: {
            businessId: business.id,
            customerId: customer.id,

            confirmationCode: generateConfirmationCode(),

            idempotencyKey:
              idempotency?.key ??
              null,

            idempotencyFingerprint:
              idempotency?.fingerprint ??
              null,

            startAt,
            endAt,

            guests,
            adults,
            children,

            status: "PENDING",

            createdAt:
              reservationCreatedAt,

            expiresAt:
              reservationExpiresAt,

            subtotal,
            total,

            paymentOption,

            /*
             * Regla actual del sistema:
             *
             * El flujo público WEBSITE conserva
             * elegibilidad a retracto.
             *
             * Las reservas administrativas
             * registran su canal real y no se
             * marcan automáticamente elegibles.
             *
             * Esto representa la política actual
             * del producto, no una determinación
             * legal automática sobre cada caso.
             */
            retractoEligible: source === "WEBSITE",

            specialRequests: specialRequests || null,

            source,
          },
        });

        // ─────────────────────────────────────────
        // 15. RESERVATION SERVICE
        //
        // El Service es lo que el cliente compró.
        // ─────────────────────────────────────────

        const reservationService = await tx.reservationService.create({
          data: {
            reservationId: reservation.id,
            serviceId: service.id,

            quantity: 1,

            /*
             * El modelo actual guarda un unitPrice.
             *
             * Para alojamiento seguimos usando
             * el promedio por noche, igual que
             * hacía nightlyRate anteriormente.
             *
             * La suma exacta weekday/weekend
             * permanece en subtotal.
             */
            unitPrice: serviceSubtotal / pricing.numberOfNights,

            subtotal: serviceSubtotal,
          },
        });

        // ─────────────────────────────────────────
        // 16. OPTIONAL RESOURCE ASSIGNMENT
        // ─────────────────────────────────────────

        /*
         * ─────────────────────────────────────────
         * RESERVATION OPTIONS
         *
         * Persistimos snapshots.
         *
         * Si la configuración cambia después,
         * la reserva conserva lo que realmente
         * fue comprado en este momento.
         * ─────────────────────────────────────────
         */

        for (
          const optionItem of
          optionQuote.items
        ) {
          await tx.reservationOption.create({
            data: {
              reservationId:
                reservation.id,

              reservationServiceId:
                reservationService.id,

              optionId:
                optionItem.optionId,

              serviceOptionId:
                optionItem.serviceOptionId,

              name:
                optionItem.name,

              description:
                optionItem.description,

              quantity:
                optionItem.quantity,

              includedQuantity:
                optionItem
                  .includedQuantity,

              optionalQuantity:
                optionItem
                  .optionalQuantity,

              unitPrice:
                optionItem.unitPrice,

              pricingBase:
                optionItem.pricingBase,

              pricingFrequency:
                optionItem
                  .pricingFrequency,

              billingUnits:
                optionItem.billingUnits,

              subtotal:
                optionItem.subtotal,

              startAt:
                optionItem.startAt,

              endAt:
                optionItem.endAt,
            },
          });
        }
        for (const resourceId of autoAssignResourceIds) {
          await tx.reservationResource.create({
            data: {
              reservationId: reservation.id,

              reservationServiceId: reservationService.id,

              resourceId,
            },
          });
        }

        // ─────────────────────────────────────────
        // 17. RETURN COMPLETE RESERVATION
        // ─────────────────────────────────────────

        const completeReservation = await tx.reservation.findUniqueOrThrow({
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

            options: true,

            payments: true,
          },
        });

        return {
          reservation: completeReservation,

          pricing: {
            numberOfNights: pricing.numberOfNights,

            nightlyPrices: pricing.nightlyPrices,

            serviceSubtotal,

            optionSubtotal,

            total,
          },
        };
      },

      {
        isolationLevel: "Serializable",
      },
    );

    return result;
}
