/*
  Warnings:

  - You are about to drop the column `elapsedDays` on the `Refund` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Refund" DROP COLUMN "elapsedDays",
ADD COLUMN     "contractElapsedDays" INTEGER,
ADD COLUMN     "paymentElapsedDays" INTEGER;

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "retractoEligible" BOOLEAN NOT NULL DEFAULT false;
