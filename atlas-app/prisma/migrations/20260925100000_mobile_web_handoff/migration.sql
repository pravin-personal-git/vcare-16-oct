-- MAALIK OS: one-time links that open the website signed in inside the app.

-- CreateTable
CREATE TABLE "MobileWebHandoff" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "storeId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MobileWebHandoff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MobileWebHandoff_codeHash_key" ON "MobileWebHandoff"("codeHash");

-- CreateIndex
CREATE INDEX "MobileWebHandoff_userId_idx" ON "MobileWebHandoff"("userId");

