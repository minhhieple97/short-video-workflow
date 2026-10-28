-- CreateTable
CREATE TABLE "NotebookBinding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookId" TEXT NOT NULL,
    "profile" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "notebookId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "NotebookBinding_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NotebookSourceBinding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "notebookBindingId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "remoteSourceId" TEXT,
    "supersededAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" DATETIME,
    CONSTRAINT "NotebookSourceBinding_notebookBindingId_fkey" FOREIGN KEY ("notebookBindingId") REFERENCES "NotebookBinding" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "NotebookBinding_bookId_profile_key" ON "NotebookBinding"("bookId", "profile");

-- CreateIndex
CREATE INDEX "NotebookSourceBinding_notebookBindingId_sourceKey_idx" ON "NotebookSourceBinding"("notebookBindingId", "sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "NotebookSourceBinding_notebookBindingId_sourceKey_contentHash_key" ON "NotebookSourceBinding"("notebookBindingId", "sourceKey", "contentHash");
