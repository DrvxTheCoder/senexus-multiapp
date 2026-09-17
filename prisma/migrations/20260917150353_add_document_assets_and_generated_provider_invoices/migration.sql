-- CreateEnum
CREATE TYPE "IpmInvoiceOrigin" AS ENUM ('RECEIVED', 'GENERATED');

-- AlterTable
ALTER TABLE "firms" ADD COLUMN     "letterhead" TEXT,
ADD COLUMN     "stamp" TEXT;

-- AlterTable
ALTER TABLE "ipm_provider_invoices" ADD COLUMN     "origin" "IpmInvoiceOrigin" NOT NULL DEFAULT 'RECEIVED';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "signatureUrl" TEXT;

-- CreateTable
CREATE TABLE "ipm_provider_invoice_lines" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "voucherId" TEXT,
    "voucherNumber" TEXT NOT NULL,
    "serviceDate" TIMESTAMP(3) NOT NULL,
    "beneficiaryName" TEXT NOT NULL,
    "memberMatricule" TEXT NOT NULL,
    "categoryLabel" TEXT NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "insurerShare" DECIMAL(12,2) NOT NULL,
    "memberShare" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ipm_provider_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ipm_provider_invoice_lines_firmId_invoiceId_idx" ON "ipm_provider_invoice_lines"("firmId", "invoiceId");

-- AddForeignKey
ALTER TABLE "ipm_provider_invoice_lines" ADD CONSTRAINT "ipm_provider_invoice_lines_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_provider_invoice_lines" ADD CONSTRAINT "ipm_provider_invoice_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "ipm_provider_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_provider_invoice_lines" ADD CONSTRAINT "ipm_provider_invoice_lines_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "ipm_vouchers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
