/*
  Warnings:

  - You are about to drop the `benefit_plans` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `claims` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `contributions` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `employee_coverage_enrollments` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `file_objects` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `partner_agreements` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `partner_branches` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `partners` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "benefit_plans" DROP CONSTRAINT "benefit_plans_firmId_fkey";

-- DropForeignKey
ALTER TABLE "claims" DROP CONSTRAINT "claims_employeeId_fkey";

-- DropForeignKey
ALTER TABLE "claims" DROP CONSTRAINT "claims_firmId_fkey";

-- DropForeignKey
ALTER TABLE "claims" DROP CONSTRAINT "claims_partnerId_fkey";

-- DropForeignKey
ALTER TABLE "contributions" DROP CONSTRAINT "contributions_employeeId_fkey";

-- DropForeignKey
ALTER TABLE "contributions" DROP CONSTRAINT "contributions_firmId_fkey";

-- DropForeignKey
ALTER TABLE "contributions" DROP CONSTRAINT "contributions_planId_fkey";

-- DropForeignKey
ALTER TABLE "employee_coverage_enrollments" DROP CONSTRAINT "employee_coverage_enrollments_employeeId_fkey";

-- DropForeignKey
ALTER TABLE "employee_coverage_enrollments" DROP CONSTRAINT "employee_coverage_enrollments_planId_fkey";

-- DropForeignKey
ALTER TABLE "employee_coverage_enrollments" DROP CONSTRAINT "employee_coverage_enrollments_preferredPartnerId_fkey";

-- DropForeignKey
ALTER TABLE "file_objects" DROP CONSTRAINT "file_objects_firmId_fkey";

-- DropForeignKey
ALTER TABLE "file_objects" DROP CONSTRAINT "file_objects_uploadedBy_fkey";

-- DropForeignKey
ALTER TABLE "partner_agreements" DROP CONSTRAINT "partner_agreements_firmId_fkey";

-- DropForeignKey
ALTER TABLE "partner_agreements" DROP CONSTRAINT "partner_agreements_partnerId_fkey";

-- DropForeignKey
ALTER TABLE "partner_branches" DROP CONSTRAINT "partner_branches_partnerId_fkey";

-- DropForeignKey
ALTER TABLE "partners" DROP CONSTRAINT "partners_firmId_fkey";

-- DropTable
DROP TABLE "benefit_plans";

-- DropTable
DROP TABLE "claims";

-- DropTable
DROP TABLE "contributions";

-- DropTable
DROP TABLE "employee_coverage_enrollments";

-- DropTable
DROP TABLE "file_objects";

-- DropTable
DROP TABLE "partner_agreements";

-- DropTable
DROP TABLE "partner_branches";

-- DropTable
DROP TABLE "partners";

-- DropEnum
DROP TYPE "ClaimStatus";

-- DropEnum
DROP TYPE "PartnerType";
