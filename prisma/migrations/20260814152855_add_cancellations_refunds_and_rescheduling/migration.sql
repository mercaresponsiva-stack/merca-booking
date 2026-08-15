-- CreateEnum
CREATE TYPE "CancellationType" AS ENUM ('RETRACTO', 'DESISTIMIENTO', 'PROVIDER_CANCELLATION', 'OTHER');

-- CreateEnum
CREATE TYPE "RefundBasis" AS ENUM ('RETRACTO', 'DESISTIMIENTO', 'PROVIDER_CANCELLATION', 'PRICE_ADJUSTMENT', 'MANUAL');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReservationChangeType" AS ENUM ('RESCHEDULE', 'RESOURCE_CHANGE', 'PRICE_ADJUSTMENT', 'MANUAL');

-- CreateTable
CREATE TABLE "RefundPolicy" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fullRefundDays" INTEGER NOT NULL DEFAULT 8,
    "annualAdministrativeRate" DECIMAL(8,6) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefundPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cancellation" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "type" "CancellationType" NOT NULL,
    "reason" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cancellation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "cancellationId" TEXT,
    "reservationChangeId" TEXT,
    "refundPolicyId" TEXT,
    "basis" "RefundBasis" NOT NULL,
    "baseAmount" DECIMAL(10,2) NOT NULL,
    "fullRefundDays" INTEGER,
    "annualAdministrativeRate" DECIMAL(8,6),
    "elapsedDays" INTEGER,
    "maxAdministrativeRetention" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "administrativeRetention" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "processedById" TEXT,
    "externalReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservationChange" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "type" "ReservationChangeType" NOT NULL,
    "changedById" TEXT,
    "reason" TEXT,
    "oldStartAt" TIMESTAMP(3),
    "newStartAt" TIMESTAMP(3),
    "oldEndAt" TIMESTAMP(3),
    "newEndAt" TIMESTAMP(3),
    "oldSubtotal" DECIMAL(10,2),
    "newSubtotal" DECIMAL(10,2),
    "oldTotal" DECIMAL(10,2),
    "newTotal" DECIMAL(10,2),
    "oldStatus" "ReservationStatus",
    "newStatus" "ReservationStatus",
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReservationChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RefundPolicy_businessId_idx" ON "RefundPolicy"("businessId");

-- CreateIndex
CREATE INDEX "RefundPolicy_businessId_isActive_idx" ON "RefundPolicy"("businessId", "isActive");

-- CreateIndex
CREATE INDEX "RefundPolicy_effectiveFrom_idx" ON "RefundPolicy"("effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "Cancellation_reservationId_key" ON "Cancellation"("reservationId");

-- CreateIndex
CREATE INDEX "Cancellation_businessId_idx" ON "Cancellation"("businessId");

-- CreateIndex
CREATE INDEX "Cancellation_createdById_idx" ON "Cancellation"("createdById");

-- CreateIndex
CREATE INDEX "Cancellation_type_idx" ON "Cancellation"("type");

-- CreateIndex
CREATE INDEX "Refund_businessId_idx" ON "Refund"("businessId");

-- CreateIndex
CREATE INDEX "Refund_reservationId_idx" ON "Refund"("reservationId");

-- CreateIndex
CREATE INDEX "Refund_paymentId_idx" ON "Refund"("paymentId");

-- CreateIndex
CREATE INDEX "Refund_cancellationId_idx" ON "Refund"("cancellationId");

-- CreateIndex
CREATE INDEX "Refund_reservationChangeId_idx" ON "Refund"("reservationChangeId");

-- CreateIndex
CREATE INDEX "Refund_refundPolicyId_idx" ON "Refund"("refundPolicyId");

-- CreateIndex
CREATE INDEX "Refund_processedById_idx" ON "Refund"("processedById");

-- CreateIndex
CREATE INDEX "Refund_status_idx" ON "Refund"("status");

-- CreateIndex
CREATE INDEX "Refund_basis_idx" ON "Refund"("basis");

-- CreateIndex
CREATE INDEX "ReservationChange_businessId_idx" ON "ReservationChange"("businessId");

-- CreateIndex
CREATE INDEX "ReservationChange_reservationId_idx" ON "ReservationChange"("reservationId");

-- CreateIndex
CREATE INDEX "ReservationChange_changedById_idx" ON "ReservationChange"("changedById");

-- CreateIndex
CREATE INDEX "ReservationChange_type_idx" ON "ReservationChange"("type");

-- CreateIndex
CREATE INDEX "ReservationChange_createdAt_idx" ON "ReservationChange"("createdAt");

-- AddForeignKey
ALTER TABLE "RefundPolicy" ADD CONSTRAINT "RefundPolicy_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cancellation" ADD CONSTRAINT "Cancellation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cancellation" ADD CONSTRAINT "Cancellation_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cancellation" ADD CONSTRAINT "Cancellation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_cancellationId_fkey" FOREIGN KEY ("cancellationId") REFERENCES "Cancellation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_reservationChangeId_fkey" FOREIGN KEY ("reservationChangeId") REFERENCES "ReservationChange"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_refundPolicyId_fkey" FOREIGN KEY ("refundPolicyId") REFERENCES "RefundPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationChange" ADD CONSTRAINT "ReservationChange_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationChange" ADD CONSTRAINT "ReservationChange_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationChange" ADD CONSTRAINT "ReservationChange_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
