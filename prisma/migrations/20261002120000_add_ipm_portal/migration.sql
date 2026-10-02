-- CreateEnum
CREATE TYPE "IpmVoucherOrigin" AS ENUM ('BACKOFFICE', 'PORTAL');

-- CreateEnum
CREATE TYPE "IpmVoucherEntryMode" AS ENUM ('SCAN', 'MANUAL');

-- CreateEnum
CREATE TYPE "IpmReviewFlag" AS ENUM ('ABOVE_THRESHOLD', 'AMOUNT_UNUSUAL', 'SAME_DAY_DUPLICATE', 'RECEIPT_REUSED', 'OCR_MISMATCH', 'ISSUANCE_WARNING');

-- CreateEnum
CREATE TYPE "PortalAccountStatus" AS ENUM ('INVITED', 'ACTIVE', 'LOCKED');

-- CreateEnum
CREATE TYPE "PortalNotificationKind" AS ENUM ('VOUCHER_APPROVED', 'VOUCHER_REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "IpmVoucherStatus" ADD VALUE 'PENDING_REVIEW';
ALTER TYPE "IpmVoucherStatus" ADD VALUE 'REJECTED';

-- AlterTable
ALTER TABLE "ipm_vouchers" ADD COLUMN     "clientRequestId" TEXT,
ADD COLUMN     "entryMode" "IpmVoucherEntryMode",
ADD COLUMN     "issuedByPortalAccountId" TEXT,
ADD COLUMN     "ocrTotal" DECIMAL(12,2),
ADD COLUMN     "origin" "IpmVoucherOrigin" NOT NULL DEFAULT 'BACKOFFICE',
ADD COLUMN     "receiptHash" TEXT,
ADD COLUMN     "receiptUrl" TEXT,
ADD COLUMN     "reviewFlags" "IpmReviewFlag"[],
ADD COLUMN     "reviewReason" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT;

-- CreateTable
CREATE TABLE "ipm_portal_accounts" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "status" "PortalAccountStatus" NOT NULL DEFAULT 'INVITED',
    "activatedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ipm_portal_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ipm_portal_settings" (
    "firmId" TEXT NOT NULL,
    "reviewThresholdAmount" DECIMAL(12,2) NOT NULL DEFAULT 100000,
    "reviewThresholdRatio" DECIMAL(5,4) NOT NULL DEFAULT 0.5,
    "unusualAmountMultiple" DECIMAL(5,2) NOT NULL DEFAULT 3,
    "ocrMismatchTolerance" DECIMAL(5,4) NOT NULL DEFAULT 0.15,

    CONSTRAINT "ipm_portal_settings_pkey" PRIMARY KEY ("firmId")
);

-- CreateTable
CREATE TABLE "ipm_portal_notifications" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "portalAccountId" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "kind" "PortalNotificationKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "ipm_portal_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ipm_portal_accounts_memberId_key" ON "ipm_portal_accounts"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "ipm_portal_accounts_firmId_phone_key" ON "ipm_portal_accounts"("firmId", "phone");

-- CreateIndex
CREATE INDEX "ipm_portal_notifications_portalAccountId_readAt_idx" ON "ipm_portal_notifications"("portalAccountId", "readAt");

-- CreateIndex
CREATE INDEX "ipm_vouchers_firmId_receiptHash_idx" ON "ipm_vouchers"("firmId", "receiptHash");

-- CreateIndex
CREATE INDEX "ipm_vouchers_firmId_origin_status_idx" ON "ipm_vouchers"("firmId", "origin", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ipm_vouchers_firmId_clientRequestId_key" ON "ipm_vouchers"("firmId", "clientRequestId");

-- AddForeignKey
ALTER TABLE "ipm_vouchers" ADD CONSTRAINT "ipm_vouchers_issuedByPortalAccountId_fkey" FOREIGN KEY ("issuedByPortalAccountId") REFERENCES "ipm_portal_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_vouchers" ADD CONSTRAINT "ipm_vouchers_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_portal_accounts" ADD CONSTRAINT "ipm_portal_accounts_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_portal_accounts" ADD CONSTRAINT "ipm_portal_accounts_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "ipm_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_portal_settings" ADD CONSTRAINT "ipm_portal_settings_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_portal_notifications" ADD CONSTRAINT "ipm_portal_notifications_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_portal_notifications" ADD CONSTRAINT "ipm_portal_notifications_portalAccountId_fkey" FOREIGN KEY ("portalAccountId") REFERENCES "ipm_portal_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_portal_notifications" ADD CONSTRAINT "ipm_portal_notifications_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "ipm_vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

