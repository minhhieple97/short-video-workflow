-- CreateTable
CREATE TABLE "NotificationTopic" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatId" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "messageThreadId" INTEGER,
    "leaseToken" TEXT,
    "leaseExpiresAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_NotificationDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "useTopics" BOOLEAN NOT NULL DEFAULT false,
    "bookId" TEXT,
    "bookTitle" TEXT,
    "messageThreadId" INTEGER,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" TEXT,
    "leaseExpiresAt" DATETIME,
    "lastError" TEXT,
    "messageId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "sentAt" DATETIME
);
INSERT INTO "new_NotificationDelivery" ("attempts", "availableAt", "chatId", "createdAt", "eventKey", "id", "kind", "lastError", "leaseExpiresAt", "leaseToken", "messageId", "sentAt", "status", "text", "updatedAt") SELECT "attempts", "availableAt", "chatId", "createdAt", "eventKey", "id", "kind", "lastError", "leaseExpiresAt", "leaseToken", "messageId", "sentAt", "status", "text", "updatedAt" FROM "NotificationDelivery";
DROP TABLE "NotificationDelivery";
ALTER TABLE "new_NotificationDelivery" RENAME TO "NotificationDelivery";
CREATE UNIQUE INDEX "NotificationDelivery_eventKey_key" ON "NotificationDelivery"("eventKey");
CREATE INDEX "NotificationDelivery_status_availableAt_idx" ON "NotificationDelivery"("status", "availableAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "NotificationTopic_chatId_scopeKey_key" ON "NotificationTopic"("chatId", "scopeKey");
