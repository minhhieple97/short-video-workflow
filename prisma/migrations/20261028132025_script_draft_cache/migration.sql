-- CreateTable
CREATE TABLE "ScriptDraftCache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cacheKey" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "draftVersion" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "draftJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "ScriptDraftCache_cacheKey_key" ON "ScriptDraftCache"("cacheKey");

-- CreateIndex
CREATE INDEX "ScriptDraftCache_lessonId_idx" ON "ScriptDraftCache"("lessonId");
