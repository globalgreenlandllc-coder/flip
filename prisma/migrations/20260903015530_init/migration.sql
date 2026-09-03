-- CreateTable
CREATE TABLE "Deal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "title" TEXT NOT NULL,
    "source" TEXT,
    "askingPrice" DOUBLE PRECISION NOT NULL,
    "verdict" TEXT NOT NULL,
    "arv" DOUBLE PRECISION NOT NULL,
    "maxOffer" DOUBLE PRECISION NOT NULL,
    "profit" DOUBLE PRECISION NOT NULL,
    "payload" TEXT NOT NULL,

    CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Deal_userId_createdAt_idx" ON "Deal"("userId", "createdAt");
