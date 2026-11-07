/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class ExternalAccount1794020362141 {
	name = 'ExternalAccount1794020362141';

	async up(queryRunner) {
		await queryRunner.query(`CREATE TABLE "external_account" ("issuer" character varying(255) NOT NULL, "subject" character varying(128) NOT NULL, "userId" character varying(32), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_external_account" PRIMARY KEY ("issuer", "subject"))`);
		await queryRunner.query(`CREATE UNIQUE INDEX "IDX_external_account_user" ON "external_account" ("issuer", "userId")`);
		await queryRunner.query(`ALTER TABLE "external_account" ADD CONSTRAINT "FK_external_account_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
	}

	async down(queryRunner) {
		await queryRunner.query(`DROP TABLE "external_account"`);
	}
}
