-- AlterTable
ALTER TABLE "certificate_requests" ADD COLUMN     "isConfirmed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "useTempEmail" BOOLEAN NOT NULL DEFAULT true;
