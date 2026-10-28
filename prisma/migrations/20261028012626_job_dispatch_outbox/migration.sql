-- CreateTable
CREATE TABLE "JobDispatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobRecordId" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "availableAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatchedAt" DATETIME,
    CONSTRAINT "JobDispatch_jobRecordId_fkey" FOREIGN KEY ("jobRecordId") REFERENCES "JobRecord" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "JobDispatch_jobRecordId_key" ON "JobDispatch"("jobRecordId");

-- CreateIndex
CREATE INDEX "JobDispatch_dispatchedAt_availableAt_idx" ON "JobDispatch"("dispatchedAt", "availableAt");
