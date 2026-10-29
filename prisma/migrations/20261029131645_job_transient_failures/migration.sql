-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_JobRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bullmqJobId" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "transientFailures" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    "requestFingerprint" TEXT,
    "createdBy" TEXT NOT NULL DEFAULT 'LOCAL_USER'
);
INSERT INTO "new_JobRecord" ("attempts", "bullmqJobId", "completedAt", "createdAt", "createdBy", "entityId", "entityType", "errorCode", "errorMessage", "id", "jobType", "progress", "requestFingerprint", "startedAt", "status", "updatedAt") SELECT "attempts", "bullmqJobId", "completedAt", "createdAt", "createdBy", "entityId", "entityType", "errorCode", "errorMessage", "id", "jobType", "progress", "requestFingerprint", "startedAt", "status", "updatedAt" FROM "JobRecord";
DROP TABLE "JobRecord";
ALTER TABLE "new_JobRecord" RENAME TO "JobRecord";
CREATE UNIQUE INDEX "JobRecord_bullmqJobId_key" ON "JobRecord"("bullmqJobId");
CREATE INDEX "JobRecord_status_idx" ON "JobRecord"("status");
CREATE INDEX "JobRecord_createdAt_idx" ON "JobRecord"("createdAt");
CREATE INDEX "JobRecord_entityType_entityId_idx" ON "JobRecord"("entityType", "entityId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
