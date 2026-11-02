-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "normalizedEmail" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SavedReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "confirmedResumeText" TEXT NOT NULL,
    "jobTitle" TEXT NOT NULL,
    "optionalJd" TEXT,
    "education" TEXT NOT NULL,
    "salary" TEXT,
    "reportLanguage" TEXT NOT NULL,
    "editedMarkdown" TEXT NOT NULL,
    "reportJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_normalizedEmail_key" ON "public"."User"("normalizedEmail");

-- CreateIndex
CREATE INDEX "SavedReport_userId_expiresAt_idx" ON "public"."SavedReport"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "SavedReport_expiresAt_idx" ON "public"."SavedReport"("expiresAt");

-- AddForeignKey
ALTER TABLE "public"."SavedReport" ADD CONSTRAINT "SavedReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

