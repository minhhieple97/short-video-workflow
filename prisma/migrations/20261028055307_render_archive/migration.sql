-- CreateTable
CREATE TABLE "RenderArchive" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "renderId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "destinationKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "remoteFolderId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    CONSTRAINT "RenderArchive_renderId_fkey" FOREIGN KEY ("renderId") REFERENCES "RenderRecord" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RenderArchiveFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "archiveId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "remoteName" TEXT NOT NULL,
    "remoteFileId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "localPath" TEXT,
    "bytes" INTEGER,
    "sha256" TEXT,
    "checkpointToken" TEXT,
    "checkpointBytes" INTEGER NOT NULL DEFAULT 0,
    "verifiedAt" DATETIME,
    CONSTRAINT "RenderArchiveFile_archiveId_fkey" FOREIGN KEY ("archiveId") REFERENCES "RenderArchive" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "RenderArchive_status_idx" ON "RenderArchive"("status");

-- CreateIndex
CREATE UNIQUE INDEX "RenderArchive_renderId_provider_destinationKey_key" ON "RenderArchive"("renderId", "provider", "destinationKey");

-- CreateIndex
CREATE UNIQUE INDEX "RenderArchiveFile_archiveId_kind_key" ON "RenderArchiveFile"("archiveId", "kind");
