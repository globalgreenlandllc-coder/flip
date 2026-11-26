-- CreateTable
CREATE TABLE "DataRequest" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "userId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'started',
    "httpStatus" INTEGER,
    "results" INTEGER,
    "ms" INTEGER,

    CONSTRAINT "DataRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataCache" (
    "key" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "payload" TEXT NOT NULL,

    CONSTRAINT "DataCache_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "DataRequest_provider_createdAt_idx" ON "DataRequest"("provider", "createdAt");

-- CreateIndex
CREATE INDEX "DataRequest_userId_createdAt_idx" ON "DataRequest"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "DataCache_expiresAt_idx" ON "DataCache"("expiresAt");
