-- CreateTable
CREATE TABLE "ipm_member_ceilings" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "ceilingPerAct" DECIMAL(12,2),
    "ceilingMonthly" DECIMAL(12,2),
    "ceilingAnnual" DECIMAL(12,2),
    "reason" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ipm_member_ceilings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ipm_member_ceilings_firmId_memberId_categoryId_validFrom_idx" ON "ipm_member_ceilings"("firmId", "memberId", "categoryId", "validFrom");

-- AddForeignKey
ALTER TABLE "ipm_member_ceilings" ADD CONSTRAINT "ipm_member_ceilings_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_member_ceilings" ADD CONSTRAINT "ipm_member_ceilings_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "ipm_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_member_ceilings" ADD CONSTRAINT "ipm_member_ceilings_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ipm_service_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_member_ceilings" ADD CONSTRAINT "ipm_member_ceilings_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

