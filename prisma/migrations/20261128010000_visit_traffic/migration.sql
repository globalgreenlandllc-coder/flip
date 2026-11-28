-- AlterTable
ALTER TABLE "Visit" ADD COLUMN     "adClick" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "browser" TEXT,
ADD COLUMN     "clickFrom" TEXT,
ADD COLUMN     "device" TEXT,
ADD COLUMN     "signedIn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "userId" TEXT,
ADD COLUMN     "utmCampaign" TEXT,
ADD COLUMN     "utmContent" TEXT,
ADD COLUMN     "utmMedium" TEXT,
ADD COLUMN     "utmSource" TEXT;

-- CreateIndex
CREATE INDEX "Visit_userId_idx" ON "Visit"("userId");

