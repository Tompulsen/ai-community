/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class CommunitySourceComment1794132000000 {
    name = 'CommunitySourceComment1794132000000';

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "community_submission" ADD "sourceCommentId" character varying(32)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "community_submission" DROP COLUMN "sourceCommentId"`);
    }
}
