/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class CommunityWorkViews1793844969747 {
	name = 'CommunityWorkViews1793844969747';
	async up(queryRunner) {
		await queryRunner.query('ALTER TABLE "community_submission" ADD "viewsCount" integer NOT NULL DEFAULT 0');
	}
	async down(queryRunner) {
		await queryRunner.query('ALTER TABLE "community_submission" DROP COLUMN "viewsCount"');
	}
}
