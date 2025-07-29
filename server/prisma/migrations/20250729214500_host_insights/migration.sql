-- AlterTable
ALTER TABLE "QueueItem" ADD COLUMN     "reactions" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "skipReason" TEXT;

-- AlterTable
ALTER TABLE "Space" ADD COLUMN     "peakPeople" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "proPlan" TEXT;

-- CreateTable
CREATE TABLE "PresenceSample" (
    "id" SERIAL NOT NULL,
    "spaceId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "people" INTEGER NOT NULL,

    CONSTRAINT "PresenceSample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PresenceSample_spaceId_at_idx" ON "PresenceSample"("spaceId", "at");

-- AddForeignKey
ALTER TABLE "PresenceSample" ADD CONSTRAINT "PresenceSample_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

