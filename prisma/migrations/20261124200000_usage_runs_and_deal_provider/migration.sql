-- AlterTable
ALTER TABLE "Deal" ADD COLUMN     "provider" TEXT;

-- CreateTable
CREATE TABLE "UsageRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'started',
    "source" TEXT,
    "photos" INTEGER NOT NULL DEFAULT 0,
    "model" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "ms" INTEGER,

    CONSTRAINT "UsageRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UsageRun_userId_createdAt_idx" ON "UsageRun"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "UsageRun_kind_createdAt_idx" ON "UsageRun"("kind", "createdAt");

