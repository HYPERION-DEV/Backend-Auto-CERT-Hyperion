-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'OPERATOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('PERSONA_NATURAL', 'REPRESENTANTE_LEGAL', 'EMPRESA');

-- CreateEnum
CREATE TYPE "DocType" AS ENUM ('DNI', 'CE', 'RUC');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('BORRADOR', 'EN_REVISION', 'RECHAZADO', 'APROBADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "DocumentCategory" AS ENUM ('DNI_FRONT_BACK', 'FICHA_RUC', 'VIGENCIA_PODER', 'OTRO');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "docType" "DocType" NOT NULL DEFAULT 'DNI',
    "docNumber" TEXT NOT NULL,
    "phone" TEXT,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificate_requests" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "planType" TEXT NOT NULL DEFAULT 'ONE_SHOT',
    "status" "RequestStatus" NOT NULL DEFAULT 'EN_REVISION',
    "progress" TEXT NOT NULL DEFAULT '1/1',
    "applicantDocType" "DocType" NOT NULL,
    "applicantDocNum" TEXT NOT NULL,
    "applicantNames" TEXT NOT NULL,
    "applicantSurname1" TEXT,
    "applicantSurname2" TEXT,
    "applicantEmail" TEXT NOT NULL,
    "applicantPhone" TEXT NOT NULL,
    "companyRuc" TEXT,
    "companyName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "certificate_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_documents" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "category" "DocumentCategory" NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'application/pdf',
    "fileSizeBytes" INTEGER,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_results" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "isMatch" BOOLEAN NOT NULL,
    "inputDocumentNum" TEXT NOT NULL,
    "detectedDocumentNum" TEXT,
    "extractedNames" TEXT,
    "extractedSurname1" TEXT,
    "extractedSurname2" TEXT,
    "extractedBirthDate" TEXT,
    "extractedNationality" TEXT,
    "rawAiJsonResponse" JSONB,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_docNumber_key" ON "users"("docNumber");

-- CreateIndex
CREATE UNIQUE INDEX "certificate_requests_code_key" ON "certificate_requests"("code");

-- CreateIndex
CREATE UNIQUE INDEX "verification_results_documentId_key" ON "verification_results"("documentId");

-- AddForeignKey
ALTER TABLE "certificate_requests" ADD CONSTRAINT "certificate_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_documents" ADD CONSTRAINT "request_documents_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "certificate_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_results" ADD CONSTRAINT "verification_results_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "request_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
