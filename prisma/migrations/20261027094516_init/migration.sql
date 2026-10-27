-- CreateTable
CREATE TABLE "Book" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "author" TEXT,
    "description" TEXT,
    "language" TEXT NOT NULL DEFAULT 'vi',
    "slug" TEXT,
    "sourceFilePath" TEXT NOT NULL,
    "sourceFileName" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "sourceFormat" TEXT NOT NULL,
    "sourceSizeBytes" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME
);

-- CreateTable
CREATE TABLE "Chapter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "contentPath" TEXT,
    "content" TEXT,
    "sourceStartOffset" INTEGER,
    "sourceEndOffset" INTEGER,
    "contentHash" TEXT NOT NULL,
    "analysisStatus" TEXT NOT NULL,
    "analyzedAt" DATETIME,
    "analysisPromptVersion" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Chapter_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Lesson" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "principle" TEXT NOT NULL,
    "realLifeScenario" TEXT NOT NULL,
    "commonMistake" TEXT NOT NULL,
    "betterApproach" TEXT NOT NULL,
    "actionableStep" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "contentHash" TEXT,
    "analysisPromptVersion" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Lesson_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LessonSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lessonId" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "sourceExcerpt" TEXT,
    "sourceLocator" TEXT,
    "confidence" REAL,
    CONSTRAINT "LessonSource_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LessonSource_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Video" (
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
    "scriptVersion" INTEGER NOT NULL DEFAULT 1,
    "approvedScriptVersion" INTEGER,
    "platformPreviewMode" TEXT,
    "latestRenderId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Video_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VideoLesson" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "videoId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "lessonSnapshotJson" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VideoLesson_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VideoLesson_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VideoScene" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "videoId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT,
    "narration" TEXT NOT NULL,
    "onScreenText" TEXT NOT NULL,
    "visualVariant" TEXT NOT NULL,
    "durationFrames" INTEGER,
    "estimatedSeconds" REAL,
    "hookVariant" TEXT,
    "audioAssetId" TEXT,
    "contentHash" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VideoScene_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "videoId" TEXT,
    "sceneId" TEXT,
    "kind" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "durationMs" INTEGER,
    "fileSizeBytes" INTEGER NOT NULL,
    "contentHash" TEXT,
    "provider" TEXT,
    "generationSettingsJson" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MediaAsset_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MediaAsset_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "VideoScene" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RenderRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "videoId" TEXT NOT NULL,
    "jobRecordId" TEXT,
    "scriptVersion" INTEGER NOT NULL,
    "outputPath" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "durationMs" INTEGER,
    "qualityPreset" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "fps" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "errorMessage" TEXT,
    CONSTRAINT "RenderRecord_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JobRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bullmqJobId" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    "requestFingerprint" TEXT,
    "createdBy" TEXT NOT NULL DEFAULT 'LOCAL_USER'
);

-- CreateTable
CREATE TABLE "AiRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobRecordId" TEXT,
    "mode" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "outputPath" TEXT,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "Book_slug_key" ON "Book"("slug");

-- CreateIndex
CREATE INDEX "Book_status_idx" ON "Book"("status");

-- CreateIndex
CREATE INDEX "Book_createdAt_idx" ON "Book"("createdAt");

-- CreateIndex
CREATE INDEX "Book_sourceHash_idx" ON "Book"("sourceHash");

-- CreateIndex
CREATE INDEX "Chapter_bookId_idx" ON "Chapter"("bookId");

-- CreateIndex
CREATE UNIQUE INDEX "Chapter_bookId_order_key" ON "Chapter"("bookId", "order");

-- CreateIndex
CREATE INDEX "Lesson_bookId_idx" ON "Lesson"("bookId");

-- CreateIndex
CREATE INDEX "Lesson_status_idx" ON "Lesson"("status");

-- CreateIndex
CREATE INDEX "LessonSource_lessonId_idx" ON "LessonSource"("lessonId");

-- CreateIndex
CREATE INDEX "LessonSource_chapterId_idx" ON "LessonSource"("chapterId");

-- CreateIndex
CREATE UNIQUE INDEX "LessonSource_lessonId_chapterId_sourceLocator_key" ON "LessonSource"("lessonId", "chapterId", "sourceLocator");

-- CreateIndex
CREATE INDEX "Video_bookId_idx" ON "Video"("bookId");

-- CreateIndex
CREATE INDEX "Video_status_idx" ON "Video"("status");

-- CreateIndex
CREATE INDEX "Video_createdAt_idx" ON "Video"("createdAt");

-- CreateIndex
CREATE INDEX "VideoLesson_lessonId_idx" ON "VideoLesson"("lessonId");

-- CreateIndex
CREATE UNIQUE INDEX "VideoLesson_videoId_lessonId_key" ON "VideoLesson"("videoId", "lessonId");

-- CreateIndex
CREATE UNIQUE INDEX "VideoLesson_videoId_position_key" ON "VideoLesson"("videoId", "position");

-- CreateIndex
CREATE INDEX "VideoScene_videoId_idx" ON "VideoScene"("videoId");

-- CreateIndex
CREATE UNIQUE INDEX "VideoScene_videoId_order_key" ON "VideoScene"("videoId", "order");

-- CreateIndex
CREATE INDEX "MediaAsset_videoId_idx" ON "MediaAsset"("videoId");

-- CreateIndex
CREATE INDEX "MediaAsset_sceneId_idx" ON "MediaAsset"("sceneId");

-- CreateIndex
CREATE INDEX "MediaAsset_kind_idx" ON "MediaAsset"("kind");

-- CreateIndex
CREATE INDEX "RenderRecord_videoId_idx" ON "RenderRecord"("videoId");

-- CreateIndex
CREATE INDEX "RenderRecord_status_idx" ON "RenderRecord"("status");

-- CreateIndex
CREATE INDEX "RenderRecord_createdAt_idx" ON "RenderRecord"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobRecord_bullmqJobId_key" ON "JobRecord"("bullmqJobId");

-- CreateIndex
CREATE INDEX "JobRecord_status_idx" ON "JobRecord"("status");

-- CreateIndex
CREATE INDEX "JobRecord_createdAt_idx" ON "JobRecord"("createdAt");

-- CreateIndex
CREATE INDEX "JobRecord_entityType_entityId_idx" ON "JobRecord"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AiRun_jobRecordId_idx" ON "AiRun"("jobRecordId");

-- CreateIndex
CREATE INDEX "AiRun_status_idx" ON "AiRun"("status");
