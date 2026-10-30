-- CreateTable
CREATE TABLE "DriveStorageSnapshot" (
    "destinationKey" TEXT NOT NULL PRIMARY KEY,
    "limitBytes" BIGINT,
    "usageBytes" BIGINT NOT NULL,
    "usageInDriveBytes" BIGINT,
    "usageInDriveTrashBytes" BIGINT,
    "fetchedAt" DATETIME NOT NULL
);
