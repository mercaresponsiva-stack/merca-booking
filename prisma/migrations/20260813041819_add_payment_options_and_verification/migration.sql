-- CreateEnum
CREATE TYPE "PaymentOption" AS ENUM ('FULL', 'DEPOSIT_50');

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "proofUrl" TEXT,
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedById" TEXT;

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "paymentOption" "PaymentOption";

-- CreateIndex
CREATE INDEX "Payment_verifiedById_idx" ON "Payment"("verifiedById");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
