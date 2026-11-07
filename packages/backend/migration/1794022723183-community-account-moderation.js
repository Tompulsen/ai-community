/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class CommunityAccountModeration1794022723183 {
	name = 'CommunityAccountModeration1794022723183';
	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "user" ADD "communityViolationCount" integer NOT NULL DEFAULT 0, ADD "communityViolationBaseline" integer NOT NULL DEFAULT 0`);
		await queryRunner.query(`ALTER TABLE "abuse_user_report" ADD "contentKey" varchar(128), ADD "contentSnapshot" text`);
		await queryRunner.query(`CREATE TABLE "community_violation" ("contentKey" varchar(128) NOT NULL, "userId" varchar(32) NOT NULL, "moderatorId" varchar(32) NOT NULL, "reason" text NOT NULL, "createdAt" timestamptz NOT NULL, CONSTRAINT "PK_community_violation" PRIMARY KEY ("contentKey"), CONSTRAINT "FK_community_violation_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE)`);
	}
	async down(queryRunner) {
		await queryRunner.query(`DROP TABLE "community_violation"`);
		await queryRunner.query(`ALTER TABLE "abuse_user_report" DROP COLUMN "contentSnapshot", DROP COLUMN "contentKey"`);
		await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "communityViolationBaseline", DROP COLUMN "communityViolationCount"`);
	}
}
