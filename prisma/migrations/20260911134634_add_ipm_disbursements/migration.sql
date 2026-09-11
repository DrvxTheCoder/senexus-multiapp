-- CreateEnum
CREATE TYPE "IpmProviderInvoiceStatus" AS ENUM ('RECEIVED', 'CHECKED', 'APPROVED', 'PAID', 'REJECTED');

-- CreateEnum
CREATE TYPE "IpmReimbursementStatus" AS ENUM ('SUBMITTED', 'REVIEWING', 'APPROVED', 'REJECTED', 'PAID');

-- CreateEnum
CREATE TYPE "IpmDisbursementStatus" AS ENUM ('DRAFT', 'APPROVED', 'POSTED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "IpmPayeeType" AS ENUM ('PROVIDER', 'MEMBER', 'SUPPLIER');

-- CreateEnum
CREATE TYPE "IpmPaymentMethod" AS ENUM ('CHEQUE', 'TRANSFER', 'CASH', 'ORANGE_MONEY');

-- CreateTable
CREATE TABLE "ipm_provider_invoices" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "receivedDate" TIMESTAMP(3) NOT NULL,
    "periodFrom" TIMESTAMP(3) NOT NULL,
    "periodTo" TIMESTAMP(3) NOT NULL,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "matchedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "IpmProviderInvoiceStatus" NOT NULL DEFAULT 'RECEIVED',
    "checkedById" TEXT,
    "checkedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "disbursementId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ipm_provider_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ipm_reimbursements" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "dependentId" TEXT,
    "number" TEXT NOT NULL,
    "submittedDate" TIMESTAMP(3) NOT NULL,
    "categoryId" TEXT NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "insurerShare" DECIMAL(12,2) NOT NULL,
    "appliedRate" DECIMAL(5,4) NOT NULL,
    "status" "IpmReimbursementStatus" NOT NULL DEFAULT 'SUBMITTED',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "disbursementId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ipm_reimbursements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ipm_disbursements" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "journalCode" TEXT NOT NULL,
    "payeeType" "IpmPayeeType" NOT NULL,
    "payeeId" TEXT,
    "payeeName" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "motif" TEXT NOT NULL,
    "paymentMethod" "IpmPaymentMethod" NOT NULL,
    "paymentReference" TEXT,
    "enteredById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "accountingById" TEXT,
    "accountingAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "status" "IpmDisbursementStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ipm_disbursements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ipm_disbursement_lines" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "disbursementId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ipm_disbursement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ipm_provider_invoices_firmId_status_idx" ON "ipm_provider_invoices"("firmId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ipm_provider_invoices_firmId_providerId_number_key" ON "ipm_provider_invoices"("firmId", "providerId", "number");

-- CreateIndex
CREATE INDEX "ipm_reimbursements_firmId_status_idx" ON "ipm_reimbursements"("firmId", "status");

-- CreateIndex
CREATE INDEX "ipm_reimbursements_firmId_memberId_idx" ON "ipm_reimbursements"("firmId", "memberId");

-- CreateIndex
CREATE UNIQUE INDEX "ipm_reimbursements_firmId_number_key" ON "ipm_reimbursements"("firmId", "number");

-- CreateIndex
CREATE INDEX "ipm_disbursements_firmId_status_date_idx" ON "ipm_disbursements"("firmId", "status", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ipm_disbursements_firmId_number_key" ON "ipm_disbursements"("firmId", "number");

-- CreateIndex
CREATE INDEX "ipm_disbursement_lines_firmId_disbursementId_idx" ON "ipm_disbursement_lines"("firmId", "disbursementId");

-- AddForeignKey
ALTER TABLE "ipm_provider_invoices" ADD CONSTRAINT "ipm_provider_invoices_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_provider_invoices" ADD CONSTRAINT "ipm_provider_invoices_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ipm_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_provider_invoices" ADD CONSTRAINT "ipm_provider_invoices_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_provider_invoices" ADD CONSTRAINT "ipm_provider_invoices_disbursementId_fkey" FOREIGN KEY ("disbursementId") REFERENCES "ipm_disbursements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_reimbursements" ADD CONSTRAINT "ipm_reimbursements_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_reimbursements" ADD CONSTRAINT "ipm_reimbursements_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "ipm_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_reimbursements" ADD CONSTRAINT "ipm_reimbursements_dependentId_fkey" FOREIGN KEY ("dependentId") REFERENCES "ipm_dependents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_reimbursements" ADD CONSTRAINT "ipm_reimbursements_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ipm_service_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_reimbursements" ADD CONSTRAINT "ipm_reimbursements_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_reimbursements" ADD CONSTRAINT "ipm_reimbursements_disbursementId_fkey" FOREIGN KEY ("disbursementId") REFERENCES "ipm_disbursements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_disbursements" ADD CONSTRAINT "ipm_disbursements_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_disbursements" ADD CONSTRAINT "ipm_disbursements_enteredById_fkey" FOREIGN KEY ("enteredById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_disbursements" ADD CONSTRAINT "ipm_disbursements_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_disbursements" ADD CONSTRAINT "ipm_disbursements_accountingById_fkey" FOREIGN KEY ("accountingById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_disbursement_lines" ADD CONSTRAINT "ipm_disbursement_lines_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_disbursement_lines" ADD CONSTRAINT "ipm_disbursement_lines_disbursementId_fkey" FOREIGN KEY ("disbursementId") REFERENCES "ipm_disbursements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
