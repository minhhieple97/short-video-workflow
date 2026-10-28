-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_RenderArchive" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "renderId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "destinationKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "remoteFolderId" TEXT,
    "retries" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    CONSTRAINT "RenderArchive_renderId_fkey" FOREIGN KEY ("renderId") REFERENCES "RenderRecord" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_RenderArchive" ("completedAt", "createdAt", "destinationKey", "errorCode", "errorMessage", "id", "provider", "remoteFolderId", "renderId", "status", "updatedAt") SELECT "completedAt", "createdAt", "destinationKey", "errorCode", "errorMessage", "id", "provider", "remoteFolderId", "renderId", "status", "updatedAt" FROM "RenderArchive";
DROP TABLE "RenderArchive";
ALTER TABLE "new_RenderArchive" RENAME TO "RenderArchive";
CREATE INDEX "RenderArchive_status_idx" ON "RenderArchive"("status");
CREATE UNIQUE INDEX "RenderArchive_renderId_provider_destinationKey_key" ON "RenderArchive"("renderId", "provider", "destinationKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
