-- CreateEnum
CREATE TYPE "IpmVoucherAmountSource" AS ENUM ('PROVIDER', 'BACK_OFFICE');

-- CreateEnum
CREATE TYPE "IpmVoucherAmountChangeKind" AS ENUM ('VALIDATE', 'ADJUST', 'VOID');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "IpmReviewFlag" ADD VALUE 'AMOUNT_ABOVE_THRESHOLD';
ALTER TYPE "IpmReviewFlag" ADD VALUE 'CEILING_CAPPED';
ALTER TYPE "IpmReviewFlag" ADD VALUE 'PRESCRIPTION_REUSED';

-- AlterEnum
ALTER TYPE "IpmVoucherStatus" ADD VALUE 'AWAITING_AMOUNT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PortalNotificationKind" ADD VALUE 'VOUCHER_VALIDATED';
ALTER TYPE "PortalNotificationKind" ADD VALUE 'VOUCHER_ADJUSTED';
ALTER TYPE "PortalNotificationKind" ADD VALUE 'VOUCHER_VOIDED';

-- AlterTable
ALTER TABLE "ipm_portal_settings" ADD COLUMN     "pharmacyReviewThreshold" DECIMAL(12,2),
ADD COLUMN     "pharmacyValidationDays" INTEGER NOT NULL DEFAULT 7;

-- AlterTable
ALTER TABLE "ipm_vouchers" ADD COLUMN     "amountEnteredAt" TIMESTAMP(3),
ADD COLUMN     "amountSource" "IpmVoucherAmountSource",
ADD COLUMN     "deferredAmount" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "prescriptionHash" TEXT,
ADD COLUMN     "prescriptionUrl" TEXT,
ADD COLUMN     "validatedAt" TIMESTAMP(3),
ADD COLUMN     "validatedByProviderAccountId" TEXT,
ADD COLUMN     "validatedByUserId" TEXT,
ADD COLUMN     "validationKey" TEXT,
ALTER COLUMN "totalAmount" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ipm_voucher_amount_changes" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "kind" "IpmVoucherAmountChangeKind" NOT NULL,
    "previousAmount" DECIMAL(12,2),
    "newAmount" DECIMAL(12,2),
    "previousInsurerShare" DECIMAL(12,2),
    "newInsurerShare" DECIMAL(12,2),
    "providerAccountId" TEXT,
    "userId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ipm_voucher_amount_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ipm_provider_accounts" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "passwordChangedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ipm_provider_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ipm_provider_sessions" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ipm_provider_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ipm_voucher_amount_changes_firmId_voucherId_createdAt_idx" ON "ipm_voucher_amount_changes"("firmId", "voucherId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ipm_provider_accounts_providerId_key" ON "ipm_provider_accounts"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX "ipm_provider_accounts_username_key" ON "ipm_provider_accounts"("username");

-- CreateIndex
CREATE INDEX "ipm_provider_accounts_firmId_idx" ON "ipm_provider_accounts"("firmId");

-- CreateIndex
CREATE INDEX "ipm_provider_sessions_accountId_revokedAt_idx" ON "ipm_provider_sessions"("accountId", "revokedAt");

-- CreateIndex
CREATE INDEX "ipm_vouchers_firmId_qrToken_idx" ON "ipm_vouchers"("firmId", "qrToken");

-- CreateIndex
CREATE INDEX "ipm_vouchers_firmId_providerId_validatedAt_idx" ON "ipm_vouchers"("firmId", "providerId", "validatedAt");

-- CreateIndex
CREATE INDEX "ipm_vouchers_firmId_prescriptionHash_idx" ON "ipm_vouchers"("firmId", "prescriptionHash");

-- AddForeignKey
ALTER TABLE "ipm_vouchers" ADD CONSTRAINT "ipm_vouchers_validatedByProviderAccountId_fkey" FOREIGN KEY ("validatedByProviderAccountId") REFERENCES "ipm_provider_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_vouchers" ADD CONSTRAINT "ipm_vouchers_validatedByUserId_fkey" FOREIGN KEY ("validatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_voucher_amount_changes" ADD CONSTRAINT "ipm_voucher_amount_changes_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_voucher_amount_changes" ADD CONSTRAINT "ipm_voucher_amount_changes_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "ipm_vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_voucher_amount_changes" ADD CONSTRAINT "ipm_voucher_amount_changes_providerAccountId_fkey" FOREIGN KEY ("providerAccountId") REFERENCES "ipm_provider_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_voucher_amount_changes" ADD CONSTRAINT "ipm_voucher_amount_changes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_provider_accounts" ADD CONSTRAINT "ipm_provider_accounts_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_provider_accounts" ADD CONSTRAINT "ipm_provider_accounts_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ipm_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_provider_accounts" ADD CONSTRAINT "ipm_provider_accounts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_provider_sessions" ADD CONSTRAINT "ipm_provider_sessions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ipm_provider_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

