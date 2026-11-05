/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class CommunityWorkEditing1793857663138 {
	name = 'CommunityWorkEditing1793857663138';
	async up(queryRunner) {
		await queryRunner.query('ALTER TABLE "community_submission" ADD "pendingRevision" jsonb');
	}
	async down(queryRunner) {
		await queryRunner.query('ALTER TABLE "community_submission" DROP COLUMN "pendingRevision"');
	}
}
