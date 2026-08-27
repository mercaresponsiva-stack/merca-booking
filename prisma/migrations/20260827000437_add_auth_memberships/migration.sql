/*
  Warnings:

  - A unique constraint covering the columns `[authUserId]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "authUserId" UUID;

-- CreateTable
CREATE TABLE "BusinessMembership" (
    "businessId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'RECEPTIONIST',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessMembership_pkey" PRIMARY KEY ("businessId","userId")
);

-- CreateIndex
CREATE INDEX "BusinessMembership_userId_isActive_idx" ON "BusinessMembership"("userId", "isActive");

-- CreateIndex
CREATE INDEX "BusinessMembership_businessId_role_isActive_idx" ON "BusinessMembership"("businessId", "role", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "User_authUserId_key" ON "User"("authUserId");

-- AddForeignKey
ALTER TABLE "BusinessMembership" ADD CONSTRAINT "BusinessMembership_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessMembership" ADD CONSTRAINT "BusinessMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill existing users into business memberships.
INSERT INTO "BusinessMembership" (
    "businessId",
    "userId",
    "role",
    "isActive",
    "createdAt",
    "updatedAt"
)
SELECT
    "businessId",
    "id",
    "role",
    "isActive",
    "createdAt",
    "updatedAt"
FROM "User"
ON CONFLICT ("businessId", "userId") DO NOTHING;
