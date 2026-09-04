-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentOption" ADD VALUE 'DEPOSIT_25';
ALTER TYPE "PaymentOption" ADD VALUE 'DEPOSIT_10';

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "enabledPaymentOptions" "PaymentOption"[] DEFAULT ARRAY['DEPOSIT_50', 'FULL']::"PaymentOption"[];

-- BusinessPaymentOptionsIntegrity
ALTER TABLE "Business"
ADD CONSTRAINT "Business_enabledPaymentOptions_nonempty"
CHECK (
  "enabledPaymentOptions" IS NOT NULL
  AND cardinality("enabledPaymentOptions") > 0
);
