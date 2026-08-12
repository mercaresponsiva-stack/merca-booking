-- ============================================================
-- GENERALIZE BOOKING MODEL
-- Hotel-specific model -> Generic booking core
-- ============================================================


-- ============================================================
-- 1. ENUMS
-- ============================================================

ALTER TYPE "PaymentMethod" ADD VALUE 'CARD';


-- ============================================================
-- 2. CREATE NEW CORE TABLES
-- ============================================================

CREATE TABLE "BusinessType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessType_pkey" PRIMARY KEY ("id")
);


CREATE TABLE "Business" (
    "id" TEXT NOT NULL,
    "businessTypeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT NOT NULL DEFAULT 'El Salvador',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "timezone" TEXT NOT NULL DEFAULT 'America/El_Salvador',
    "checkInTime" TEXT,
    "checkOutTime" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);


CREATE TABLE "Service" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "durationMinutes" INTEGER,
    "maxPeople" INTEGER NOT NULL DEFAULT 1,
    "maxAdults" INTEGER,
    "maxChildren" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);


CREATE TABLE "ResourceType" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResourceType_pkey" PRIMARY KEY ("id")
);


CREATE TABLE "Resource" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "resourceTypeId" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "floor" INTEGER,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);


CREATE TABLE "ServiceResourceType" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "resourceTypeId" TEXT NOT NULL,
    "requiredQuantity" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceResourceType_pkey" PRIMARY KEY ("id")
);


CREATE TABLE "ServiceRate" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "weekdayPrice" DECIMAL(10,2) NOT NULL,
    "weekendPrice" DECIMAL(10,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceRate_pkey" PRIMARY KEY ("id")
);


CREATE TABLE "Schedule" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Schedule_pkey" PRIMARY KEY ("id")
);


CREATE TABLE "AvailabilityRule" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "startTime" TEXT,
    "endTime" TEXT,
    "dayOfWeek" INTEGER,
    "capacity" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AvailabilityRule_pkey" PRIMARY KEY ("id")
);


CREATE TABLE "ReservationService" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "subtotal" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReservationService_pkey" PRIMARY KEY ("id")
);


CREATE TABLE "ReservationResource" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "reservationServiceId" TEXT,
    "resourceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReservationResource_pkey" PRIMARY KEY ("id")
);


-- ============================================================
-- 3. CREATE BUSINESS TYPE
-- ============================================================

INSERT INTO "BusinessType" (
    "id",
    "name",
    "slug",
    "description",
    "isActive",
    "createdAt",
    "updatedAt"
)
VALUES (
    'business_type_hotel',
    'Hotel',
    'hotel',
    'Negocio de alojamiento y hospedaje',
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);


-- ============================================================
-- 4. HOTEL -> BUSINESS
--
-- Preserve the Hotel ID.
-- This makes migration of all foreign keys considerably safer.
-- ============================================================

INSERT INTO "Business" (
    "id",
    "businessTypeId",
    "name",
    "slug",
    "description",
    "email",
    "phone",
    "address",
    "city",
    "country",
    "currency",
    "timezone",
    "checkInTime",
    "checkOutTime",
    "isActive",
    "createdAt",
    "updatedAt"
)
SELECT
    "id",
    'business_type_hotel',
    "name",
    "slug",
    "description",
    "email",
    "phone",
    "address",
    "city",
    "country",
    "currency",
    "timezone",
    "checkInTime",
    "checkOutTime",
    "isActive",
    "createdAt",
    "updatedAt"
FROM "Hotel";


-- ============================================================
-- 5. ROOM TYPE -> RESOURCE TYPE
--
-- Preserve RoomType.id as ResourceType.id
-- ============================================================

INSERT INTO "ResourceType" (
    "id",
    "businessId",
    "name",
    "slug",
    "description",
    "createdAt",
    "updatedAt"
)
SELECT
    "id",
    "hotelId",
    "name",
    "slug",
    "description",
    "createdAt",
    "updatedAt"
FROM "RoomType";


-- ============================================================
-- 6. ROOM TYPE -> SERVICE
--
-- A hotel RoomType becomes both:
--
-- ResourceType = physical category
-- Service      = what the customer books
--
-- We intentionally preserve the RoomType ID in both tables.
-- They are separate tables, so this creates no PK conflict.
-- ============================================================

