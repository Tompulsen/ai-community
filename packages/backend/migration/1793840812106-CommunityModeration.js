/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class CommunityModeration1793840812106 {
    name = 'CommunityModeration1793840812106';

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "community_submission" ADD "publicationMode" varchar(16) NOT NULL DEFAULT 'before'`);
        await queryRunner.query(`ALTER TABLE "community_submission" DROP CONSTRAINT "FK_community_submission_note"`);
        await queryRunner.query(`ALTER TABLE "community_submission" ADD CONSTRAINT "FK_community_submission_note" FOREIGN KEY ("approvedNoteId") REFERENCES "note"("id") ON DELETE SET NULL`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "community_submission" DROP CONSTRAINT "FK_community_submission_note"`);
        await queryRunner.query(`ALTER TABLE "community_submission" ADD CONSTRAINT "FK_community_submission_note" FOREIGN KEY ("approvedNoteId") REFERENCES "note"("id") ON DELETE CASCADE`);
        await queryRunner.query(`ALTER TABLE "community_submission" DROP COLUMN "publicationMode"`);
    }
}
