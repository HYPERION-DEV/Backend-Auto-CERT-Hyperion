-- AlterTable
ALTER TABLE "verification_results" ADD COLUMN     "extractedCompanyName" TEXT,
ADD COLUMN     "extractedExpiryDate" TEXT,
ADD COLUMN     "extractedIssueDate" TEXT,
ADD COLUMN     "extractedRuc" TEXT,
ADD COLUMN     "extractedRucCond" TEXT,
ADD COLUMN     "extractedRucStatus" TEXT,
ADD COLUMN     "rejectionReason" TEXT;
