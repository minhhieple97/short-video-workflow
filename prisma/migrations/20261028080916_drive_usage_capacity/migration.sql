-- CreateTable
CREATE TABLE "DriveUsageHour" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "hourStart" DATETIME NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "bytesSent" BIGINT NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "DriveCapacity" (
    "destinationKey" TEXT NOT NULL PRIMARY KEY,
    "limitBytes" BIGINT,
    "usageBytes" BIGINT NOT NULL,
    "fetchedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "DriveUsageHour_provider_hourStart_key" ON "DriveUsageHour"("provider", "hourStart");
