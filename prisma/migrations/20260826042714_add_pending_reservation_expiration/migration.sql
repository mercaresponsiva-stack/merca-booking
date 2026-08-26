-- AlterEnum
ALTER TYPE "ReservationChangeType" ADD VALUE 'EXPIRATION';

-- AlterEnum
ALTER TYPE "ReservationStatus" ADD VALUE 'EXPIRED';

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "pendingReservationHoldMinutes" INTEGER NOT NULL DEFAULT 30;

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "expiresAt" TIMESTAMP(3);

-- BackfillPendingReservationExpiration
-- Las reservas existentes conservan su estado.
-- Solo se calcula el vencimiento histórico según
-- la configuración inicial de cada negocio.
UPDATE "Reservation" AS "reservation"
SET "expiresAt" =
  "reservation"."createdAt" +
  (
    "business"."pendingReservationHoldMinutes" *
    INTERVAL '1 minute'
  )
FROM "Business" AS "business"
WHERE
  "reservation"."businessId" = "business"."id"
  AND "reservation"."status" = 'PENDING'
  AND "reservation"."expiresAt" IS NULL;

-- CreateIndex
CREATE INDEX "Reservation_status_expiresAt_idx" ON "Reservation"("status", "expiresAt");
