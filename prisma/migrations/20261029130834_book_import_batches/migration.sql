-- CreateTable
CREATE TABLE "BookImportBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "idempotencyKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UPLOADING',
    "minDurationSec" INTEGER NOT NULL,
    "maxDurationSec" INTEGER NOT NULL,
    "pace" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BookImportItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "bookId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UPLOADING',
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BookImportItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "BookImportBatch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BookImportItem_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProviderCooldown" (
    "provider" TEXT NOT NULL PRIMARY KEY,
    "blockedUntil" DATETIME NOT NULL,
    "errorCode" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ProductionBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookId" TEXT NOT NULL,
    "importItemId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "targetDurationSec" INTEGER NOT NULL,
    "minDurationSec" INTEGER NOT NULL DEFAULT 30,
    "maxDurationSec" INTEGER NOT NULL DEFAULT 300,
    "pace" TEXT NOT NULL DEFAULT 'STANDARD',
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    CONSTRAINT "ProductionBatch_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductionBatch_importItemId_fkey" FOREIGN KEY ("importItemId") REFERENCES "BookImportItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ProductionBatch" ("bookId", "completedAt", "createdAt", "fingerprint", "id", "idempotencyKey", "maxDurationSec", "minDurationSec", "pace", "status", "targetDurationSec", "updatedAt") SELECT "bookId", "completedAt", "createdAt", "fingerprint", "id", "idempotencyKey", "maxDurationSec", "minDurationSec", "pace", "status", "targetDurationSec", "updatedAt" FROM "ProductionBatch";
DROP TABLE "ProductionBatch";
ALTER TABLE "new_ProductionBatch" RENAME TO "ProductionBatch";
CREATE UNIQUE INDEX "ProductionBatch_idempotencyKey_key" ON "ProductionBatch"("idempotencyKey");
CREATE INDEX "ProductionBatch_bookId_idx" ON "ProductionBatch"("bookId");
CREATE INDEX "ProductionBatch_importItemId_idx" ON "ProductionBatch"("importItemId");
CREATE INDEX "ProductionBatch_status_idx" ON "ProductionBatch"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "BookImportBatch_idempotencyKey_key" ON "BookImportBatch"("idempotencyKey");

-- CreateIndex
CREATE INDEX "BookImportBatch_status_createdAt_idx" ON "BookImportBatch"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BookImportItem_bookId_key" ON "BookImportItem"("bookId");

-- CreateIndex
CREATE INDEX "BookImportItem_batchId_status_idx" ON "BookImportItem"("batchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BookImportItem_batchId_position_key" ON "BookImportItem"("batchId", "position");