INSERT INTO "Service" (
    "id",
    "businessId",
    "name",
    "slug",
    "description",
    "durationMinutes",
    "maxPeople",
    "maxAdults",
    "maxChildren",
    "isActive",
    "createdAt",
    "updatedAt"
)
SELECT
    "id",
    "hotelId",
    "name",
    "slug",
    "description",
    NULL,
    GREATEST(1, "maxAdults" + "maxChildren"),
    "maxAdults",
    "maxChildren",
    "isActive",
    "createdAt",
    "updatedAt"
FROM "RoomType";


-- ============================================================
-- 7. LINK SERVICES TO RESOURCE TYPES
-- ============================================================

INSERT INTO "ServiceResourceType" (
    "id",
    "serviceId",
    "resourceTypeId",
    "requiredQuantity",
    "createdAt"
)
SELECT
    'srt_' || "id",
    "id",
    "id",
    1,
    "createdAt"
FROM "RoomType";


-- ============================================================
-- 8. ROOM -> RESOURCE
--
-- Preserve Room.id as Resource.id
--
-- number becomes:
-- name = 101
-- code = 101
-- ============================================================

INSERT INTO "Resource" (
    "id",
    "businessId",
    "resourceTypeId",
    "name",
    "code",
    "floor",
    "capacity",
    "isActive",
    "createdAt",
    "updatedAt"
)
SELECT
    r."id",
    rt."hotelId",
    r."roomTypeId",
    r."number",
    r."number",
    r."floor",
    GREATEST(1, rt."maxAdults" + rt."maxChildren"),
    r."isActive",
    r."createdAt",
    r."updatedAt"
FROM "Room" r
INNER JOIN "RoomType" rt
    ON rt."id" = r."roomTypeId";


-- ============================================================
-- 9. RATE -> SERVICE RATE
-- ============================================================

INSERT INTO "ServiceRate" (
    "id",
    "serviceId",
    "name",
    "startDate",
    "endDate",
    "weekdayPrice",
    "weekendPrice",
    "isActive",
    "createdAt",
    "updatedAt"
)
SELECT
    "id",
    "roomTypeId",
    "name",
    "startDate",
    "endDate",
    "weekdayPrice",
    "weekendPrice",
    "isActive",
    "createdAt",
    "updatedAt"
FROM "Rate";


-- ============================================================
-- 10. RESERVATION ROOM -> RESERVATION SERVICE
--
-- Preserve ReservationRoom.id.
--
-- nightlyRate becomes unitPrice.
-- ============================================================

INSERT INTO "ReservationService" (
    "id",
    "reservationId",
    "serviceId",
    "quantity",
    "unitPrice",
    "subtotal",
    "createdAt"
)
SELECT
    "id",
    "reservationId",
    "roomTypeId",
    "quantity",
    "nightlyRate",
    "subtotal",
    "createdAt"
FROM "ReservationRoom";


-- ============================================================
-- 11. ASSIGNED ROOM -> RESERVATION RESOURCE
--
-- Only create records where a physical room was assigned.
--
-- Therefore:
-- Juan -> Resource 101
-- Maria -> no ReservationResource yet
-- ============================================================

INSERT INTO "ReservationResource" (
    "id",
    "reservationId",
    "reservationServiceId",
    "resourceId",
    "createdAt"
)
SELECT
    "id",
    "reservationId",
    "id",
    "roomId",
    "createdAt"
FROM "ReservationRoom"
WHERE "roomId" IS NOT NULL;


-- ============================================================
-- 12. MIGRATE BLOCK
-- ============================================================

ALTER TABLE "Block"
ADD COLUMN "businessId" TEXT,
ADD COLUMN "startAt" TIMESTAMP(3),
ADD COLUMN "endAt" TIMESTAMP(3),
ADD COLUMN "serviceId" TEXT,
ADD COLUMN "resourceTypeId" TEXT,
ADD COLUMN "resourceId" TEXT;


UPDATE "Block"
SET
    "businessId" = "hotelId",
    "startAt" = "startDate",
    "endAt" = "endDate",
    "resourceTypeId" = "roomTypeId",
    "resourceId" = "roomId";


