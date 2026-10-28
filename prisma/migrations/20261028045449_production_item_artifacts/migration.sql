-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ProductionItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "videoId" TEXT,
    "status" TEXT NOT NULL,
    "checkpoint" TEXT NOT NULL DEFAULT 'NONE',
    "appliedPlanFingerprint" TEXT,
    "aiCorrectionTarget" TEXT,
    "aiCorrectionNote" TEXT,
    "draftArtifactJson" JSONB,
    "scenePlanArtifactJson" JSONB,
    "transientRetries" INTEGER NOT NULL DEFAULT 0,
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
INSERT INTO "new_ProductionItem" ("aiCorrectionNote", "aiCorrectionTarget", "appliedPlanFingerprint", "batchId", "checkpoint", "claimExpiresAt", "claimToken", "completedAt", "createdAt", "errorCode", "errorMessage", "id", "lessonId", "position", "status", "updatedAt", "videoId") SELECT "aiCorrectionNote", "aiCorrectionTarget", "appliedPlanFingerprint", "batchId", "checkpoint", "claimExpiresAt", "claimToken", "completedAt", "createdAt", "errorCode", "errorMessage", "id", "lessonId", "position", "status", "updatedAt", "videoId" FROM "ProductionItem";
DROP TABLE "ProductionItem";
ALTER TABLE "new_ProductionItem" RENAME TO "ProductionItem";
CREATE UNIQUE INDEX "ProductionItem_videoId_key" ON "ProductionItem"("videoId");
CREATE INDEX "ProductionItem_status_idx" ON "ProductionItem"("status");
CREATE UNIQUE INDEX "ProductionItem_batchId_lessonId_key" ON "ProductionItem"("batchId", "lessonId");
CREATE UNIQUE INDEX "ProductionItem_batchId_position_key" ON "ProductionItem"("batchId", "position");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
