-- CreateTable
CREATE TABLE "camerfirma_email_logs" (
    "id" TEXT NOT NULL,
    "certificateRequestId" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyHtml" TEXT,
    "bodyText" TEXT,
    "emailSequenceNumber" INTEGER NOT NULL,
    "isFinalForwarded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "camerfirma_email_logs_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "camerfirma_email_logs" ADD CONSTRAINT "camerfirma_email_logs_certificateRequestId_fkey" FOREIGN KEY ("certificateRequestId") REFERENCES "certificate_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
