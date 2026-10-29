-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ProductionBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookId" TEXT NOT NULL,
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
    CONSTRAINT "ProductionBatch_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ProductionBatch" ("bookId", "completedAt", "createdAt", "fingerprint", "id", "idempotencyKey", "maxDurationSec", "minDurationSec", "status", "targetDurationSec", "updatedAt") SELECT "bookId", "completedAt", "createdAt", "fingerprint", "id", "idempotencyKey", "maxDurationSec", "minDurationSec", "status", "targetDurationSec", "updatedAt" FROM "ProductionBatch";
DROP TABLE "ProductionBatch";
ALTER TABLE "new_ProductionBatch" RENAME TO "ProductionBatch";
CREATE UNIQUE INDEX "ProductionBatch_idempotencyKey_key" ON "ProductionBatch"("idempotencyKey");
CREATE INDEX "ProductionBatch_bookId_idx" ON "ProductionBatch"("bookId");
CREATE INDEX "ProductionBatch_status_idx" ON "ProductionBatch"("status");
CREATE TABLE "new_Video" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "aspectRatio" TEXT NOT NULL DEFAULT '9:16',
    "fps" INTEGER NOT NULL DEFAULT 30,
    "width" INTEGER NOT NULL DEFAULT 1080,
    "height" INTEGER NOT NULL DEFAULT 1920,
    "videoProfile" TEXT NOT NULL DEFAULT 'SHORT_VERTICAL',
    "targetDurationSec" INTEGER NOT NULL DEFAULT 60,
    "minDurationSec" INTEGER NOT NULL DEFAULT 30,
    "maxDurationSec" INTEGER NOT NULL DEFAULT 300,
    "pace" TEXT NOT NULL DEFAULT 'STANDARD',
    "durationReason" TEXT,
    "scriptVersion" INTEGER NOT NULL DEFAULT 1,
    "approvedScriptVersion" INTEGER,
    "autoReadyScriptVersion" INTEGER,
    "platformPreviewMode" TEXT,
    "hookOptionsJson" JSONB,
    "latestRenderId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Video_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Video" ("approvedScriptVersion", "aspectRatio", "autoReadyScriptVersion", "bookId", "createdAt", "description", "durationReason", "fps", "height", "hookOptionsJson", "id", "latestRenderId", "maxDurationSec", "minDurationSec", "platformPreviewMode", "scriptVersion", "status", "targetDurationSec", "title", "updatedAt", "videoProfile", "width") SELECT "approvedScriptVersion", "aspectRatio", "autoReadyScriptVersion", "bookId", "createdAt", "description", "durationReason", "fps", "height", "hookOptionsJson", "id", "latestRenderId", "maxDurationSec", "minDurationSec", "platformPreviewMode", "scriptVersion", "status", "targetDurationSec", "title", "updatedAt", "videoProfile", "width" FROM "Video";
DROP TABLE "Video";
ALTER TABLE "new_Video" RENAME TO "Video";
CREATE INDEX "Video_bookId_idx" ON "Video"("bookId");
CREATE INDEX "Video_status_idx" ON "Video"("status");
CREATE INDEX "Video_createdAt_idx" ON "Video"("createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
