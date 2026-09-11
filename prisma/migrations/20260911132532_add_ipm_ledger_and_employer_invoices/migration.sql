-- CreateEnum
CREATE TYPE "IpmLedgerType" AS ENUM ('OPENING', 'CONTRIBUTION', 'CONSUMPTION', 'ADJUSTMENT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "IpmLedgerSource" AS ENUM ('OPENING', 'INVOICE', 'VOUCHER', 'REIMBURSEMENT', 'MANUAL');

-- CreateEnum
CREATE TYPE "IpmEmployerInvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED');

-- AlterTable
ALTER TABLE "ipm_service_categories" ADD COLUMN     "balanceAsOf" TIMESTAMP(3),
ADD COLUMN     "currentBalance" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ipm_ledger_entries" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "periodYear" INTEGER NOT NULL,
    "periodMonth" INTEGER NOT NULL,
    "type" "IpmLedgerType" NOT NULL,
    "sourceType" "IpmLedgerSource" NOT NULL,
    "sourceId" TEXT,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "balanceAfter" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "ipmServiceCategoryId" TEXT,

    CONSTRAINT "ipm_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ipm_employer_invoices" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "employerId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "periodYear" INTEGER NOT NULL,
    "periodMonth" INTEGER NOT NULL,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "memberCount" INTEGER NOT NULL,
    "employerShare" DECIMAL(14,2) NOT NULL,
    "employeeShare" DECIMAL(14,2) NOT NULL,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "status" "IpmEmployerInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paidAt" TIMESTAMP(3),
    "paymentMethod" TEXT,
    "paymentReference" TEXT,
    "statusChangedById" TEXT,
    "statusChangedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ipm_employer_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ipm_employer_invoice_lines" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "matricule" TEXT NOT NULL,
    "memberName" TEXT NOT NULL,
    "monthlyContribution" DECIMAL(12,2) NOT NULL,
    "employerShare" DECIMAL(12,2) NOT NULL,
    "employeeShare" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipmServiceCategoryId" TEXT,

    CONSTRAINT "ipm_employer_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ipm_ledger_entries_firmId_memberId_createdAt_idx" ON "ipm_ledger_entries"("firmId", "memberId", "createdAt");

-- CreateIndex
CREATE INDEX "ipm_ledger_entries_firmId_periodYear_periodMonth_idx" ON "ipm_ledger_entries"("firmId", "periodYear", "periodMonth");

-- CreateIndex
CREATE INDEX "ipm_employer_invoices_firmId_status_periodYear_idx" ON "ipm_employer_invoices"("firmId", "status", "periodYear");

-- CreateIndex
CREATE UNIQUE INDEX "ipm_employer_invoices_employerId_periodYear_periodMonth_key" ON "ipm_employer_invoices"("employerId", "periodYear", "periodMonth");

-- CreateIndex
CREATE UNIQUE INDEX "ipm_employer_invoices_firmId_number_key" ON "ipm_employer_invoices"("firmId", "number");

-- CreateIndex
CREATE INDEX "ipm_employer_invoice_lines_firmId_invoiceId_idx" ON "ipm_employer_invoice_lines"("firmId", "invoiceId");

-- AddForeignKey
ALTER TABLE "ipm_ledger_entries" ADD CONSTRAINT "ipm_ledger_entries_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_ledger_entries" ADD CONSTRAINT "ipm_ledger_entries_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "ipm_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_ledger_entries" ADD CONSTRAINT "ipm_ledger_entries_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_ledger_entries" ADD CONSTRAINT "ipm_ledger_entries_ipmServiceCategoryId_fkey" FOREIGN KEY ("ipmServiceCategoryId") REFERENCES "ipm_service_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_employer_invoices" ADD CONSTRAINT "ipm_employer_invoices_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_employer_invoices" ADD CONSTRAINT "ipm_employer_invoices_employerId_fkey" FOREIGN KEY ("employerId") REFERENCES "ipm_employers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_employer_invoices" ADD CONSTRAINT "ipm_employer_invoices_statusChangedById_fkey" FOREIGN KEY ("statusChangedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_employer_invoice_lines" ADD CONSTRAINT "ipm_employer_invoice_lines_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_employer_invoice_lines" ADD CONSTRAINT "ipm_employer_invoice_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "ipm_employer_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_employer_invoice_lines" ADD CONSTRAINT "ipm_employer_invoice_lines_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "ipm_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_employer_invoice_lines" ADD CONSTRAINT "ipm_employer_invoice_lines_ipmServiceCategoryId_fkey" FOREIGN KEY ("ipmServiceCategoryId") REFERENCES "ipm_service_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
