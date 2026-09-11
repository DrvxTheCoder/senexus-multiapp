-- AlterTable
ALTER TABLE "ipm_members" ADD COLUMN     "balanceAsOf" TIMESTAMP(3),
ADD COLUMN     "currentBalance" DECIMAL(14,2) NOT NULL DEFAULT 0;
