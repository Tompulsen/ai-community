/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */
export class CommunityGeneration1794106548260 {
 name = 'CommunityGeneration1794106548260';
 async up(queryRunner) { await queryRunner.query(`ALTER TABLE "community_submission" ADD "generation" jsonb`); }
 async down(queryRunner) { await queryRunner.query(`ALTER TABLE "community_submission" DROP COLUMN "generation"`); }
}
