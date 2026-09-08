-- Confidentiality is not an access-control concept in this DMS. Both roles
-- retain access to every document, so remove the unused data-model field.
ALTER TABLE "documents" DROP COLUMN "confidentiality";

DROP TYPE "Confidentiality";

-- Existing Drive revisions predate filename/MIME tracking, so these remain
-- nullable. All uploads created by the DocumentsModule populate both fields.
ALTER TABLE "document_versions"
  ADD COLUMN "original_file_name" TEXT,
  ADD COLUMN "mime_type" TEXT;
