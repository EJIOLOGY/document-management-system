-- Explicit event names make expiry-notification deduplication unambiguous.
DO $$
BEGIN
  CREATE TYPE "ExpiryNotificationType" AS ENUM (
    'EXPIRING_30_DAYS',
    'EXPIRING_7_DAYS',
    'EXPIRED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "notifications_sent"
  ADD COLUMN IF NOT EXISTS "type" "ExpiryNotificationType";

-- Preserve any existing threshold history while making its lifecycle meaning
-- explicit. The former schema only supported the expected 30/7/0 values.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notifications_sent' AND column_name = 'threshold'
  ) THEN
    EXECUTE '
      UPDATE "notifications_sent"
      SET "type" = CASE
        WHEN "threshold" <= 0 THEN ''EXPIRED''::"ExpiryNotificationType"
        WHEN "threshold" <= 7 THEN ''EXPIRING_7_DAYS''::"ExpiryNotificationType"
        ELSE ''EXPIRING_30_DAYS''::"ExpiryNotificationType"
      END';
    ALTER TABLE "notifications_sent" DROP COLUMN "threshold";
  END IF;
END $$;

ALTER TABLE "notifications_sent"
  ALTER COLUMN "type" SET NOT NULL;

DROP INDEX IF EXISTS "notifications_sent_document_id_threshold_key";

CREATE UNIQUE INDEX "notifications_sent_document_id_type_key"
  ON "notifications_sent"("document_id", "type");

CREATE TABLE "in_app_notifications" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "document_id" TEXT NOT NULL,
  "type" "ExpiryNotificationType" NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "read" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "read_at" TIMESTAMP(3),

  CONSTRAINT "in_app_notifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "in_app_notifications_user_id_document_id_type_key"
  ON "in_app_notifications"("user_id", "document_id", "type");

CREATE INDEX "in_app_notifications_user_id_read_created_at_idx"
  ON "in_app_notifications"("user_id", "read", "created_at");

ALTER TABLE "in_app_notifications"
  ADD CONSTRAINT "in_app_notifications_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "in_app_notifications"
  ADD CONSTRAINT "in_app_notifications_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
