-- CreateTable
CREATE TABLE "clips" (
    "id" TEXT NOT NULL,
    "timestamp" BIGINT NOT NULL,
    "videoDurationMs" INTEGER NOT NULL,
    "audioDurationMs" INTEGER,
    "driveVideoUrl" TEXT NOT NULL,
    "driveAudioUrl" TEXT,
    "syncStatus" TEXT NOT NULL DEFAULT 'synced',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clips_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "clips_createdAt_idx" ON "clips"("createdAt" DESC);
