/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class CommunitySubmission1793808005308 {
    name = 'CommunitySubmission1793808005308';

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "community_submission" (
            "id" varchar(32) NOT NULL, "authorId" varchar(32) NOT NULL,
            "idempotencyKey" varchar(64) NOT NULL, "payloadHash" varchar(64) NOT NULL,
            "category" varchar(16) NOT NULL, "title" varchar(100) NOT NULL, "text" text NOT NULL,
            "model" varchar(100) NOT NULL, "sourceUrl" varchar(2000) NOT NULL, "license" varchar(200) NOT NULL,
            "fileIds" varchar(32) array NOT NULL DEFAULT '{}', "status" varchar(16) NOT NULL DEFAULT 'pending',
            "version" integer NOT NULL DEFAULT 0, "submittedAt" timestamptz NOT NULL,
            "reviewedAt" timestamptz, "reviewedById" varchar(32), "rejectionReason" varchar(1000), "approvedNoteId" varchar(32),
            CONSTRAINT "PK_community_submission" PRIMARY KEY ("id"),
            CONSTRAINT "FK_community_submission_author" FOREIGN KEY ("authorId") REFERENCES "user"("id") ON DELETE CASCADE,
            CONSTRAINT "FK_community_submission_note" FOREIGN KEY ("approvedNoteId") REFERENCES "note"("id") ON DELETE CASCADE
        )`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_community_submission_author_key" ON "community_submission" ("authorId", "idempotencyKey")`);
        await queryRunner.query(`CREATE INDEX "IDX_community_submission_status_category_id" ON "community_submission" ("status", "category", "id")`);
        await queryRunner.query(`CREATE INDEX "IDX_community_submission_author_id" ON "community_submission" ("authorId", "id")`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_community_submission_note" ON "community_submission" ("approvedNoteId")`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP TABLE "community_submission"`);
    }
}
