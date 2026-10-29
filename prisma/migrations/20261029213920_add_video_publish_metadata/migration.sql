-- CreateTable
CREATE TABLE "VideoPublishMetadata" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "videoId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "caption" TEXT NOT NULL,
    "hashtagsJson" JSONB NOT NULL,
    "origin" TEXT NOT NULL,
    "promptVersion" TEXT,
    "sourceTextHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VideoPublishMetadata_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "VideoPublishMetadata_videoId_key" ON "VideoPublishMetadata"("videoId");
