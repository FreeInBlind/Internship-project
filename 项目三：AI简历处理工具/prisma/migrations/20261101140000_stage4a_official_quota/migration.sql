CREATE TABLE "public"."OfficialQuotaDay" (
  "dayKey" DATE NOT NULL,
  "reserved" INTEGER NOT NULL DEFAULT 0,
  "used" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OfficialQuotaDay_pkey" PRIMARY KEY ("dayKey"),
  CONSTRAINT "OfficialQuotaDay_nonnegative" CHECK ("reserved" >= 0 AND "used" >= 0),
  CONSTRAINT "OfficialQuotaDay_capacity" CHECK ("reserved" + "used" <= 5)
);

CREATE TABLE "public"."AnalysisAttempt" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "dayKey" DATE NOT NULL,
  "status" TEXT NOT NULL,
  "leaseToken" TEXT NOT NULL,
  "leaseExpiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AnalysisAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AnalysisAttempt_status" CHECK ("status" IN ('reserved', 'succeeded', 'failed', 'expired')),
  CONSTRAINT "AnalysisAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AnalysisAttempt_request_unique" UNIQUE ("userId", "requestId")
);

CREATE INDEX "AnalysisAttempt_lease_idx" ON "public"."AnalysisAttempt" ("status", "leaseExpiresAt");
CREATE INDEX "AnalysisAttempt_day_status_idx" ON "public"."AnalysisAttempt" ("dayKey", "status");
