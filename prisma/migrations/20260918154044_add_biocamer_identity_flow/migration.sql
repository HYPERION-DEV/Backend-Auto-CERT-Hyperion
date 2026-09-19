-- CreateEnum
CREATE TYPE "IdentityStatus" AS ENUM ('PENDING', 'REGISTERED', 'APPROVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "DocType" ADD VALUE 'PASAPORTE';

-- AlterTable
ALTER TABLE "certificate_requests" ADD COLUMN     "biocamerClientId" TEXT,
ADD COLUMN     "biocamerUrl" TEXT,
ADD COLUMN     "identityStatus" "IdentityStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "identityVerified" BOOLEAN NOT NULL DEFAULT false;
