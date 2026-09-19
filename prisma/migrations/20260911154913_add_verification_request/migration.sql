-- CreateTable
CREATE TABLE "verification_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "entityType" "EntityType" NOT NULL DEFAULT 'PERSONA_NATURAL',
    "docType" "DocType" NOT NULL DEFAULT 'DNI',
    "documentNumber" TEXT NOT NULL,
    "extractedFirstName" TEXT,
    "extractedLastName" TEXT,
    "extractedFullName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "companyRuc" TEXT,
    "companyName" TEXT,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_requests_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
