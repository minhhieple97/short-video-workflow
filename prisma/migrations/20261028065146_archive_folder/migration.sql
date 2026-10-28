-- CreateTable
CREATE TABLE "ArchiveFolder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "destinationKey" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "remoteId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "ArchiveFolder_provider_destinationKey_path_key" ON "ArchiveFolder"("provider", "destinationKey", "path");
