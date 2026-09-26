-- CreateTable
CREATE TABLE "ubigeos" (
    "code" VARCHAR(6) NOT NULL,
    "district" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "population" INTEGER,
    "surfaceArea" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ubigeos_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE INDEX "ubigeos_department_province_district_idx" ON "ubigeos"("department", "province", "district");
