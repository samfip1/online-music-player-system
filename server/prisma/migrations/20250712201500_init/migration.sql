-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "spotifyId" TEXT,
    "isGuest" BOOLEAN NOT NULL DEFAULT false,
    "email" TEXT,
    "displayName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "paidUntil" TIMESTAMP(3),
    "spotifyRefreshToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Space" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "currentItemId" TEXT,
    "currentStartedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Space_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueueItem" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "addedById" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "trackUri" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "artists" TEXT[],
    "albumArtUrl" TEXT,
    "durationMs" INTEGER NOT NULL,
    "played" BOOLEAN NOT NULL DEFAULT false,
    "playedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QueueItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vote" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "queueItemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoteQuota" (
    "userId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "votesUsed" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),

    CONSTRAINT "VoteQuota_pkey" PRIMARY KEY ("userId","spaceId")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_spotifyId_key" ON "User"("spotifyId");

-- CreateIndex
CREATE UNIQUE INDEX "Space_currentItemId_key" ON "Space"("currentItemId");

-- CreateIndex
CREATE INDEX "Space_hostId_idx" ON "Space"("hostId");

-- CreateIndex
CREATE INDEX "QueueItem_spaceId_played_idx" ON "QueueItem"("spaceId", "played");

-- CreateIndex
CREATE INDEX "Vote_queueItemId_idx" ON "Vote"("queueItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Vote_userId_queueItemId_key" ON "Vote"("userId", "queueItemId");

-- CreateIndex
CREATE INDEX "VoteQuota_spaceId_idx" ON "VoteQuota"("spaceId");

-- AddForeignKey
ALTER TABLE "Space" ADD CONSTRAINT "Space_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Space" ADD CONSTRAINT "Space_currentItemId_fkey" FOREIGN KEY ("currentItemId") REFERENCES "QueueItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueItem" ADD CONSTRAINT "QueueItem_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueItem" ADD CONSTRAINT "QueueItem_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_queueItemId_fkey" FOREIGN KEY ("queueItemId") REFERENCES "QueueItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteQuota" ADD CONSTRAINT "VoteQuota_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteQuota" ADD CONSTRAINT "VoteQuota_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
