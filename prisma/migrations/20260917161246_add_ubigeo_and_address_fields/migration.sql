-- AlterTable
ALTER TABLE "certificate_requests" ADD COLUMN     "address" TEXT,
ADD COLUMN     "department" TEXT,
ADD COLUMN     "district" TEXT,
ADD COLUMN     "postalCode" TEXT,
ADD COLUMN     "province" TEXT;

-- AlterTable
ALTER TABLE "verification_requests" ADD COLUMN     "address" TEXT,
ADD COLUMN     "department" TEXT,
ADD COLUMN     "district" TEXT,
ADD COLUMN     "province" TEXT;

-- AlterTable
ALTER TABLE "verification_results" ADD COLUMN     "extractedAddress" TEXT,
ADD COLUMN     "extractedDepartment" TEXT,
ADD COLUMN     "extractedDistrict" TEXT,
ADD COLUMN     "extractedProvince" TEXT;
