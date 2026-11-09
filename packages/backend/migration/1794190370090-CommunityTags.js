/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class CommunityTags1794190370090 {
    name = 'CommunityTags1794190370090';

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "community_tag" (
            "id" varchar(32) NOT NULL, "category" varchar(16) NOT NULL,
            "name" varchar(24) NOT NULL, "isDeleted" boolean NOT NULL DEFAULT false,
            CONSTRAINT "PK_community_tag" PRIMARY KEY ("id")
        )`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_community_tag_active_category_name" ON "community_tag" ("category", "name") WHERE "isDeleted" = false`);
        await queryRunner.query(`ALTER TABLE "community_submission" ADD "tagIds" varchar(32) array NOT NULL DEFAULT '{}'`);
        await queryRunner.query(`CREATE INDEX "IDX_community_submission_tag_ids" ON "community_submission" USING GIN ("tagIds")`);
        const seeds = {
            image: ['插画', '动漫', '角色', '海报', '电商', '艺术风格', '美女', '摄影', '产品设计'],
            video: ['动漫', '短片', '角色', '广告', '产品展示', '音乐', '影视', '特效', '教程'],
            resource: ['Skill', '提示词', '代码', '教程', '文案', '工具', '自动化', '开源'],
        };
        for (const [category, names] of Object.entries(seeds)) {
            for (const [index, name] of names.entries()) {
                await queryRunner.query(`INSERT INTO "community_tag" ("id", "category", "name") VALUES ($1, $2, $3)`, [`tag${category}${String(index + 1).padStart(2, '0')}`, category, name]);
            }
        }
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_community_submission_tag_ids"`);
        await queryRunner.query(`ALTER TABLE "community_submission" DROP COLUMN "tagIds"`);
        await queryRunner.query(`DROP TABLE "community_tag"`);
    }
}
