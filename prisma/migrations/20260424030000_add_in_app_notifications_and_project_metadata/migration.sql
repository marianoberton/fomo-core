-- Add metadata JSON column to projects (per-project notifier overrides, etc.)
ALTER TABLE "projects" ADD COLUMN "metadata" JSONB;

-- Persistent in-dashboard notifications
CREATE TABLE "in_app_notifications" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "in_app_notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "in_app_notifications_project_id_read_at_idx"
    ON "in_app_notifications"("project_id", "read_at");

ALTER TABLE "in_app_notifications"
    ADD CONSTRAINT "in_app_notifications_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
