-- CreateTable
CREATE TABLE "ipm_portal_bookings" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "type" "IpmVoucherType" NOT NULL,
    "serviceTypeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ipm_portal_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_IpmPortalBookingToIpmProviderSpecialty" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_IpmPortalBookingToIpmProviderSpecialty_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "ipm_portal_bookings_firmId_type_key" ON "ipm_portal_bookings"("firmId", "type");

-- CreateIndex
CREATE INDEX "_IpmPortalBookingToIpmProviderSpecialty_B_index" ON "_IpmPortalBookingToIpmProviderSpecialty"("B");

-- AddForeignKey
ALTER TABLE "ipm_portal_bookings" ADD CONSTRAINT "ipm_portal_bookings_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipm_portal_bookings" ADD CONSTRAINT "ipm_portal_bookings_serviceTypeId_fkey" FOREIGN KEY ("serviceTypeId") REFERENCES "ipm_service_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_IpmPortalBookingToIpmProviderSpecialty" ADD CONSTRAINT "_IpmPortalBookingToIpmProviderSpecialty_A_fkey" FOREIGN KEY ("A") REFERENCES "ipm_portal_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_IpmPortalBookingToIpmProviderSpecialty" ADD CONSTRAINT "_IpmPortalBookingToIpmProviderSpecialty_B_fkey" FOREIGN KEY ("B") REFERENCES "ipm_provider_specialties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

