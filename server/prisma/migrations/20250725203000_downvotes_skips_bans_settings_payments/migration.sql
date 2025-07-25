-- AlterTable
ALTER TABLE "Space" ADD COLUMN     "maxQueue" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "queueLocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "voteLimit" INTEGER NOT NULL DEFAULT 5;

-- AlterTable
ALTER TABLE "Vote" ADD COLUMN     "value" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "SkipVote" (
    "queueItemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkipVote_pkey" PRIMARY KEY ("queueItemId","userId")
);

-- CreateTable
CREATE TABLE "SpaceBan" (
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpaceBan_pkey" PRIMARY KEY ("spaceId","userId")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Payment_createdAt_idx" ON "Payment"("createdAt");

-- CreateIndex
CREATE INDEX "Refund_createdAt_idx" ON "Refund"("createdAt");

-- CreateIndex
CREATE INDEX "QueueItem_spaceId_playedAt_idx" ON "QueueItem"("spaceId", "playedAt");

-- AddForeignKey
ALTER TABLE "SkipVote" ADD CONSTRAINT "SkipVote_queueItemId_fkey" FOREIGN KEY ("queueItemId") REFERENCES "QueueItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkipVote" ADD CONSTRAINT "SkipVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaceBan" ADD CONSTRAINT "SpaceBan_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaceBan" ADD CONSTRAINT "SpaceBan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

