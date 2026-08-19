/*
  Warnings:

  - The values [CERTIFICATE,LICENSE,POLICY,REPORT,TEMPLATE] on the enum `DocType` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "DocType_new" AS ENUM ('BANK_REF_LETTER', 'BID_TECHNICAL_DOCS', 'CAC', 'CLIENTS_COMPANIES', 'COMPANY_PROFILE', 'DIRECTORS_FOLDER', 'EXPERIENCE', 'FINANCIAL_AUDITED_DOCUMENT', 'HSE', 'IN_HOUSE_PERSONNEL_DETAILS', 'INSURANCE', 'IRR', 'ITF', 'MOU', 'NCEC', 'NIMASA', 'NIPEX_RENEWAL', 'NMDPRA', 'NOGIC', 'NPA', 'NSITF', 'NUPRC', 'ORGANOGRAM', 'PENCOM', 'TAX', 'OTHER');
ALTER TABLE "documents" ALTER COLUMN "doc_type" TYPE "DocType_new" USING ("doc_type"::text::"DocType_new");
ALTER TYPE "DocType" RENAME TO "DocType_old";
ALTER TYPE "DocType_new" RENAME TO "DocType";
DROP TYPE "public"."DocType_old";
COMMIT;
