/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class UniqueCommunityEmail1793781156481 {
    name = 'UniqueCommunityEmail1793781156481';

    async up(queryRunner) {
        // Fail without changing existing data if historical duplicates need resolution.
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_user_profile_email_normalized" ON "user_profile" (LOWER(BTRIM("email"))) WHERE "email" IS NOT NULL`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_user_profile_email_normalized"`);
    }
}
