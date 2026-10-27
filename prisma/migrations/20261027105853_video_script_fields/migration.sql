-- AlterTable
ALTER TABLE "Video" ADD COLUMN "hookOptionsJson" JSONB;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_VideoScene" (
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
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VideoScene_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_VideoScene" ("audioAssetId", "contentHash", "createdAt", "durationFrames", "estimatedSeconds", "hookVariant", "id", "narration", "onScreenText", "order", "title", "type", "updatedAt", "version", "videoId", "visualVariant") SELECT "audioAssetId", "contentHash", "createdAt", "durationFrames", "estimatedSeconds", "hookVariant", "id", "narration", "onScreenText", "order", "title", "type", "updatedAt", "version", "videoId", "visualVariant" FROM "VideoScene";
DROP TABLE "VideoScene";
ALTER TABLE "new_VideoScene" RENAME TO "VideoScene";
CREATE INDEX "VideoScene_videoId_idx" ON "VideoScene"("videoId");
CREATE UNIQUE INDEX "VideoScene_videoId_order_key" ON "VideoScene"("videoId", "order");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
