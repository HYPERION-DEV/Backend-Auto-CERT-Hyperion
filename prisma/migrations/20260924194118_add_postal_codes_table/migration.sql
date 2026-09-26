/*
  Warnings:

  - You are about to drop the `ubigeos` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "ubigeos";

-- CreateTable
CREATE TABLE "postal_codes" (
    "code" VARCHAR(5) NOT NULL,
    "districts" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "postal_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "postal_codes_department_province_idx" ON "postal_codes"("department", "province");
