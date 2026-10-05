-- AlterTable
ALTER TABLE "ipm_portal_accounts" ADD COLUMN     "accessCodeExpiresAt" TIMESTAMP(3),
ADD COLUMN     "accessCodeHash" TEXT,
ADD COLUMN     "accessRequestedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ipm_portal_accounts_firmId_accessRequestedAt_idx" ON "ipm_portal_accounts"("firmId", "accessRequestedAt");
