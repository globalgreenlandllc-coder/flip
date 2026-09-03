-- CreateTable
CREATE TABLE "Deal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "title" TEXT NOT NULL,
    "source" TEXT,
    "askingPrice" REAL NOT NULL,
    "verdict" TEXT NOT NULL,
    "arv" REAL NOT NULL,
    "maxOffer" REAL NOT NULL,
    "profit" REAL NOT NULL,
    "payload" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "Deal_userId_createdAt_idx" ON "Deal"("userId", "createdAt");
