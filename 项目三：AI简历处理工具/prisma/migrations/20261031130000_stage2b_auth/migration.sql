CREATE TABLE "public"."AuthRateLimit" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "AuthRateLimit_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "AuthRateLimit_windowStart_idx" ON "public"."AuthRateLimit"("windowStart");
