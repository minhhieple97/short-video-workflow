-- CreateTable
CREATE TABLE "BookExtraction" (
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    CONSTRAINT "BookExtraction_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExtractionPage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "extractionId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "method" TEXT,
    "ocrReason" TEXT,
    "text" TEXT,
    "confidence" REAL,
    "errorCode" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExtractionPage_extractionId_fkey" FOREIGN KEY ("extractionId") REFERENCES "BookExtraction" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OcrOperation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "extractionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "operationRef" TEXT,
    "pageCount" INTEGER NOT NULL,
    "reservedCostMicroUsd" INTEGER NOT NULL,
    "actualCostMicroUsd" INTEGER,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "submittedAt" DATETIME,
    "lastPolledAt" DATETIME,
    "completedAt" DATETIME,
    "outputStoredAt" DATETIME,
    "cleanedAt" DATETIME,
    CONSTRAINT "OcrOperation_extractionId_fkey" FOREIGN KEY ("extractionId") REFERENCES "BookExtraction" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "BookExtraction_bookId_idx" ON "BookExtraction"("bookId");

-- CreateIndex
CREATE INDEX "BookExtraction_status_idx" ON "BookExtraction"("status");

-- CreateIndex
CREATE INDEX "ExtractionPage_extractionId_status_idx" ON "ExtractionPage"("extractionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ExtractionPage_extractionId_pageNumber_key" ON "ExtractionPage"("extractionId", "pageNumber");

-- CreateIndex
CREATE UNIQUE INDEX "OcrOperation_requestKey_key" ON "OcrOperation"("requestKey");

-- CreateIndex
CREATE INDEX "OcrOperation_extractionId_idx" ON "OcrOperation"("extractionId");

-- CreateIndex
CREATE INDEX "OcrOperation_status_idx" ON "OcrOperation"("status");
