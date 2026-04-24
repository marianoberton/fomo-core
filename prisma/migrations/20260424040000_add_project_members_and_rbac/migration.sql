-- CreateEnum
CREATE TYPE "ProjectRole" AS ENUM ('owner', 'operator', 'viewer');

-- CreateTable
CREATE TABLE "project_members" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "ProjectRole" NOT NULL,
    "invited_by" TEXT,
    "accepted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_members_project_id_user_id_key"
    ON "project_members"("project_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_members_project_id_email_key"
    ON "project_members"("project_id", "email");

-- CreateIndex
CREATE INDEX "project_members_user_id_idx"
    ON "project_members"("user_id");

-- AddForeignKey
ALTER TABLE "project_members"
    ADD CONSTRAINT "project_members_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
