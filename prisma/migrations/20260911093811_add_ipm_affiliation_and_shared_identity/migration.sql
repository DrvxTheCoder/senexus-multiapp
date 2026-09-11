-- CreateEnum
CREATE TYPE "IpmBeneficiaryType" AS ENUM ('ALL', 'MEMBER', 'SPOUSE_F', 'CHILD', 'SPOUSE_M', 'ASCENDANT', 'OTHER');

-- CreateEnum
CREATE TYPE "IpmEmployerStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "IpmMemberStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "IpmDependentStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "IpmDependentRelation" AS ENUM ('SPOUSE_F', 'CHILD', 'SPOUSE_M', 'ASCENDANT', 'OTHER');

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "personId" TEXT;

-- CreateTable
CREATE TABLE "persons" (
    "id" TEXT NOT NULL,
    "holdingId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "birthDate" TIMESTAMP(3),
    "birthPlace" TEXT,
    "gender" "Gender",
    "nationalId" TEXT,
    "passportNo" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "photoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "persons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "holdingId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ninea" TEXT,
    "sector" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ipm_service_categories" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ipm_service_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ipm_service_types" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "accountCode" TEXT,
    "legacyCode" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ipm_service_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ipm_provider_specialties" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "accountCode" TEXT,
    "legacyCode" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ipm_provider_specialties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ipm_medical_acts" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "serviceTypeId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "coefficient" DECIMAL(8,2),
    "tariff" DECIMAL(12,2),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ipm_medical_acts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ipm_plans" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "monthlyPrice" DECIMAL(12,2) NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ipm_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ipm_plan_rates" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "beneficiaryType" "IpmBeneficiaryType" NOT NULL DEFAULT 'ALL',
    "rate" DECIMAL(5,4) NOT NULL,
    "ceilingPerAct" DECIMAL(12,2),
    "ceilingMonthly" DECIMAL(12,2),
    "ceilingAnnual" DECIMAL(12,2),
    "waitingPeriodDays" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ipm_plan_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ipm_employer_rates" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "employerId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "beneficiaryType" "IpmBeneficiaryType" NOT NULL DEFAULT 'ALL',
    "rate" DECIMAL(5,4) NOT NULL,
    "ceilingPerAct" DECIMAL(12,2),
    "ceilingMonthly" DECIMAL(12,2),
    "ceilingAnnual" DECIMAL(12,2),
    "waitingPeriodDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ipm_employer_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ipm_employers" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legacyCode" TEXT,
    "legacyEmployerCode" TEXT,
    "matriculePrefix" TEXT,
    "planId" TEXT,
    "accountCode" TEXT,
    "affiliationDate" TIMESTAMP(3) NOT NULL,
    "terminationDate" TIMESTAMP(3),
    "status" "IpmEmployerStatus" NOT NULL DEFAULT 'ACTIVE',
    "ageMajority" INTEGER NOT NULL DEFAULT 21,
    "ageRetirement" INTEGER NOT NULL DEFAULT 60,
    "contributionEmployerAmount" DECIMAL(12,2),
    "contributionEmployeeAmount" DECIMAL(12,2),
    "contributionRate" DECIMAL(5,4),
    "reminderDelayDays" INTEGER NOT NULL DEFAULT 15,
    "suspensionDelayDays" INTEGER NOT NULL DEFAULT 90,
    "consumptionCeiling" DECIMAL(14,2),
    "debtCeiling" DECIMAL(14,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ipm_employers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ipm_members" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "employerId" TEXT NOT NULL,
    "employeeId" TEXT,
    "matricule" TEXT NOT NULL,
    "legacyCode" TEXT,
    "jobTitle" TEXT,
    "affiliationDate" TIMESTAMP(3) NOT NULL,
    "terminationDate" TIMESTAMP(3),
    "status" "IpmMemberStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ipm_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ipm_dependents" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "matricule" TEXT NOT NULL,
    "legacyCode" TEXT,
    "relation" "IpmDependentRelation" NOT NULL,
    "rank" INTEGER NOT NULL,
    "marriageDate" TIMESTAMP(3),
    "coverageStart" TIMESTAMP(3) NOT NULL,
    "coverageEnd" TIMESTAMP(3),
    "status" "IpmDependentStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ipm_dependents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ipm_member_contributions" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "planId" TEXT,
    "monthlyAmount" DECIMAL(12,2) NOT NULL,
    "employerAmount" DECIMAL(12,2),
    "employeeAmount" DECIMAL(12,2),
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "ipm_member_contributions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "persons_holdingId_lastName_firstName_idx" ON "persons"("holdingId", "lastName", "firstName");

-- CreateIndex
CREATE UNIQUE INDEX "persons_holdingId_nationalId_key" ON "persons"("holdingId", "nationalId");

-- CreateIndex
CREATE INDEX "organizations_holdingId_name_idx" ON "organizations"("holdingId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_holdingId_ninea_key" ON "organizations"("holdingId", "ninea");

-- CreateIndex
CREATE UNIQUE INDEX "ipm_service_categories_firmId_code_key" ON "ipm_service_categories"("firmId", "code");

-- CreateIndex
CREATE INDEX "ipm_service_types_firmId_categoryId_idx" ON "ipm_service_types"("firmId", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "ipm_service_types_firmId_code_key" ON "ipm_service_types"("firmId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ipm_provider_specialties_firmId_code_key" ON "ipm_provider_specialties"("firmId", "code");

-- CreateIndex
CREATE INDEX "ipm_medical_acts_firmId_serviceTypeId_idx" ON "ipm_medical_acts"("firmId", "serviceTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "ipm_medical_acts_firmId_code_key" ON "ipm_medical_acts"("firmId", "code");

-- CreateIndex
CREATE INDEX "ipm_plans_firmId_active_idx" ON "ipm_plans"("firmId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ipm_plans_firmId_code_validFrom_key" ON "ipm_plans"("firmId", "code", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "ipm_plan_rates_planId_categoryId_beneficiaryType_key" ON "ipm_plan_rates"("planId", "categoryId", "beneficiaryType");

-- CreateIndex
CREATE UNIQUE INDEX "ipm_employer_rates_employerId_categoryId_beneficiaryType_key" ON "ipm_employer_rates"("employerId", "categoryId", "beneficiaryType");

-- CreateIndex
CREATE INDEX "ipm_employers_firmId_status_idx" ON "ipm_employers"("firmId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ipm_employers_firmId_organizationId_key" ON "ipm_employers"("firmId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ipm_employers_firmId_legacyEmployerCode_key" ON "ipm_employers"("firmId", "legacyEmployerCode");

-- CreateIndex
CREATE UNIQUE INDEX "ipm_employers_firmId_legacyCode_key" ON "ipm_employers"("firmId", "legacyCode");

-- CreateIndex
CREATE INDEX "ipm_members_firmId_employerId_status_idx" ON "ipm_members"("firmId", "employerId", "status");

-- CreateIndex
CREATE INDEX "ipm_members_firmId_personId_idx" ON "ipm_members"("firmId", "personId");

-- CreateIndex
CREATE UNIQUE INDEX "ipm_members_firmId_matricule_key" ON "ipm_members"("firmId", "matricule");

-- CreateIndex
CREATE UNIQUE INDEX "ipm_members_firmId_legacyCode_key" ON "ipm_members"("firmId", "legacyCode");

-- CreateIndex
CREATE INDEX "ipm_dependents_firmId_memberId_status_idx" ON "ipm_dependents"("firmId", "memberId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ipm_dependents_firmId_matricule_key" ON "ipm_dependents"("firmId", "matricule");

-- CreateIndex
CREATE UNIQUE INDEX "ipm_dependents_memberId_rank_key" ON "ipm_dependents"("memberId", "rank");

-- CreateIndex
CREATE INDEX "ipm_member_contributions_firmId_memberId_validFrom_idx" ON "ipm_member_contributions"("firmId", "memberId", "validFrom");

-- CreateIndex
CREATE INDEX "clients_organizationId_idx" ON "clients"("organizationId");

-- CreateIndex
CREATE INDEX "employees_personId_idx" ON "employees"("personId");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persons" ADD CONSTRAINT "persons_holdingId_fkey" FOREIGN KEY ("holdingId") REFERENCES "holdings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_holdingId_fkey" FOREIGN KEY ("holdingId") REFERENCES "holdings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_service_categories" ADD CONSTRAINT "ipm_service_categories_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_service_types" ADD CONSTRAINT "ipm_service_types_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_service_types" ADD CONSTRAINT "ipm_service_types_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ipm_service_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_provider_specialties" ADD CONSTRAINT "ipm_provider_specialties_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_medical_acts" ADD CONSTRAINT "ipm_medical_acts_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_medical_acts" ADD CONSTRAINT "ipm_medical_acts_serviceTypeId_fkey" FOREIGN KEY ("serviceTypeId") REFERENCES "ipm_service_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_plans" ADD CONSTRAINT "ipm_plans_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_plan_rates" ADD CONSTRAINT "ipm_plan_rates_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_plan_rates" ADD CONSTRAINT "ipm_plan_rates_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ipm_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_plan_rates" ADD CONSTRAINT "ipm_plan_rates_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ipm_service_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_employer_rates" ADD CONSTRAINT "ipm_employer_rates_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_employer_rates" ADD CONSTRAINT "ipm_employer_rates_employerId_fkey" FOREIGN KEY ("employerId") REFERENCES "ipm_employers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_employer_rates" ADD CONSTRAINT "ipm_employer_rates_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ipm_service_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_employers" ADD CONSTRAINT "ipm_employers_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_employers" ADD CONSTRAINT "ipm_employers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_employers" ADD CONSTRAINT "ipm_employers_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ipm_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_members" ADD CONSTRAINT "ipm_members_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_members" ADD CONSTRAINT "ipm_members_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_members" ADD CONSTRAINT "ipm_members_employerId_fkey" FOREIGN KEY ("employerId") REFERENCES "ipm_employers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_members" ADD CONSTRAINT "ipm_members_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_dependents" ADD CONSTRAINT "ipm_dependents_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_dependents" ADD CONSTRAINT "ipm_dependents_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "ipm_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_dependents" ADD CONSTRAINT "ipm_dependents_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_member_contributions" ADD CONSTRAINT "ipm_member_contributions_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_member_contributions" ADD CONSTRAINT "ipm_member_contributions_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "ipm_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_member_contributions" ADD CONSTRAINT "ipm_member_contributions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ipm_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_member_contributions" ADD CONSTRAINT "ipm_member_contributions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
