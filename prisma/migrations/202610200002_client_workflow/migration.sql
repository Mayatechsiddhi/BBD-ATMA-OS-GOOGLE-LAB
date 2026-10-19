-- CreateEnum
CREATE TYPE "ContactStatus" AS ENUM ('LEAD', 'QUALIFIED', 'CUSTOMER', 'ARCHIVED');

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "company" TEXT,
    "status" "ContactStatus" NOT NULL DEFAULT 'LEAD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Contact_organizationId_status_createdAt_idx" ON "Contact"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_organizationId_id_key" ON "Contact"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_organizationId_email_key" ON "Contact"("organizationId", "email");

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
