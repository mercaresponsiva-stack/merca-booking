/*
  Warnings:

  - A unique constraint covering the columns `[businessId,idempotencyKey]` on the table `Reservation` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "idempotencyFingerprint" VARCHAR(64),
ADD COLUMN     "idempotencyKey" VARCHAR(36);

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_businessId_idempotencyKey_key" ON "Reservation"("businessId", "idempotencyKey");
