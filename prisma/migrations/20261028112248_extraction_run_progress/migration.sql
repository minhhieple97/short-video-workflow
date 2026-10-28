-- AlterTable
ALTER TABLE "OcrOperation" ADD COLUMN "chunkPlanJson" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BookExtraction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "pageCount" INTEGER,
    "ocrProvider" TEXT,
    "ocrModel" TEXT,
    "costCeilingMicroUsd" INTEGER,
    "reservedCostMicroUsd" INTEGER NOT NULL DEFAULT 0,
    "actualCostMicroUsd" INTEGER NOT NULL DEFAULT 0,
    "canonicalPath" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "transientFailures" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    CONSTRAINT "BookExtraction_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_BookExtraction" ("actualCostMicroUsd", "bookId", "canonicalPath", "completedAt", "costCeilingMicroUsd", "createdAt", "errorCode", "errorMessage", "id", "ocrModel", "ocrProvider", "pageCount", "reservedCostMicroUsd", "sourceHash", "status", "updatedAt") SELECT "actualCostMicroUsd", "bookId", "canonicalPath", "completedAt", "costCeilingMicroUsd", "createdAt", "errorCode", "errorMessage", "id", "ocrModel", "ocrProvider", "pageCount", "reservedCostMicroUsd", "sourceHash", "status", "updatedAt" FROM "BookExtraction";
DROP TABLE "BookExtraction";
ALTER TABLE "new_BookExtraction" RENAME TO "BookExtraction";
CREATE INDEX "BookExtraction_bookId_idx" ON "BookExtraction"("bookId");
CREATE INDEX "BookExtraction_status_idx" ON "BookExtraction"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
