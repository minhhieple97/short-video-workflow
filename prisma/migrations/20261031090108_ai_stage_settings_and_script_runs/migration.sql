-- AlterTable
ALTER TABLE "AiRun" ADD COLUMN "executionJson" JSONB;
ALTER TABLE "AiRun" ADD COLUMN "stage" TEXT;
ALTER TABLE "AiRun" ADD COLUMN "taskId" TEXT;

-- AlterTable
ALTER TABLE "ProductionItem" ADD COLUMN "scriptGenerationRunId" TEXT;

-- AlterTable
ALTER TABLE "Video" ADD COLUMN "scriptGenerationRunId" TEXT;

-- CreateTable
CREATE TABLE "AiGenerationSetting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "settingsJson" JSONB NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ScriptGenerationRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerKey" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "baseScriptVersion" INTEGER NOT NULL,
    "settingsJson" JSONB NOT NULL,
    "inputJson" JSONB NOT NULL,
    "sourcePackJson" JSONB,
    "draftArtifactJson" JSONB,
    "scenePlanArtifactJson" JSONB,
    "castJson" JSONB,
    "appliedScriptVersion" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "ScriptGenerationRun_ownerKey_key" ON "ScriptGenerationRun"("ownerKey");

-- CreateIndex
CREATE INDEX "ScriptGenerationRun_videoId_idx" ON "ScriptGenerationRun"("videoId");