ALTER TABLE "Block"
ALTER COLUMN "businessId" SET NOT NULL,
ALTER COLUMN "startAt" SET NOT NULL,
ALTER COLUMN "endAt" SET NOT NULL;


-- ============================================================
-- 13. MIGRATE CUSTOMER
--
-- Old Customer had no hotelId.
-- Determine the business through its reservation.
--
-- Current database has one hotel, so orphan customers fall
-- back to that existing hotel.
-- ============================================================

ALTER TABLE "Customer"
ADD COLUMN "businessId" TEXT;


UPDATE "Customer" AS c
SET "businessId" = (
    SELECT r."hotelId"
    FROM "Reservation" r
    WHERE r."customerId" = c."id"
    ORDER BY r."createdAt" ASC
    LIMIT 1
);


UPDATE "Customer"
SET "businessId" = (
    SELECT "id"
    FROM "Hotel"
    ORDER BY "createdAt" ASC
    LIMIT 1
)
WHERE "businessId" IS NULL;


ALTER TABLE "Customer"
ALTER COLUMN "businessId" SET NOT NULL;


-- ============================================================
-- 14. MIGRATE PAYMENT
-- ============================================================

ALTER TABLE "Payment"
ADD COLUMN "businessId" TEXT;


UPDATE "Payment" AS p
SET "businessId" = r."hotelId"
FROM "Reservation" r
WHERE r."id" = p."reservationId";


ALTER TABLE "Payment"
ALTER COLUMN "businessId" SET NOT NULL;


-- ============================================================
-- 15. MIGRATE RESERVATION
--
-- hotelId  -> businessId
-- checkIn  -> startAt
-- checkOut -> endAt
--
-- adults + children -> guests
--
-- adults and children are intentionally preserved.
-- ============================================================

ALTER TABLE "Reservation"
ADD COLUMN "businessId" TEXT,
ADD COLUMN "startAt" TIMESTAMP(3),
ADD COLUMN "endAt" TIMESTAMP(3),
ADD COLUMN "guests" INTEGER NOT NULL DEFAULT 1;


UPDATE "Reservation"
SET
    "businessId" = "hotelId",
    "startAt" = "checkIn",
    "endAt" = "checkOut",
    "guests" = GREATEST(
        1,
        COALESCE("adults", 0) + COALESCE("children", 0)
    );


ALTER TABLE "Reservation"
ALTER COLUMN "businessId" SET NOT NULL,
ALTER COLUMN "startAt" SET NOT NULL,
ALTER COLUMN "endAt" SET NOT NULL,
ALTER COLUMN "adults" DROP NOT NULL,
ALTER COLUMN "adults" DROP DEFAULT,
ALTER COLUMN "children" DROP NOT NULL,
ALTER COLUMN "children" DROP DEFAULT;


-- ============================================================
-- 16. MIGRATE USER
-- ============================================================

ALTER TABLE "User"
ADD COLUMN "businessId" TEXT;


UPDATE "User"
SET "businessId" = "hotelId";


ALTER TABLE "User"
ALTER COLUMN "businessId" SET NOT NULL;


-- ============================================================
-- 17. REMOVE OLD FOREIGN KEYS FROM TABLES WE KEEP
-- ============================================================

ALTER TABLE "Block"
DROP CONSTRAINT "Block_hotelId_fkey";

ALTER TABLE "Block"
DROP CONSTRAINT "Block_roomId_fkey";

ALTER TABLE "Block"
DROP CONSTRAINT "Block_roomTypeId_fkey";

ALTER TABLE "Reservation"
DROP CONSTRAINT "Reservation_hotelId_fkey";

ALTER TABLE "User"
DROP CONSTRAINT "User_hotelId_fkey";


-- ============================================================
-- 18. REMOVE OLD INDEXES FROM TABLES WE KEEP
-- ============================================================

DROP INDEX "Block_hotelId_startDate_endDate_idx";
DROP INDEX "Block_roomId_idx";
DROP INDEX "Block_roomTypeId_idx";

DROP INDEX "Reservation_hotelId_checkIn_checkOut_idx";

DROP INDEX "User_hotelId_email_key";
DROP INDEX "User_hotelId_idx";


-- ============================================================
-- 19. REMOVE OLD COLUMNS
-- ============================================================

