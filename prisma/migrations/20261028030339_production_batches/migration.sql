-- CreateTable
CREATE TABLE "ProductionBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "targetDurationSec" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    CONSTRAINT "ProductionBatch_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductionItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "videoId" TEXT,
    "status" TEXT NOT NULL,
    "checkpoint" TEXT NOT NULL DEFAULT 'NONE',
    "claimToken" TEXT,
    "claimExpiresAt" DATETIME,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    CONSTRAINT "ProductionItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductionBatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductionItem_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProductionItem_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductionBatch_idempotencyKey_key" ON "ProductionBatch"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ProductionBatch_bookId_idx" ON "ProductionBatch"("bookId");

-- CreateIndex
CREATE INDEX "ProductionBatch_status_idx" ON "ProductionBatch"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionItem_videoId_key" ON "ProductionItem"("videoId");

-- CreateIndex
CREATE INDEX "ProductionItem_status_idx" ON "ProductionItem"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionItem_batchId_lessonId_key" ON "ProductionItem"("batchId", "lessonId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionItem_batchId_position_key" ON "ProductionItem"("batchId", "position");
