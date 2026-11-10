/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class CommunityLottery1794308400000 {
	name = 'CommunityLottery1794308400000';

	async up(queryRunner) {
		await queryRunner.query("CREATE TABLE \"community_lottery_config\" (\"id\" character varying(16) NOT NULL, \"version\" integer NOT NULL DEFAULT '0', \"settings\" jsonb NOT NULL, CONSTRAINT \"PK_community_lottery_config\" PRIMARY KEY (\"id\"))");
		await queryRunner.query("CREATE TABLE \"community_lottery_account\" (\"userId\" character varying(32) NOT NULL, \"balance\" integer NOT NULL DEFAULT '0', \"progress\" jsonb NOT NULL, CONSTRAINT \"PK_community_lottery_account\" PRIMARY KEY (\"userId\"))");
		await queryRunner.query("CREATE TABLE \"community_lottery_referral\" (\"userId\" character varying(32) NOT NULL, \"inviterId\" character varying(32) NOT NULL, \"createdAt\" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT \"PK_community_lottery_referral\" PRIMARY KEY (\"userId\"))");
		await queryRunner.query("CREATE INDEX \"IDX_community_lottery_referral_inviter\" ON \"community_lottery_referral\"  (\"inviterId\") ");
		await queryRunner.query("CREATE TABLE \"community_lottery_draw\" (\"creditIssuer\" character varying(255), \"creditSubject\" character varying(128), \"creditPending\" boolean NOT NULL DEFAULT false, \"creditAttempts\" integer NOT NULL DEFAULT '0', \"creditRetryAt\" TIMESTAMP WITH TIME ZONE, \"id\" character varying(32) NOT NULL, \"userId\" character varying(32), \"requestId\" character varying(64) NOT NULL, \"prizes\" jsonb NOT NULL, \"createdAt\" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT \"PK_community_lottery_draw\" PRIMARY KEY (\"id\"))");
		await queryRunner.query("CREATE INDEX \"IDX_community_lottery_draw_credit\" ON \"community_lottery_draw\"  (\"creditPending\") ");
		await queryRunner.query("CREATE INDEX \"IDX_community_lottery_draw_user_id\" ON \"community_lottery_draw\"  (\"userId\", \"id\") ");
		await queryRunner.query("CREATE UNIQUE INDEX \"IDX_community_lottery_draw_request\" ON \"community_lottery_draw\"  (\"userId\", \"requestId\") ");
		await queryRunner.query("ALTER TABLE \"user_pending\" ADD \"lotteryInviterId\" character varying(32)");
		await queryRunner.query("ALTER TABLE \"community_lottery_account\" ADD CONSTRAINT \"FK_community_lottery_account_user\" FOREIGN KEY (\"userId\") REFERENCES \"user\"(\"id\") ON DELETE CASCADE ON UPDATE NO ACTION");
		await queryRunner.query("ALTER TABLE \"community_lottery_referral\" ADD CONSTRAINT \"FK_community_lottery_referral_inviter\" FOREIGN KEY (\"inviterId\") REFERENCES \"user\"(\"id\") ON DELETE CASCADE ON UPDATE NO ACTION");
		await queryRunner.query("ALTER TABLE \"community_lottery_draw\" ADD CONSTRAINT \"FK_community_lottery_draw_user\" FOREIGN KEY (\"userId\") REFERENCES \"user\"(\"id\") ON DELETE SET NULL ON UPDATE NO ACTION");
	}

	async down(queryRunner) {
		await queryRunner.query("DROP TABLE \"community_lottery_draw\"");
		await queryRunner.query("DROP TABLE \"community_lottery_referral\"");
		await queryRunner.query("DROP TABLE \"community_lottery_account\"");
		await queryRunner.query("DROP TABLE \"community_lottery_config\"");
		await queryRunner.query("ALTER TABLE \"user_pending\" DROP COLUMN \"lotteryInviterId\"");
	}
}
