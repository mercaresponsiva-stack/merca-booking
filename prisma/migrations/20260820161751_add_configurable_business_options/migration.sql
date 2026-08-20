-- CreateEnum
CREATE TYPE "OptionPricingBase" AS ENUM ('RESERVATION', 'QUANTITY', 'PERSON');

-- CreateEnum
CREATE TYPE "OptionPricingFrequency" AS ENUM ('ONCE', 'PER_NIGHT', 'PER_DAY', 'PER_HOUR');

-- AlterTable
ALTER TABLE "ReservationResource" ADD COLUMN     "reservationOptionId" TEXT;

-- CreateTable
CREATE TABLE "BusinessOption" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceOption" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "isIncluded" BOOLEAN NOT NULL DEFAULT false,
    "isOptional" BOOLEAN NOT NULL DEFAULT false,
    "includedQuantity" INTEGER,
    "minOptionalQuantity" INTEGER NOT NULL DEFAULT 1,
    "maxOptionalQuantity" INTEGER,
    "price" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "pricingBase" "OptionPricingBase" NOT NULL DEFAULT 'RESERVATION',
    "pricingFrequency" "OptionPricingFrequency" NOT NULL DEFAULT 'ONCE',
    "availableDuringBooking" BOOLEAN NOT NULL DEFAULT true,
    "availableAfterBooking" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceOptionResourceType" (
    "id" TEXT NOT NULL,
    "serviceOptionId" TEXT NOT NULL,
    "resourceTypeId" TEXT NOT NULL,
    "requiredQuantity" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceOptionResourceType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservationOption" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "reservationServiceId" TEXT,
    "optionId" TEXT,
    "serviceOptionId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "includedQuantity" INTEGER NOT NULL DEFAULT 0,
    "optionalQuantity" INTEGER NOT NULL DEFAULT 0,
    "unitPrice" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "pricingBase" "OptionPricingBase" NOT NULL,
    "pricingFrequency" "OptionPricingFrequency" NOT NULL,
    "billingUnits" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "subtotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReservationOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BusinessOption_businessId_idx" ON "BusinessOption"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessOption_businessId_slug_key" ON "BusinessOption"("businessId", "slug");

-- CreateIndex
CREATE INDEX "ServiceOption_serviceId_idx" ON "ServiceOption"("serviceId");

-- CreateIndex
CREATE INDEX "ServiceOption_optionId_idx" ON "ServiceOption"("optionId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceOption_serviceId_optionId_key" ON "ServiceOption"("serviceId", "optionId");

-- CreateIndex
CREATE INDEX "ServiceOptionResourceType_serviceOptionId_idx" ON "ServiceOptionResourceType"("serviceOptionId");

-- CreateIndex
CREATE INDEX "ServiceOptionResourceType_resourceTypeId_idx" ON "ServiceOptionResourceType"("resourceTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceOptionResourceType_serviceOptionId_resourceTypeId_key" ON "ServiceOptionResourceType"("serviceOptionId", "resourceTypeId");

-- CreateIndex
CREATE INDEX "ReservationOption_reservationId_idx" ON "ReservationOption"("reservationId");

-- CreateIndex
CREATE INDEX "ReservationOption_reservationServiceId_idx" ON "ReservationOption"("reservationServiceId");

-- CreateIndex
CREATE INDEX "ReservationOption_optionId_idx" ON "ReservationOption"("optionId");

-- CreateIndex
CREATE INDEX "ReservationOption_serviceOptionId_idx" ON "ReservationOption"("serviceOptionId");

-- CreateIndex
CREATE INDEX "ReservationResource_reservationOptionId_idx" ON "ReservationResource"("reservationOptionId");

-- AddForeignKey
ALTER TABLE "BusinessOption" ADD CONSTRAINT "BusinessOption_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceOption" ADD CONSTRAINT "ServiceOption_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceOption" ADD CONSTRAINT "ServiceOption_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "BusinessOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceOptionResourceType" ADD CONSTRAINT "ServiceOptionResourceType_serviceOptionId_fkey" FOREIGN KEY ("serviceOptionId") REFERENCES "ServiceOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceOptionResourceType" ADD CONSTRAINT "ServiceOptionResourceType_resourceTypeId_fkey" FOREIGN KEY ("resourceTypeId") REFERENCES "ResourceType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationOption" ADD CONSTRAINT "ReservationOption_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationOption" ADD CONSTRAINT "ReservationOption_reservationServiceId_fkey" FOREIGN KEY ("reservationServiceId") REFERENCES "ReservationService"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationOption" ADD CONSTRAINT "ReservationOption_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "BusinessOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationOption" ADD CONSTRAINT "ReservationOption_serviceOptionId_fkey" FOREIGN KEY ("serviceOptionId") REFERENCES "ServiceOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationResource" ADD CONSTRAINT "ReservationResource_reservationOptionId_fkey" FOREIGN KEY ("reservationOptionId") REFERENCES "ReservationOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;
