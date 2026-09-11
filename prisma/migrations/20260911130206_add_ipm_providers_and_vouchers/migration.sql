-- CreateEnum
CREATE TYPE "IpmProviderStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "IpmAgreementStatus" AS ENUM ('DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "IpmVoucherType" AS ENUM ('PHARMACY', 'OPTICAL', 'GUARANTEE', 'HOSPITALIZATION');

-- CreateEnum
CREATE TYPE "IpmVoucherStatus" AS ENUM ('ISSUED', 'PRESENTED', 'SETTLED', 'INVOICED', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "ipm_providers" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "organizationId" TEXT,
    "legacyCode" TEXT,
    "name" TEXT NOT NULL,
    "specialtyId" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "accountCode" TEXT,
    "accredited" BOOLEAN NOT NULL DEFAULT false,
    "status" "IpmProviderStatus" NOT NULL DEFAULT 'ACTIVE',
    "paymentTermDays" INTEGER NOT NULL DEFAULT 60,
    "bankName" TEXT,
    "bankAccount" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ipm_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ipm_provider_branches" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ipm_provider_branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ipm_agreements" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "negotiatedRate" DECIMAL(5,4),
    "terms" TEXT,
    "status" "IpmAgreementStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ipm_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ipm_vouchers" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "type" "IpmVoucherType" NOT NULL,
    "memberId" TEXT NOT NULL,
    "dependentId" TEXT,
    "beneficiaryType" "IpmBeneficiaryType" NOT NULL,
    "beneficiaryName" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "serviceTypeId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "expiryDate" TIMESTAMP(3) NOT NULL,
    "status" "IpmVoucherStatus" NOT NULL DEFAULT 'ISSUED',
    "totalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "insurerShare" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "memberShare" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "appliedRate" DECIMAL(5,4) NOT NULL,
    "rateSource" TEXT NOT NULL,
    "qrToken" TEXT NOT NULL,
    "issuedById" TEXT,
    "settledAt" TIMESTAMP(3),
    "settledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "providerInvoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ipm_vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ipm_voucher_lines" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "medicalActId" TEXT,
    "label" TEXT NOT NULL,
    "quantity" DECIMAL(8,2) NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ipm_voucher_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ipm_consumptions" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "beneficiaryRef" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "periodYear" INTEGER NOT NULL,
    "periodMonth" INTEGER NOT NULL,
    "voucherId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "insurerShare" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ipm_consumptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ipm_sequences" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ipm_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ipm_providers_firmId_status_accredited_idx" ON "ipm_providers"("firmId", "status", "accredited");

-- CreateIndex
CREATE INDEX "ipm_providers_firmId_name_idx" ON "ipm_providers"("firmId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ipm_providers_firmId_legacyCode_key" ON "ipm_providers"("firmId", "legacyCode");

-- CreateIndex
CREATE INDEX "ipm_provider_branches_firmId_providerId_idx" ON "ipm_provider_branches"("firmId", "providerId");

-- CreateIndex
CREATE INDEX "ipm_agreements_firmId_providerId_status_idx" ON "ipm_agreements"("firmId", "providerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ipm_agreements_firmId_reference_key" ON "ipm_agreements"("firmId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "ipm_vouchers_qrToken_key" ON "ipm_vouchers"("qrToken");

-- CreateIndex
CREATE INDEX "ipm_vouchers_firmId_status_issueDate_idx" ON "ipm_vouchers"("firmId", "status", "issueDate");

-- CreateIndex
CREATE INDEX "ipm_vouchers_firmId_memberId_idx" ON "ipm_vouchers"("firmId", "memberId");

-- CreateIndex
CREATE INDEX "ipm_vouchers_firmId_providerId_status_idx" ON "ipm_vouchers"("firmId", "providerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ipm_vouchers_firmId_number_key" ON "ipm_vouchers"("firmId", "number");

-- CreateIndex
CREATE INDEX "ipm_voucher_lines_firmId_voucherId_idx" ON "ipm_voucher_lines"("firmId", "voucherId");

-- CreateIndex
CREATE INDEX "ipm_consumptions_firmId_beneficiaryRef_categoryId_periodYea_idx" ON "ipm_consumptions"("firmId", "beneficiaryRef", "categoryId", "periodYear");

-- CreateIndex
CREATE INDEX "ipm_consumptions_firmId_memberId_periodYear_periodMonth_idx" ON "ipm_consumptions"("firmId", "memberId", "periodYear", "periodMonth");

-- CreateIndex
CREATE UNIQUE INDEX "ipm_sequences_firmId_kind_year_key" ON "ipm_sequences"("firmId", "kind", "year");

-- AddForeignKey
ALTER TABLE "ipm_providers" ADD CONSTRAINT "ipm_providers_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_providers" ADD CONSTRAINT "ipm_providers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_providers" ADD CONSTRAINT "ipm_providers_specialtyId_fkey" FOREIGN KEY ("specialtyId") REFERENCES "ipm_provider_specialties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_provider_branches" ADD CONSTRAINT "ipm_provider_branches_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_provider_branches" ADD CONSTRAINT "ipm_provider_branches_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ipm_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_agreements" ADD CONSTRAINT "ipm_agreements_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_agreements" ADD CONSTRAINT "ipm_agreements_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ipm_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_vouchers" ADD CONSTRAINT "ipm_vouchers_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_vouchers" ADD CONSTRAINT "ipm_vouchers_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "ipm_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_vouchers" ADD CONSTRAINT "ipm_vouchers_dependentId_fkey" FOREIGN KEY ("dependentId") REFERENCES "ipm_dependents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_vouchers" ADD CONSTRAINT "ipm_vouchers_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ipm_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_vouchers" ADD CONSTRAINT "ipm_vouchers_serviceTypeId_fkey" FOREIGN KEY ("serviceTypeId") REFERENCES "ipm_service_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_vouchers" ADD CONSTRAINT "ipm_vouchers_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ipm_service_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_vouchers" ADD CONSTRAINT "ipm_vouchers_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_vouchers" ADD CONSTRAINT "ipm_vouchers_settledById_fkey" FOREIGN KEY ("settledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_voucher_lines" ADD CONSTRAINT "ipm_voucher_lines_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_voucher_lines" ADD CONSTRAINT "ipm_voucher_lines_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "ipm_vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_voucher_lines" ADD CONSTRAINT "ipm_voucher_lines_medicalActId_fkey" FOREIGN KEY ("medicalActId") REFERENCES "ipm_medical_acts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_consumptions" ADD CONSTRAINT "ipm_consumptions_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_consumptions" ADD CONSTRAINT "ipm_consumptions_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "ipm_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_consumptions" ADD CONSTRAINT "ipm_consumptions_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ipm_service_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_consumptions" ADD CONSTRAINT "ipm_consumptions_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "ipm_vouchers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_sequences" ADD CONSTRAINT "ipm_sequences_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
