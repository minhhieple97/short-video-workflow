-- CreateTable
CREATE TABLE "OAuthAuthorization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "codeVerifier" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "consumedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "OAuthAuthorization_stateHash_key" ON "OAuthAuthorization"("stateHash");

-- CreateIndex
CREATE INDEX "OAuthAuthorization_expiresAt_idx" ON "OAuthAuthorization"("expiresAt");