ALTER TABLE "Block"
DROP COLUMN "hotelId",
DROP COLUMN "roomTypeId",
DROP COLUMN "roomId",
DROP COLUMN "startDate",
DROP COLUMN "endDate";


ALTER TABLE "Reservation"
DROP COLUMN "hotelId",
DROP COLUMN "checkIn",
DROP COLUMN "checkOut";


ALTER TABLE "User"
DROP COLUMN "hotelId";


-- ============================================================
-- 20. DROP OLD HOTEL-SPECIFIC TABLES
--
-- Data has already been copied.
-- Drop children before parents.
-- ============================================================

DROP TABLE "ReservationRoom";
DROP TABLE "Rate";
DROP TABLE "Room";
DROP TABLE "RoomType";
DROP TABLE "Hotel";


-- ============================================================
-- 21. CREATE NEW INDEXES
-- ============================================================

CREATE UNIQUE INDEX "Business_slug_key"
ON "Business"("slug");

CREATE INDEX "Business_businessTypeId_idx"
ON "Business"("businessTypeId");


CREATE UNIQUE INDEX "BusinessType_slug_key"
ON "BusinessType"("slug");


CREATE INDEX "Service_businessId_idx"
ON "Service"("businessId");

CREATE UNIQUE INDEX "Service_businessId_slug_key"
ON "Service"("businessId", "slug");


CREATE INDEX "Resource_businessId_idx"
ON "Resource"("businessId");

CREATE INDEX "Resource_resourceTypeId_idx"
ON "Resource"("resourceTypeId");

CREATE UNIQUE INDEX "Resource_businessId_code_key"
ON "Resource"("businessId", "code");


CREATE INDEX "ResourceType_businessId_idx"
ON "ResourceType"("businessId");

CREATE UNIQUE INDEX "ResourceType_businessId_slug_key"
ON "ResourceType"("businessId", "slug");


CREATE INDEX "ServiceResourceType_serviceId_idx"
ON "ServiceResourceType"("serviceId");

CREATE INDEX "ServiceResourceType_resourceTypeId_idx"
ON "ServiceResourceType"("resourceTypeId");

CREATE UNIQUE INDEX "ServiceResourceType_serviceId_resourceTypeId_key"
ON "ServiceResourceType"("serviceId", "resourceTypeId");


CREATE INDEX "ServiceRate_serviceId_startDate_endDate_idx"
ON "ServiceRate"("serviceId", "startDate", "endDate");


CREATE INDEX "Schedule_businessId_dayOfWeek_idx"
ON "Schedule"("businessId", "dayOfWeek");


CREATE INDEX "AvailabilityRule_businessId_idx"
ON "AvailabilityRule"("businessId");


CREATE INDEX "ReservationService_reservationId_idx"
ON "ReservationService"("reservationId");

CREATE INDEX "ReservationService_serviceId_idx"
ON "ReservationService"("serviceId");


CREATE INDEX "ReservationResource_reservationId_idx"
ON "ReservationResource"("reservationId");

CREATE INDEX "ReservationResource_reservationServiceId_idx"
ON "ReservationResource"("reservationServiceId");

CREATE INDEX "ReservationResource_resourceId_idx"
ON "ReservationResource"("resourceId");

CREATE UNIQUE INDEX "ReservationResource_reservationId_resourceId_key"
ON "ReservationResource"("reservationId", "resourceId");


CREATE INDEX "Block_businessId_startAt_endAt_idx"
ON "Block"("businessId", "startAt", "endAt");

CREATE INDEX "Block_serviceId_idx"
ON "Block"("serviceId");

CREATE INDEX "Block_resourceTypeId_idx"
ON "Block"("resourceTypeId");

CREATE INDEX "Block_resourceId_idx"
ON "Block"("resourceId");


CREATE INDEX "Customer_businessId_idx"
ON "Customer"("businessId");


CREATE INDEX "Payment_businessId_idx"
ON "Payment"("businessId");


CREATE INDEX "Reservation_businessId_startAt_endAt_idx"
ON "Reservation"("businessId", "startAt", "endAt");


CREATE INDEX "User_businessId_idx"
ON "User"("businessId");

CREATE UNIQUE INDEX "User_businessId_email_key"
ON "User"("businessId", "email");


-- ============================================================
-- 22. ADD NEW FOREIGN KEYS
-- ============================================================

