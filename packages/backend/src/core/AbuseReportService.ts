/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import { bindThis } from '@/decorators.js';
import { MiAbuseUserReport } from '@/models/AbuseUserReport.js';
import { CommunityModerationService } from './CommunityModerationService.js';
import type { AbuseUserReportsRepository, MiUser, UsersRepository } from '@/models/_.js';
import { AbuseReportNotificationService } from '@/core/AbuseReportNotificationService.js';
import { QueueService } from '@/core/QueueService.js';
import { ApRendererService } from '@/core/activitypub/ApRendererService.js';
import { ModerationLogService } from '@/core/ModerationLogService.js';
import { SystemAccountService } from '@/core/SystemAccountService.js';
import { IdService } from './IdService.js';

@Injectable()
export class AbuseReportService {
	constructor(
		@Inject(DI.abuseUserReportsRepository)
		private abuseUserReportsRepository: AbuseUserReportsRepository,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		private idService: IdService,
		private abuseReportNotificationService: AbuseReportNotificationService,
		private queueService: QueueService,
		private systemAccountService: SystemAccountService,
		private apRendererService: ApRendererService,
		private moderationLogService: ModerationLogService,
		private communityModerationService: CommunityModerationService,
	) {
	}

	/**
	 * ユーザからの通報をDBに記録し、その内容を下記の手段で管理者各位に通知する.
	 * - 管理者用Redisイベント
	 * - EMail（モデレータ権限所有者ユーザ＋metaテーブルに設定されているメールアドレス）
	 * - SystemWebhook
	 *
	 * @param params 通報内容. もし複数件の通報に対応した時のために、あらかじめ複数件を処理できる前提で考える
	 * @see AbuseReportNotificationService.notify
	 */
	@bindThis
	public async report(params: {
		targetUserId: MiAbuseUserReport['targetUserId'],
		targetUserHost: MiAbuseUserReport['targetUserHost'],
		reporterId: MiAbuseUserReport['reporterId'],
		reporterHost: MiAbuseUserReport['reporterHost'],
		comment: string,
		contentKey?: string,
		contentSnapshot?: string,
	}[]) {
		const entities = params.map(param => {
			return {
				id: this.idService.gen(),
				targetUserId: param.targetUserId,
				targetUserHost: param.targetUserHost,
				reporterId: param.reporterId,
				reporterHost: param.reporterHost,
				comment: param.comment,
				contentKey: param.contentKey ?? null,
				contentSnapshot: param.contentSnapshot ?? null,
			};
		});

		const reports = Array.of<MiAbuseUserReport>();
		for (const entity of entities) {
			const report = await this.abuseUserReportsRepository.insertOne(entity);
			reports.push(report);
		}

		return Promise.all([
			this.abuseReportNotificationService.notifyAdminStream(reports),
			this.abuseReportNotificationService.notifySystemWebhook(reports, 'abuseReport'),
			this.abuseReportNotificationService.notifyMail(reports),
		]);
	}

	/**
	 * 通報を解決し、その内容を下記の手段で管理者各位に通知する.
	 * - SystemWebhook
	 *
	 * @param params 通報内容. もし複数件の通報に対応した時のために、あらかじめ複数件を処理できる前提で考える
	 * @param moderator 通報を処理したユーザ
	 * @see AbuseReportNotificationService.notify
	 */
	@bindThis
	public async resolve(
		params: {
			reportId: string;
			resolvedAs: MiAbuseUserReport['resolvedAs'];
		}[],
		moderator: MiUser,
	) {
		const changed: MiAbuseUserReport[] = [];
		// Stable order avoids deadlocks for bulk resolutions; each decision is atomic.
		for (const ps of [...params].sort((a, b) => a.reportId.localeCompare(b.reportId))) {
			const afterCommit: (() => void)[] = [];
			const resolved = await this.abuseUserReportsRepository.manager.transaction(async manager => {
				const reports = manager.getRepository(MiAbuseUserReport);
				const report = await reports.createQueryBuilder('report').setLock('pessimistic_write').where('report.id = :id', { id: ps.reportId }).getOne();
				if (!report || report.resolved) return null;
				if (ps.resolvedAs === 'accept' && report.contentKey) {
					await this.communityModerationService.record(manager, afterCommit, {
						userId: report.targetUserId, contentKey: report.contentKey, reason: report.comment, moderator,
					});
				}
				report.resolved = true;
				report.assigneeId = moderator.id;
				report.resolvedAs = ps.resolvedAs;
				await reports.save(report);
				return report;
			});
			for (const effect of afterCommit) effect();
			if (resolved) {
				changed.push(resolved);
				this.moderationLogService.log(moderator, 'resolveAbuseReport', { reportId: resolved.id, report: resolved, resolvedAs: ps.resolvedAs });
			}
		}
		if (changed.length) await this.abuseReportNotificationService.notifySystemWebhook(changed, 'abuseReportResolved');
	}

	@bindThis
	public async forward(
		reportId: MiAbuseUserReport['id'],
		moderator: MiUser,
	) {
		const report = await this.abuseUserReportsRepository.findOneByOrFail({ id: reportId });

		if (report.targetUserHost == null) {
			throw new Error('The target user host is null.');
		}

		if (report.forwarded) {
			throw new Error('The report has already been forwarded.');
		}

		await this.abuseUserReportsRepository.update(report.id, {
			forwarded: true,
		});

		const actor = await this.systemAccountService.fetch('actor');
		const targetUser = await this.usersRepository.findOneByOrFail({ id: report.targetUserId });

		const flag = this.apRendererService.renderFlag(actor, targetUser.uri!, report.comment);
		const contextAssignedFlag = this.apRendererService.addContext(flag);
		this.queueService.deliver(actor, contextAssignedFlag, targetUser.inbox, false);

		this.moderationLogService
			.log(moderator, 'forwardAbuseReport', {
				reportId: report.id,
				report: report,
			});
	}

	@bindThis
	public async update(
		reportId: MiAbuseUserReport['id'],
		params: {
			moderationNote?: MiAbuseUserReport['moderationNote'];
		},
		moderator: MiUser,
	) {
		const report = await this.abuseUserReportsRepository.findOneByOrFail({ id: reportId });

		await this.abuseUserReportsRepository.update(report.id, {
			moderationNote: params.moderationNote,
		});

		if (params.moderationNote != null && report.moderationNote !== params.moderationNote) {
			this.moderationLogService.log(moderator, 'updateAbuseReportNote', {
				reportId: report.id,
				report: report,
				before: report.moderationNote,
				after: params.moderationNote,
			});
		}
	}
}
