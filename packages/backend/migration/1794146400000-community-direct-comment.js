/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class CommunityDirectComment1794146400000 {
 name = 'CommunityDirectComment1794146400000';
 async up(queryRunner) {
  await queryRunner.query(`ALTER TABLE "community_submission" ADD "destination" character varying(16) NOT NULL DEFAULT 'community'`);
 }
 async down(queryRunner) {
  await queryRunner.query(`ALTER TABLE "community_submission" DROP COLUMN "destination"`);
 }
}