ALTER TABLE "Business"
ADD CONSTRAINT "Business_businessTypeId_fkey"
FOREIGN KEY ("businessTypeId")
REFERENCES "BusinessType"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;


ALTER TABLE "Service"
ADD CONSTRAINT "Service_businessId_fkey"
FOREIGN KEY ("businessId")
REFERENCES "Business"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;


ALTER TABLE "ResourceType"
ADD CONSTRAINT "ResourceType_businessId_fkey"
FOREIGN KEY ("businessId")
REFERENCES "Business"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;


ALTER TABLE "Resource"
ADD CONSTRAINT "Resource_businessId_fkey"
FOREIGN KEY ("businessId")
REFERENCES "Business"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;


ALTER TABLE "Resource"
ADD CONSTRAINT "Resource_resourceTypeId_fkey"
FOREIGN KEY ("resourceTypeId")
REFERENCES "ResourceType"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;


ALTER TABLE "ServiceResourceType"
ADD CONSTRAINT "ServiceResourceType_serviceId_fkey"
FOREIGN KEY ("serviceId")
REFERENCES "Service"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;


ALTER TABLE "ServiceResourceType"
ADD CONSTRAINT "ServiceResourceType_resourceTypeId_fkey"
FOREIGN KEY ("resourceTypeId")
REFERENCES "ResourceType"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;


ALTER TABLE "ServiceRate"
ADD CONSTRAINT "ServiceRate_serviceId_fkey"
FOREIGN KEY ("serviceId")
REFERENCES "Service"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;


ALTER TABLE "Schedule"
ADD CONSTRAINT "Schedule_businessId_fkey"
FOREIGN KEY ("businessId")
REFERENCES "Business"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;


ALTER TABLE "AvailabilityRule"
ADD CONSTRAINT "AvailabilityRule_businessId_fkey"
FOREIGN KEY ("businessId")
REFERENCES "Business"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;


ALTER TABLE "Customer"
ADD CONSTRAINT "Customer_businessId_fkey"
FOREIGN KEY ("businessId")
REFERENCES "Business"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;


ALTER TABLE "Reservation"
ADD CONSTRAINT "Reservation_businessId_fkey"
FOREIGN KEY ("businessId")
REFERENCES "Business"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;


ALTER TABLE "ReservationService"
ADD CONSTRAINT "ReservationService_reservationId_fkey"
FOREIGN KEY ("reservationId")
REFERENCES "Reservation"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;


ALTER TABLE "ReservationService"
ADD CONSTRAINT "ReservationService_serviceId_fkey"
FOREIGN KEY ("serviceId")
REFERENCES "Service"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;


ALTER TABLE "ReservationResource"
ADD CONSTRAINT "ReservationResource_reservationId_fkey"
FOREIGN KEY ("reservationId")
REFERENCES "Reservation"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;


ALTER TABLE "ReservationResource"
ADD CONSTRAINT "ReservationResource_reservationServiceId_fkey"
FOREIGN KEY ("reservationServiceId")
REFERENCES "ReservationService"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;


ALTER TABLE "ReservationResource"
ADD CONSTRAINT "ReservationResource_resourceId_fkey"
FOREIGN KEY ("resourceId")
REFERENCES "Resource"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;


ALTER TABLE "Payment"
ADD CONSTRAINT "Payment_businessId_fkey"
FOREIGN KEY ("businessId")
REFERENCES "Business"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;


ALTER TABLE "Block"
ADD CONSTRAINT "Block_businessId_fkey"
FOREIGN KEY ("businessId")
REFERENCES "Business"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;


ALTER TABLE "Block"
ADD CONSTRAINT "Block_serviceId_fkey"
FOREIGN KEY ("serviceId")
REFERENCES "Service"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;


ALTER TABLE "Block"
ADD CONSTRAINT "Block_resourceTypeId_fkey"
FOREIGN KEY ("resourceTypeId")
REFERENCES "ResourceType"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;


ALTER TABLE "Block"
ADD CONSTRAINT "Block_resourceId_fkey"
FOREIGN KEY ("resourceId")
REFERENCES "Resource"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;


ALTER TABLE "User"
ADD CONSTRAINT "User_businessId_fkey"
FOREIGN KEY ("businessId")
REFERENCES "Business"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;