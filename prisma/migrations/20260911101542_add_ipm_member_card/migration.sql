-- CreateTable
CREATE TABLE "ipm_member_cards" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "inputsHash" TEXT NOT NULL,
    "ppi" INTEGER NOT NULL DEFAULT 300,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedById" TEXT,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ipm_member_cards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ipm_member_cards_firmId_inputsHash_idx" ON "ipm_member_cards"("firmId", "inputsHash");

-- CreateIndex
CREATE UNIQUE INDEX "ipm_member_cards_memberId_key" ON "ipm_member_cards"("memberId");

-- AddForeignKey
ALTER TABLE "ipm_member_cards" ADD CONSTRAINT "ipm_member_cards_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_member_cards" ADD CONSTRAINT "ipm_member_cards_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "ipm_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_member_cards" ADD CONSTRAINT "ipm_member_cards_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
