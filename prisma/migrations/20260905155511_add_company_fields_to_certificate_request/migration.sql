/*
  Warnings:

  - The values [REPRESENTANTE_LEGAL] on the enum `EntityType` will be removed. If these variants are still used in the database, this will fail.
  - Made the column `applicantSurname1` on table `certificate_requests` required. This step will fail if there are existing NULL values in that column.
  - Made the column `applicantSurname2` on table `certificate_requests` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "EntityType_new" AS ENUM ('PERSONA_NATURAL', 'EMPRESA');
ALTER TABLE "certificate_requests" ALTER COLUMN "entityType" TYPE "EntityType_new" USING ("entityType"::text::"EntityType_new");
ALTER TYPE "EntityType" RENAME TO "EntityType_old";
ALTER TYPE "EntityType_new" RENAME TO "EntityType";
DROP TYPE "EntityType_old";
COMMIT;

-- AlterTable
ALTER TABLE "certificate_requests" ADD COLUMN     "rucType" TEXT,
ALTER COLUMN "entityType" SET DEFAULT 'PERSONA_NATURAL',
ALTER COLUMN "progress" SET DEFAULT '0/1',
ALTER COLUMN "applicantDocType" SET DEFAULT 'DNI',
ALTER COLUMN "applicantSurname1" SET NOT NULL,
ALTER COLUMN "applicantSurname2" SET NOT NULL;
