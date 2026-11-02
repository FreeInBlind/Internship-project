CREATE TABLE "public"."AiConfig" (
    "userId" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiConfig_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "public"."AiConfig"
    ADD CONSTRAINT "AiConfig_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "public"."User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
