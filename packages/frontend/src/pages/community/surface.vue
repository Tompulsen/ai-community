<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<main ref="surfaceRoot" :class="[$style.root, { [$style.embedded]: embedded, [$style.discoveryLocked]: discoveryCompact && discoveryOpen }]">
	<div :class="[$style.canvas, { [$style.communityCanvas]: isPublicFeed }]">
		<slot v-if="isProfile" name="profileHeader"></slot>
		<header v-else-if="!isCommunity && !embedded" :class="$style.heading">
			<div><h1>{{ title }}</h1><p v-if="!isCommunity">{{ description }}</p></div>
			<div :class="$style.headerActions">
				<div :class="$style.account">
					<template v-if="!signedIn">
						<button type="button" :class="$style.quiet" @click="emit('login')">{{ t.login }}</button>
						<button type="button" :class="$style.secondary" :title="registrationClosed ? t.signupClosed : undefined" @click="emit('signup')">{{ t.signup }}</button>
					</template>
					<a v-else href="/community/mine" :class="$style.quiet" @click.prevent="emit('navigate', '/community/mine')">{{ t.mine }}</a>
				</div>
			</div>
		</header>
		<nav v-if="isProfile" :class="[$style.tabs, $style.profileTabs]" :aria-label="t.profileWorks">
			<button type="button" :aria-pressed="profileCategory === 'all'" @click="profileCategory = 'all'">{{ t.allWorks }}</button>
			<button v-for="entry in communitySections" :key="entry.id" type="button" :aria-pressed="profileCategory === entry.id" @click="profileCategory = entry.id">{{ entry.title }}</button>
		</nav>
		<nav v-else-if="!embedded && !isPublicFeed" :class="$style.tabs" :aria-label="t.community">
			<a v-for="entry in communitySections" :key="entry.id" :href="entry.path" :aria-current="section === entry.id ? 'page' : undefined" @click.prevent="emit('navigate', entry.path)">
				{{ entry.title }}
			</a>
		</nav>
		<p v-if="notice" ref="noticeElement" role="status" tabindex="-1" :class="$style.notice">{{ notice }} <a v-if="signedIn && section !== 'review'" href="/community/mine" @click.prevent="emit('navigate', '/community/mine')">{{ t.viewMine }}</a></p>
		<p v-if="editError" role="alert" :class="$style.error">{{ editError }}</p>
		<Teleport defer to="#misskey-popup-container">
			<div v-if="composerOpen && signedIn" ref="modalLayer" :class="$style.modalLayer" :style="{ zIndex: composerZIndex }" @click.self="closeComposer" @keydown="onComposerKeydown">
				<section ref="composerPanel" role="dialog" aria-modal="true" :aria-label="editing ? t.editWork : t.publish" :class="$style.composer" tabindex="-1">
					<header :class="$style.composerHeader">
						<button type="button" :class="$style.quiet" :aria-label="editing ? t.closeEditor : t.close" :disabled="submitting || !!openingId || choosing || emojiOpen || closingComposer" @click="closeComposer"><i class="ti ti-x" aria-hidden="true"></i></button>
						<h2 v-if="editing" :class="$style.editorTitle">{{ t.editWork }}</h2><span v-if="editing ? editChanged : hasDraft" :class="$style.draftHint">{{ editing ? t.editDraftHint : t.draftHint }}</span>
					</header>
					<p v-if="editing" :class="$style.editHint" role="status">{{ openingId ? t.loadingEdit : editHint }}</p>
					<form :class="$style.form" novalidate @submit.prevent="submit">
						<div :class="$style.editorRow">
							<div :class="$style.composerAvatar"><slot name="composerAvatar"><i class="ti ti-pencil" aria-hidden="true"></i></slot></div>
							<div :class="$style.writingArea">
								<input ref="titleInput" v-model="draft.title" :class="$style.titleInput" :aria-label="t.title" maxlength="100" :placeholder="t.title" :disabled="submitting || !!openingId" required/>
								<textarea ref="contentInput" v-model="draft.text" :aria-label="t.content" rows="5" maxlength="2500" :placeholder="t.writePrompt + '…'" :disabled="submitting || !!openingId" :readonly="emojiOpen"></textarea>
							</div>
						</div>
						<div :class="$style.destinationRow"><label :class="$style.destinationSelect"><i :class="categoryIcon(draft.category)" aria-hidden="true"></i><span>{{ t.destination }}</span><select v-model="draft.category" :aria-label="t.category" :disabled="submitting || !!openingId || choosing || emojiOpen"><option v-for="entry in communitySections" :key="entry.id" :value="entry.id">{{ entry.title }}</option></select></label><span v-if="!editing" :class="$style.publishHint">{{ publicationMode === 'after' ? t.publicVisibility : t.approvalVisibility }}</span></div>
						<ul v-if="files.length" :class="$style.fileList"><li v-for="file in files" :key="file.id"><i :class="categoryIcon(file.type.startsWith('video/') ? 'video' : file.type.startsWith('image/') ? 'image' : 'resource')" aria-hidden="true"></i><span>{{ file.name }}</span><button type="button" :class="$style.quiet" :disabled="submitting || !!openingId || choosing || emojiOpen" :aria-label="`${t.removeFile} ${file.name}`" @click="files = files.filter(f => f.id !== file.id)"><i class="ti ti-x" aria-hidden="true"></i></button></li></ul>
						<div v-if="detailsOpen" :id="detailsId" :class="$style.extraFields"><label>{{ t.model }}<input v-model="draft.model" maxlength="100" :placeholder="t.modelPlaceholder" :disabled="submitting || !!openingId"/></label><label>{{ t.source }}<input ref="sourceInput" v-model="draft.sourceUrl" type="url" maxlength="2000" :placeholder="t.sourcePlaceholder" :disabled="submitting || !!openingId"/></label><label>{{ t.license }}<input v-model="draft.license" maxlength="200" :placeholder="t.licensePlaceholder" :disabled="submitting || !!openingId"/></label></div>
						<label :class="$style.check"><input v-model="rights" type="checkbox" :disabled="submitting || !!openingId"/>{{ t.rights }}</label>
						<p v-if="formError" role="alert" :class="$style.error">{{ formError }}</p><button v-if="editConflict" type="button" :class="$style.secondary" :disabled="submitting || !!openingId" @click="reloadEditor">{{ t.reloadEditor }}</button>
						<footer :class="$style.composerFooter">
							<div :class="$style.composerTools">
								<div :class="$style.iconTools" role="group" :aria-label="t.composerTools">
									<button v-for="tool in uploadTools" :key="tool.kind" type="button" :class="$style.iconButton" :aria-label="tool.label" :title="tool.label" :disabled="submitting || !!openingId || choosing || emojiOpen || files.length >= 16" @click="openUpload(tool.kind)"><i :class="tool.icon" aria-hidden="true"></i></button>
									<button type="button" :class="$style.iconButton" :aria-label="t.existingFiles" :title="t.existingFiles" :disabled="submitting || !!openingId || choosing || emojiOpen || files.length >= 16" @click="chooseFiles"><i class="ti ti-folder" aria-hidden="true"></i></button>
									<button type="button" :class="$style.iconButton" :aria-label="t.emoji" :title="t.emoji" :disabled="submitting || !!openingId || choosing || emojiOpen" @click="insertEmoji"><i class="ti ti-mood-happy" aria-hidden="true"></i></button>
									<button type="button" :class="$style.iconButton" :aria-label="t.insertCode" :title="t.insertCode" :disabled="submitting || !!openingId || choosing || emojiOpen" @click="insertCode"><i class="ti ti-code" aria-hidden="true"></i></button>
									<button type="button" :class="$style.iconButton" :aria-label="t.addSource" :title="t.addSource" :disabled="submitting || !!openingId || choosing || emojiOpen" @click="openSource"><i class="ti ti-arrow-up-right" aria-hidden="true"></i></button>
									<button type="button" :class="$style.iconButton" :aria-label="t.moreDetails" :title="t.moreDetails" :aria-expanded="detailsOpen" :aria-controls="detailsId" :disabled="submitting || !!openingId || choosing || emojiOpen" @click="detailsOpen = !detailsOpen"><i class="ti ti-sparkles" aria-hidden="true"></i></button>
								</div>
								<input ref="uploadInput" type="file" :accept="uploadAccept" multiple hidden @change="uploadSelected"/>
								<span v-if="draft.text" :class="$style.counter">{{ draft.text.length }}/2500</span><button type="submit" :class="$style.primary" :disabled="submitting || !!openingId || choosing || emojiOpen || closingComposer || !!openingId || !!editing && (!editChanged || editConflict)">{{ editing ? submitting ? t.savingChanges : editNeedsReview ? t.saveForReview : t.saveChanges : submitting ? t.submitting : publicationMode === 'after' ? t.submitPublic : t.submit }}</button>
							</div>
							<p :class="$style.uploadHint">{{ choosing ? t.choosing : t.uploadHint }}</p>
						</footer>
					</form>
				</section>
			</div>
		</Teleport>
		<section v-if="section === 'ai'" :class="$style.reserved">
			<i class="ti ti-sparkles" aria-hidden="true"></i><h2>{{ t.aiTitle }}</h2><p>{{ t.aiHint }}</p>
			<ul><li v-for="item in t.aiItems" :key="item"><span>{{ item }}</span><span :class="$style.muted">{{ t.reserved }}</span></li></ul>
			<a href="/community" :class="$style.secondary" @click.prevent="emit('navigate', '/community')">{{ t.aiBack }}</a>
		</section>
		<section v-else-if="!validSection" :class="$style.empty"><h2>{{ t.unknown }}</h2><p>{{ t.unknownHint }}</p></section>
		<section v-else-if="section === 'review' && !moderator" :class="$style.empty"><i class="ti ti-lock" aria-hidden="true"></i><h2>{{ t.forbidden }}</h2></section>
		<section v-else-if="section === 'mine' && !signedIn" :class="$style.empty"><h2>{{ t.loginTitle }}</h2><p>{{ t.loginHint }}</p><button type="button" :class="$style.primary" @click="emit('login')">{{ t.login }}</button></section>
		<div v-else :class="[$style.columns, { [$style.withDiscovery]: isPublicFeed && discoveryOpen && !discoveryCompact }]">
			<Teleport to="body" :disabled="!discoveryCompact">
				<div v-if="isPublicFeed" v-show="discoveryOpen" :id="discoveryId" ref="discoveryLayer" :class="[$style.discovery, { [$style.drawerLayer]: discoveryCompact }]" :style="discoveryCompact ? { zIndex: discoveryZIndex } : undefined" :data-motion="prefer.s.animation" :role="discoveryCompact ? 'dialog' : undefined" :aria-modal="discoveryCompact ? true : undefined" :aria-label="ft.sidebar" data-testid="discovery-drawer" @click.self="closeDiscovery">
					<div ref="discoveryPanel" :class="$style.drawerPanel" tabindex="-1" @keydown="discoveryKeydown">
						<header :class="$style.drawerHeading"><span><i class="ti ti-layout-sidebar-right" aria-hidden="true"></i>{{ ft.sidebar }}</span><button type="button" :class="$style.quiet" :aria-label="ft.closeSidebar" :title="ft.closeSidebar" data-testid="close-discovery" @click="closeDiscovery"><i :class="discoveryCompact ? 'ti ti-x' : 'ti ti-chevron-right'" aria-hidden="true"></i></button></header>
						<div :class="$style.drawerBody"><DiscoverySidebar v-model:query="query" @search="search" @navigate="navigateDiscovery" @login="loginFromDiscovery"/></div>
					</div>
				</div>
			</Teleport>
			<section :class="$style.feed" :aria-label="title" :aria-busy="loading">
				<div :class="[$style.toolbar, { [$style.feedToolbar]: isPublicFeed }]">
					<h1 v-if="isPublicFeed">{{ ft.latest }}</h1><h2 v-else>{{ isCommunity ? t.latest : title }}</h2>
					<nav v-if="isPublicFeed" :class="$style.feedFilters" :aria-label="ft.filters">
						<a v-for="entry in feedSections" :key="entry.id" :href="feedPath(entry.path)" :aria-current="section === entry.id ? 'page' : undefined" @click.prevent="emit('navigate', feedPath(entry.path))">{{ entry.title }}</a>
					</nav>
					<form v-if="!isPublicFeed" :class="$style.search" role="search" @submit.prevent="search">
						<label :class="$style.searchField"><i class="ti ti-search" aria-hidden="true"></i><input v-model="query" :aria-label="t.search" :placeholder="t.searchPlaceholder" maxlength="200"/></label>
						<button type="submit" :class="$style.secondary">{{ t.searchAction }}</button>
					</form>
					<button type="button" :class="[$style.quiet, $style.refresh]" :disabled="loading" :aria-label="isPublicFeed ? ft.refresh : t.refresh" :title="isPublicFeed ? ft.refresh : t.refresh" @click="load()"><i class="ti ti-refresh" aria-hidden="true"></i><span v-if="!isPublicFeed">{{ t.refresh }}</span></button>
					<button v-if="isPublicFeed" ref="discoveryToggle" type="button" :class="[$style.secondary, $style.discoveryToggle]" :aria-controls="discoveryId" :aria-expanded="discoveryOpen" :title="discoveryOpen ? ft.closeSidebar : ft.openSidebar" data-testid="toggle-discovery" @click="toggleDiscovery"><i class="ti ti-layout-sidebar-right" aria-hidden="true"></i>{{ discoveryCompact ? ft.explore : discoveryOpen ? ft.closeSidebar : ft.openSidebar }}</button>
				</div>
				<div v-if="isPublicFeed && activeQuery" :class="$style.searchSummary" role="status"><span>{{ ft.search }} · {{ activeQuery }}</span><button type="button" :class="$style.quiet" @click="clearSearch">{{ ft.clearSearch }}<i class="ti ti-x" aria-hidden="true"></i></button></div>
				<div v-if="!isCommunity" :class="$style.listMeta">
					<label>{{ t.all }}<select v-model="status"><option v-if="section === 'review'" value="unreviewed">{{ t.unreviewed }}</option><option value="all">{{ t.all }}</option><option value="pending">{{ t.pending }}</option><option value="published">{{ t.published }}</option><option value="approved">{{ t.approved }}</option><option value="rejected">{{ t.rejected }}</option><option value="removed">{{ t.removed }}</option><option value="withdrawn">{{ t.withdrawn }}</option></select></label>
				</div>
				<div v-if="loading && !items.length" :class="$style.empty" role="status"><i class="ti ti-loader" aria-hidden="true"></i><p>{{ t.loading }}</p></div>
				<div v-else-if="loadError && !items.length" :class="$style.empty" role="alert"><i class="ti ti-cloud-off" aria-hidden="true"></i><h2>{{ t.loadError }}</h2><p>{{ loadError }}</p><button type="button" :class="$style.secondary" @click="load()">{{ t.retry }}</button></div>
				<div v-else-if="!items.length" :class="$style.empty">
					<i :class="isCommunity ? currentCategory?.icon ?? 'ti ti-layout-grid' : 'ti ti-inbox'" aria-hidden="true"></i>
					<h2>{{ emptyTitle }}</h2><p>{{ emptyHint }}</p>
					<button v-if="section === 'mine'" type="button" :class="$style.secondary" @click="openComposer">{{ t.publish }}</button>
				</div>
				<div v-else :class="[$style.works, { [$style.list]: !isCommunity || section === 'resource' || (isProfile && profileCategory === 'resource') }]">
					<template v-for="work in items" :key="work.id">
						<WorkCard v-if="isCommunity" :work="work"><template v-if="canEdit(work)" #actions><div :class="$style.workActions"><button type="button" :data-edit-work="work.id" :class="[$style.secondary, $style.editAction]" :disabled="!!openingId || !!deletingId" :aria-label="`${t.editWork}: ${work.title}`" @click="openEditor(work)"><i class="ti ti-pencil" aria-hidden="true"></i>{{ openingId === work.id ? t.loadingEditor : t.editWork }}</button><button type="button" :class="[$style.quiet, $style.editAction, $style.deleteAction]" :disabled="!!openingId || !!deletingId" :aria-label="`${t.deleteWork}: ${work.title}`" @click="deleteWork(work)"><i class="ti ti-trash" aria-hidden="true"></i>{{ deletingId === work.id ? t.deletingWork : t.deleteWork }}</button></div></template></WorkCard>
						<article v-else :class="$style.work">
							<div :class="[$style.workBody, { [$style.publicWork]: isCommunity }]">
								<header :class="$style.author"><span :class="$style.avatar" aria-hidden="true">{{ (work.author.name || work.author.username).slice(0, 1) }}</span><div :class="$style.identity"><strong>{{ work.author.name || work.author.username }}</strong><span>@{{ work.author.username }}</span></div><time :datetime="work.submittedAt">{{ formatDate(work.submittedAt) }}</time><div v-if="canEdit(work)" :class="$style.workActions"><button type="button" :data-edit-work="work.id" :class="[$style.secondary, $style.editAction]" :disabled="!!openingId || !!deletingId" :aria-label="`${t.editWork}: ${work.title}`" @click="openEditor(work)"><i class="ti ti-pencil" aria-hidden="true"></i>{{ openingId === work.id ? t.loadingEditor : t.editWork }}</button><button type="button" :class="[$style.quiet, $style.editAction, $style.deleteAction]" :disabled="!!openingId || !!deletingId" :aria-label="`${t.deleteWork}: ${work.title}`" @click="deleteWork(work)"><i class="ti ti-trash" aria-hidden="true"></i>{{ deletingId === work.id ? t.deletingWork : t.deleteWork }}</button></div></header>
								<div v-if="!isCommunity" :class="$style.workMeta"><span>{{ categoryTitle(work.category) }}</span><span v-if="!isCommunity" :class="[$style.status, ['rejected', 'removed'].includes(work.status) ? $style.rejected : null]">{{ work.revisionPending ? t.revisionPending : t[work.status] }}</span></div>
								<h3><a v-if="work.approvedNoteId" :href="`/community/work/${work.id}`" @click.prevent="emit('navigate', `/community/work/${work.id}`)">{{ work.title }}</a><template v-else>{{ work.title }}</template></h3>
								<p :class="$style.excerpt"><Mfm :text="work.text" :plain="true"/></p>
								<p v-if="work.rejectionReason" :class="$style.error">{{ t.reason }}：{{ work.rejectionReason }}</p>
								<a v-if="work.approvedNoteId" :href="`/community/work/${work.id}`" :class="$style.discuss" @click.prevent="emit('navigate', `/community/work/${work.id}`)"><i class="ti ti-message-circle" aria-hidden="true"></i>{{ t.comments }}<span>{{ work.repliesCount }}</span></a>
								<details v-if="!isCommunity" :class="$style.details">
									<summary>{{ t.detail }}</summary><p :class="$style.fullText"><Mfm :text="work.text" :plain="true"/></p>
									<p v-if="work.model">{{ t.model }}：{{ work.model }}</p>
									<p v-if="work.license">{{ t.licenseLabel }}：{{ work.license }}</p>
									<a v-if="safeWebUrl(work.sourceUrl)" :href="safeWebUrl(work.sourceUrl)" target="_blank" rel="noopener noreferrer">{{ t.sourceLabel }}：{{ work.sourceUrl }}</a>
									<div v-for="file in work.files" :key="file.id" :class="$style.reviewMedia">
										<video v-if="file.type.startsWith('video/') && safeWebUrl(file.url)" :src="safeWebUrl(file.url)" controls preload="none" :aria-label="file.name"></video>
										<img v-else-if="file.type.startsWith('image/') && safeWebUrl(file.url)" :src="safeWebUrl(file.url)" :alt="file.name" loading="lazy"/>
										<a v-else-if="safeWebUrl(file.url)" :href="safeWebUrl(file.url)" target="_blank" rel="noopener noreferrer">{{ file.name }}</a>
									</div>
								</details>
								<form v-if="section === 'review' && moderator && ['pending', 'published', 'approved'].includes(work.status)" :class="$style.reviewForm" @submit.prevent="review(work, 'approve')">
									<label :class="$style.check"><input v-model="reviewChecks[work.id]" type="checkbox" :disabled="!!reviewingId"/>{{ t.reviewConfirm }}</label>
									<label>{{ t.reason }}<textarea v-model="reviewReasons[work.id]" rows="2" maxlength="1000" :placeholder="t.reasonPlaceholder" :disabled="!!reviewingId"></textarea></label>
									<label v-if="work.status === 'pending' || work.revisionPending" :class="$style.check"><input v-model="reviewViolations[work.id]" type="checkbox" :disabled="!!reviewingId"/>{{ safety.countViolation }}</label><p>{{ safety.removeHint }}</p>
									<p v-if="reviewErrors[work.id]" role="alert" :class="$style.error">{{ reviewErrors[work.id] }}</p>
									<div :class="$style.reviewActions"><button v-if="work.status !== 'approved' || work.revisionPending" type="submit" :class="$style.primary" :disabled="!!reviewingId">{{ reviewingId === work.id ? t.reviewing : work.revisionPending ? t.approveEdit : work.status === 'published' ? t.confirmPublished : t.approve }}</button><button v-if="work.status === 'pending' || work.revisionPending" type="button" :class="$style.secondary" :disabled="!!reviewingId" @click="review(work, 'reject')">{{ work.revisionPending ? t.rejectEdit : t.reject }}</button><button v-if="['published', 'approved'].includes(work.status)" type="button" :class="[$style.secondary, $style.danger]" :disabled="!!reviewingId" @click="review(work, 'remove')">{{ reviewingId === work.id ? t.reviewing : t.remove }}</button></div>
								</form>
							</div>
						</article>
					</template>
				</div>
				<p v-if="loadError && items.length" role="alert" :class="$style.error">{{ loadError }}</p>
				<button v-if="nextCursor" type="button" :class="[$style.secondary, $style.loadMore]" :disabled="loading" @click="load(true)">{{ loading ? t.loading : t.loadMore }}</button>
			</section>
			<footer v-if="!embedded" :class="$style.communityFooter">
				<details :class="$style.guide">
					<summary>{{ t.process }}<span>{{ t.approvedOnly }}</span></summary>
					<div :class="$style.guideContent"><section><h2>{{ t.process }}</h2><ol><li v-for="step in t.processItems" :key="step">{{ step }}</li></ol></section><section><h2>{{ t.guidelines }}</h2><ul><li v-for="item in t.guideItems" :key="item">{{ item }}</li></ul></section></div>
				</details>
				<nav :class="$style.footerLinks" :aria-label="t.workspace">
					<a href="/community/ai" @click.prevent="emit('navigate', '/community/ai')">{{ t.ai }} · {{ t.reserved }}</a>
					<a v-if="signedIn" href="/community/mine" @click.prevent="emit('navigate', '/community/mine')">{{ t.mine }}</a><template v-if="moderator"><a href="/community/review" @click.prevent="emit('navigate', '/community/review')">{{ t.review }}</a><a href="/admin/users" @click.prevent="emit('navigate', '/admin/users')">{{ t.users }}</a><a href="/admin/abuses" @click.prevent="emit('navigate', '/admin/abuses')">{{ t.reports }}</a></template>
				</nav>
			</footer>
		</div>
	</div>
</main>
</template>

<script setup lang="ts">
import { safetyText as safety } from './safety-copy.js';
import { computed, nextTick, onActivated, onBeforeUnmount, onMounted, onDeactivated, reactive, ref, useId, watch } from 'vue';
import { communitySections, communityText as t, safeWebUrl } from './copy.js';
import WorkCard from './work-card.vue';
import DiscoverySidebar from './discovery-sidebar.vue';
import { feedText as ft } from './feed-copy.js';
import { communityComposeEvent } from './compose.js';
import { communityUpdates, getCommunityUpdateVersion, markCommunityUpdated } from './updates.js';
import { useDiscoveryDrawer } from './use-discovery-drawer.js';
import type { CommunityCategory, CommunityFile, CommunityGateway, CommunitySection, CommunityWork, SubmissionStatus } from './types.js';
import { focusTrap } from '@/utility/focus-trap.js';
import { claimZIndex, confirm } from '@/os.js';
import { emojiPicker } from '@/utility/emoji-picker.js';
import { prefer } from '@/preferences.js';

const props = defineProps<{ section: string; initialQuery?: string; embedded?: boolean; publicationMode?: 'before' | 'after'; profileAuthorId?: string; viewerId?: string; compose?: boolean; composeRequest?: number; signedIn: boolean; moderator: boolean; registrationClosed: boolean; gateway: CommunityGateway; }>();
const emit = defineEmits<{ (event: 'navigate', path: string): void; (event: 'login'): void; (event: 'signup'): void; }>();
const currentCategory = computed(() => communitySections.find(entry => entry.id === props.section));
const isProfile = computed(() => props.section === 'profile');
const isPublicFeed = computed(() => !props.embedded && (props.section === 'all' || !!currentCategory.value));
const profileCategory = ref<CommunityCategory | 'all'>('all');
const isCommunity = computed(() => props.section === 'all' || !!currentCategory.value || isProfile.value);
const validSection = computed(() => isCommunity.value || ['mine', 'review', 'ai'].includes(props.section));
const title = computed(() => props.section === 'all' ? t.community : currentCategory.value?.title ?? (validSection.value ? t[props.section as 'mine' | 'review' | 'ai' | 'profile'] : t.unknown));
const description = computed(() => props.section === 'all' ? '' : validSection.value ? t.descriptions[props.section as Exclude<CommunitySection, 'all'>] : t.unknownHint);
const feedSections = [
	{ id: 'all', title: ft.all, path: '/community' },
	...communitySections.map(entry => ({ ...entry, title: ft[entry.id] })),
];
const titleInput = ref<HTMLInputElement>();
const contentInput = ref<HTMLTextAreaElement>();
const sourceInput = ref<HTMLInputElement>();
const detailsOpen = ref(false);
const detailsId = useId();
const surfaceRoot = ref<HTMLElement>();
const { discoveryId, discoveryLayer, discoveryPanel, discoveryToggle, discoveryCompact, discoveryOpen, discoveryZIndex, closeDiscovery, toggleDiscovery, discoveryKeydown } = useDiscoveryDrawer(surfaceRoot, () => isPublicFeed.value);
const modalLayer = ref<HTMLElement>();
const composerPanel = ref<HTMLElement>();
const composerZIndex = ref(0);
const emojiOpen = ref(false);
const uploadInput = ref<HTMLInputElement>();
const uploadAccept = ref('');
const uploadKind = ref<CommunityCategory>('resource');
const uploadTools = [
	{ kind: 'image', label: t.uploadImages, icon: 'ti ti-photo' },
	{ kind: 'video', label: t.uploadVideos, icon: 'ti ti-video' },
	{ kind: 'resource', label: t.uploadDocuments, icon: 'ti ti-file-upload' },
] as const;
let releaseFocus: (() => void) | undefined;
let returnFocus: HTMLElement | undefined;
const initialPublicQuery = () => isPublicFeed.value ? (props.initialQuery ?? '').trim().slice(0, 200) : '';
const query = ref(initialPublicQuery());
const activeQuery = ref(initialPublicQuery());
const status = ref<SubmissionStatus | 'all' | 'unreviewed'>(props.section === 'review' ? 'unreviewed' : 'all');
const items = ref<CommunityWork[]>([]);
const nextCursor = ref<string | null>(null);
const loading = ref(false);
const loadError = ref('');
const notice = ref('');
const noticeElement = ref<HTMLElement>();
const composerOpen = ref(false);
const submitting = ref(false);
const choosing = ref(false);
const formError = ref('');
const files = ref<CommunityFile[]>([]);
const rights = ref(false);
const editing = ref<CommunityWork | null>(null);
const openingId = ref('');
const deletingId = ref('');
const editError = ref('');
const editConflict = ref(false);
const closingComposer = ref(false);
let editRead: AbortController | undefined;
let editBaseline = '';
let newDraft: { content: typeof draft; files: CommunityFile[]; rights: boolean; details: boolean; } | undefined;
const draft = reactive({ category: (currentCategory.value?.id ?? 'resource') as CommunityCategory, title: '', text: '', model: '', sourceUrl: '', license: '' });
const hasDraft = computed(() => !!(draft.title || draft.text || draft.model || draft.sourceUrl || draft.license || files.value.length));
const canEdit = (work: CommunityWork) => props.signedIn && work.author.id === props.viewerId && (isProfile.value || props.section === 'mine');
const editChanged = computed(() => !!editing.value && JSON.stringify(composerInput()) !== editBaseline);
const editNeedsReview = computed(() => !!editing.value && (editing.value.revisionPending || !['approved', 'published'].includes(editing.value.status) || props.publicationMode !== 'after'));
const editHint = computed(() => editing.value && !['approved', 'published'].includes(editing.value.status) ? t.editPrivateHint : editNeedsReview.value ? t.editReviewHint : t.editPublicHint);
const reviewViolations = reactive<Record<string, boolean>>({});
const reviewChecks = reactive<Record<string, boolean>>({});
const reviewReasons = reactive<Record<string, string>>({});
const reviewErrors = reactive<Record<string, string>>({});
const reviewingId = ref('');
let controller: AbortController | undefined;
let requestId = 0;
let disposed = false;
let submissionFingerprint = '';
let submissionKey = '';
let loadedVersion = getCommunityUpdateVersion();
let active = true;

const emptyTitle = computed(() => activeQuery.value ? t.emptySearch : isProfile.value ? t.profileEmpty : props.section === 'mine' ? t.emptyMine : props.section === 'review' ? t.emptyReview : t.empty);
const emptyHint = computed(() => activeQuery.value ? t.emptySearchHint : isProfile.value ? t.profileEmptyHint : props.section === 'mine' ? t.emptyMineHint : props.section === 'review' ? t.emptyReviewHint : t.emptyHint);
const categoryTitle = (category: CommunityCategory) => communitySections.find(entry => entry.id === category)?.title;
const categoryIcon = (category: CommunityCategory) => communitySections.find(entry => entry.id === category)?.icon;
const formatDate = (date: string) => new Date(date).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });

function errorText(error: unknown) {
	return error instanceof Error && Object.values(t).includes(error.message as never) ? error.message : t.networkError;
}

async function load(append = false) {
	const version = getCommunityUpdateVersion();
	if (disposed) return;
	controller?.abort();
	const current = ++requestId;
	if (!validSection.value || props.section === 'ai' || (props.section === 'mine' && !props.signedIn) || (props.section === 'review' && !props.moderator)) {
		items.value = []; nextCursor.value = null; loading.value = false; return;
	}
	controller = new AbortController();
	loading.value = true;
	loadError.value = '';
	if (!append) {
		items.value = []; nextCursor.value = null;
		for (const id of Object.keys(reviewViolations)) delete reviewViolations[id];
		for (const id of Object.keys(reviewChecks)) delete reviewChecks[id];
		for (const id of Object.keys(reviewErrors)) delete reviewErrors[id];
	}
	try {
		const page = await props.gateway.list(props.section as CommunitySection, { query: activeQuery.value, status: status.value, ...(isProfile.value ? { authorId: props.profileAuthorId, category: profileCategory.value === 'all' ? undefined : profileCategory.value } : {}), cursor: append ? nextCursor.value ?? undefined : undefined }, controller.signal);
		if (current !== requestId || disposed) return;
		// Fail closed: a malformed public response cannot expose pending content.
		if (isCommunity.value && page.items.some(work => !['approved', 'published'].includes(work.status) || !work.approvedNoteId || (isProfile.value ? work.author.id !== props.profileAuthorId || (profileCategory.value !== 'all' && work.category !== profileCategory.value) : props.section !== 'all' && work.category !== props.section))) throw new Error(t.invalidResponse);
		items.value = append ? [...items.value, ...page.items.filter(work => !items.value.some(existing => existing.id === work.id))] : page.items;
		nextCursor.value = page.nextCursor; loadedVersion = version;
	} catch (error) {
		if (current === requestId && !disposed && !(error instanceof Error && error.name === 'AbortError')) loadError.value = errorText(error);
	} finally {
		if (current === requestId && !disposed) loading.value = false;
	}
}

function feedPath(path: string, value = activeQuery.value) {
	return value ? `${path}?${new URLSearchParams({ q: value })}` : path;
}

function search() {
	if (discoveryCompact.value && discoveryOpen.value) closeDiscovery();
	const nextQuery = query.value.trim().slice(0, 200);
	if (isPublicFeed.value && nextQuery !== initialPublicQuery()) {
		const path = feedSections.find(entry => entry.id === props.section)?.path ?? '/community';
		emit('navigate', feedPath(path, nextQuery));
		return;
	}
	activeQuery.value = nextQuery;
	void load();
}

function clearSearch() { query.value = ''; search(); }

function navigateDiscovery(path: string) { if (discoveryCompact.value) closeDiscovery(); emit('navigate', path); }

function loginFromDiscovery() { if (discoveryCompact.value) closeDiscovery(); emit('login'); }

async function openComposer() {
	if (!props.signedIn) { emit('login'); return; }
	if (editing.value) { await closeComposer(); if (editing.value) return; }
	if (currentCategory.value && !hasDraft.value) draft.category = currentCategory.value.id;
	if (!composerOpen.value) returnFocus = window.document.activeElement instanceof HTMLElement ? window.document.activeElement : undefined;
	composerZIndex.value = claimZIndex('low');
	composerOpen.value = true;
	await nextTick();
	contentInput.value?.focus();
}

function composerInput() {
	return { ...draft, title: draft.title.trim(), text: draft.text.trim(), model: draft.model.trim(), license: draft.license.trim(), sourceUrl: draft.sourceUrl.trim(), fileIds: files.value.map(file => file.id) };
}

function restoreNewDraft() {
	editing.value = null; editBaseline = ''; editConflict.value = false; formError.value = '';
	if (newDraft) {
		Object.assign(draft, newDraft.content); files.value = newDraft.files; rights.value = newDraft.rights; detailsOpen.value = newDraft.details;
		newDraft = undefined;
	}
}

async function openEditor(work: CommunityWork, reload = false) {
	if (!canEdit(work) || openingId.value || deletingId.value || submitting.value) return;
	if (!reload && editing.value?.id === work.id && editChanged.value) {
		composerOpen.value = true; composerZIndex.value = claimZIndex('low'); await nextTick(); titleInput.value?.focus(); return;
	}
	if (!reload && editing.value) { await closeComposer(); if (editing.value) return; }
	if (!composerOpen.value) returnFocus = window.document.activeElement instanceof HTMLElement ? window.document.activeElement : undefined;
	editRead?.abort();
	const read = editRead = new AbortController();
	let opened = false;
	openingId.value = work.id; editError.value = '';
	try {
		const latest = await props.gateway.show(work.id, read.signal);
		if (disposed || read.signal.aborted || !canEdit(latest)) return;
		if (!editing.value) newDraft = { content: { ...draft }, files: [...files.value], rights: rights.value, details: detailsOpen.value };
		editing.value = latest;
		Object.assign(draft, { category: latest.category, title: latest.title, text: latest.text, model: latest.model, sourceUrl: latest.sourceUrl, license: latest.license });
		files.value = latest.files.map(file => ({ ...file })); rights.value = false; detailsOpen.value = true;
		editBaseline = JSON.stringify(composerInput()); editConflict.value = false; formError.value = '';
		composerZIndex.value = claimZIndex('low'); composerOpen.value = true; opened = true;
	} catch (error) {
		if (!disposed && !read.signal.aborted) {
			if (reload) formError.value = errorText(error); else editError.value = errorText(error);
		}
	} finally {
		if (editRead === read) {
			openingId.value = '';
			await nextTick();
			if (!disposed && !read.signal.aborted) {
				if (opened && composerOpen.value) titleInput.value?.focus();
				else if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
			}
		}
	}
}

async function reloadEditor() {
	if (!editing.value || openingId.value || submitting.value) return;
	const work = editing.value;
	const { canceled } = await confirm({ type: 'warning', title: t.reloadEditTitle, text: t.reloadEditText });
	if (!canceled && !disposed && editing.value === work) await openEditor(work, true);
}

async function openSource() {
	detailsOpen.value = true;
	await nextTick();
	sourceInput.value?.focus();
}

async function insertCode() {
	if (submitting.value || choosing.value || emojiOpen.value) return;
	const start = contentInput.value?.selectionStart ?? draft.text.length;
	const end = contentInput.value?.selectionEnd ?? start;
	const snippet = '\n```\n' + draft.text.slice(start, end) + '\n```\n';
	const text = draft.text.slice(0, start) + snippet + draft.text.slice(end);
	if (text.length > 2500) { formError.value = t.codeLimit; return; }
	formError.value = '';
	draft.text = text;
	await nextTick();
	contentInput.value?.focus();
	contentInput.value?.setSelectionRange(start + 5, start + 5 + end - start);
}

async function closeComposer() {
	if (submitting.value || choosing.value || emojiOpen.value || openingId.value || closingComposer.value) return;
	if (editing.value && editChanged.value) {
		closingComposer.value = true;
		try {
			const { canceled } = await confirm({ type: 'warning', title: t.discardEditTitle, text: t.discardEditText });
			if (canceled || disposed) return;
		} finally { closingComposer.value = false; }
	}
	composerOpen.value = false;
	if (editing.value) restoreNewDraft();
}

function handleComposeRequest(event: Event) {
	// Only the visible community surface handles a global compose request.
	if (props.embedded || event.defaultPrevented || isProfile.value || !surfaceRoot.value?.isConnected || !surfaceRoot.value.getClientRects().length) return;
	event.preventDefault();
	void openComposer();
}

function onComposerKeydown(event: KeyboardEvent) {
	if (choosing.value || emojiOpen.value) return;
	if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); void closeComposer(); }
	if (event.key !== 'Tab' || !composerPanel.value) return;
	const controls = [...composerPanel.value.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, a[href]')].filter(el => el.getClientRects().length && !el.closest('[inert]'));
	const first = controls[0], last = controls[controls.length - 1];
	if (event.shiftKey && (window.document.activeElement === first || window.document.activeElement === composerPanel.value)) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && window.document.activeElement === last) { event.preventDefault(); first?.focus(); }
}

// Release while the teleported node is still attached; acquire after it renders.
watch([composerOpen, () => props.signedIn], ([open, signedIn]) => {
	if (!open || !signedIn) {
		releaseFocus?.(); releaseFocus = undefined;
		if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
	}
}, { flush: 'sync' });
watch([composerOpen, () => props.signedIn], ([open, signedIn]) => {
	if (open && signedIn && modalLayer.value && !releaseFocus) releaseFocus = focusTrap(modalLayer.value).release;
}, { flush: 'post' });
onMounted(() => window.addEventListener(communityComposeEvent, handleComposeRequest));
onDeactivated(() => { active = false; editRead?.abort(); composerOpen.value = false; releaseFocus?.(); releaseFocus = undefined; });

async function chooseFiles(event: MouseEvent) {
	const trigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined;
	choosing.value = true; formError.value = '';
	try {
		const selected = await props.gateway.chooseFiles(event);
		if (disposed || !composerOpen.value) return;
		const merged = [...files.value, ...selected.filter(file => !files.value.some(item => item.id === file.id))];
		if (merged.length > 16) { formError.value = t.tooManyFiles; return; }
		files.value = merged;
	} catch (error) { formError.value = errorText(error); } finally {
		choosing.value = false;
		await nextTick();
		if (!disposed && composerOpen.value) (trigger?.isConnected && !trigger.matches(':disabled') ? trigger : titleInput.value)?.focus();
	}
}

async function openUpload(kind: CommunityCategory) {
	if (submitting.value || choosing.value || emojiOpen.value) return;
	uploadKind.value = kind;
	uploadAccept.value = kind === 'image' ? 'image/*' : kind === 'video' ? 'video/*' : '.pdf,.txt,.md,.markdown,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.json,.yaml,.yml,.zip,.7z,.tar,.gz,.skill';
	await nextTick();
	uploadInput.value?.click();
}

async function uploadSelected(event: Event) {
	const input = event.target as HTMLInputElement;
	const selected = Array.from(input.files ?? []);
	input.value = '';
	if (!selected.length || submitting.value || choosing.value) return;
	if (files.value.length + selected.length > 16) { formError.value = t.tooManyFiles; return; }
	choosing.value = true; formError.value = '';
	try {
		if (!props.gateway.uploadFiles) throw new Error(t.serviceUnavailable);
		const uploaded = await props.gateway.uploadFiles(selected);
		if (disposed || !composerOpen.value) return;
		if (!files.value.length && uploaded.length) draft.category = uploadKind.value;
		const merged = [...files.value, ...uploaded.filter(file => !files.value.some(item => item.id === file.id))];
		if (merged.length > 16) { formError.value = t.tooManyFiles; return; }
		files.value = merged;
	} catch (error) { if (!disposed) formError.value = errorText(error); } finally { choosing.value = false; await nextTick(); if (!disposed && composerOpen.value) contentInput.value?.focus(); }
}

function insertEmoji(event: MouseEvent) {
	const anchor = event.currentTarget;
	if (!(anchor instanceof HTMLElement) || submitting.value || choosing.value || emojiOpen.value) return;
	let start = contentInput.value?.selectionStart ?? draft.text.length;
	let end = contentInput.value?.selectionEnd ?? start;
	emojiOpen.value = true;
	emojiPicker.show(anchor, emoji => {
		if (disposed || !composerOpen.value) return;
		const value = draft.text.slice(0, start) + emoji + draft.text.slice(end);
		if (value.length > 2500) { formError.value = t.emojiLimit; return; }
		draft.text = value; formError.value = ''; start += emoji.length; end = start;
	}, () => {
		emojiOpen.value = false;
		void nextTick(() => { if (!disposed && composerOpen.value) { contentInput.value?.focus(); contentInput.value?.setSelectionRange(start, end); } });
	});
}

async function submit() {
	if (submitting.value || choosing.value || emojiOpen.value || closingComposer.value || openingId.value || (editing.value && (!editChanged.value || editConflict.value))) return;
	formError.value = '';
	if (!props.signedIn) { emit('login'); return; }
	if (!draft.title.trim()) { formError.value = t.titleRequired; return; }
	if (!draft.text.trim() && !files.value.length) { formError.value = t.contentRequired; return; }
	if (draft.category === 'video' && !files.value.some(file => file.type.startsWith('video/'))) { formError.value = t.videoRequired; return; }
	if (draft.category === 'image' && !files.value.some(file => file.type.startsWith('image/'))) { formError.value = t.imageRequired; return; }
	if (draft.sourceUrl.trim() && (!safeWebUrl(draft.sourceUrl.trim()) || new URL(draft.sourceUrl.trim()).username || new URL(draft.sourceUrl.trim()).password)) { formError.value = t.invalidUrl; return; }
	if (!rights.value) { formError.value = t.rightsRequired; return; }
	submitting.value = true;
	try {
		const input = composerInput();
		if (editing.value) {
			const work = editing.value;
			const result = await props.gateway.update({ ...input, submissionId: work.id, version: work.version });
			if (result.id !== work.id || result.author.id !== work.author.id) throw new Error(t.invalidResponse);
			markCommunityUpdated();
			if (disposed) return;
			notice.value = result.revisionPending ? t.editSubmitted : result.status === 'pending' ? t.editResubmitted : t.editSaved;
			composerOpen.value = false; restoreNewDraft();
			await load();
			await nextTick();
			(surfaceRoot.value?.querySelector<HTMLButtonElement>(`button[data-edit-work="${work.id}"]`) ?? noticeElement.value)?.focus({ preventScroll: true });
			return;
		}
		const fingerprint = JSON.stringify(input);
		if (fingerprint !== submissionFingerprint || !submissionKey) {
			submissionFingerprint = fingerprint;
			submissionKey = crypto.randomUUID();
		}
		const result = await props.gateway.submit({ ...input, idempotencyKey: submissionKey });
		markCommunityUpdated();
		if (disposed) return;
		notice.value = result.status === 'pending' ? t.submitted : ['published', 'approved'].includes(result.status) ? t.submittedPublic : t.submittedExisting;
		Object.assign(draft, { title: '', text: '', model: '', sourceUrl: '', license: '' });
		files.value = []; rights.value = false; composerOpen.value = false;
		submissionFingerprint = ''; submissionKey = '';
		if (props.section === 'mine' || ['published', 'approved'].includes(result.status)) await load();
	} catch (error) {
		if (!disposed) {
			editConflict.value = !!editing.value && error instanceof Error && error.message === t.conflictError;
			formError.value = editConflict.value ? t.editConflict : errorText(error);
		}
	} finally { submitting.value = false; }
}

async function deleteWork(work: CommunityWork) {
	if (!canEdit(work) || deletingId.value || openingId.value || submitting.value) return;
	const trigger = window.document.activeElement instanceof HTMLElement ? window.document.activeElement : undefined;
	deletingId.value = work.id; editError.value = '';
	try {
		const { canceled } = await confirm({ type: 'warning', title: t.deleteWorkTitle, text: work.title + '\n\n' + t.deleteWorkConfirm });
		if (canceled || disposed || !canEdit(work)) return;
		await props.gateway.delete({ submissionId: work.id, version: work.version });
		markCommunityUpdated();
		if (disposed) return;
		if (editing.value?.id === work.id) { composerOpen.value = false; restoreNewDraft(); }
		notice.value = t.workDeleted;
		await load(); await nextTick(); noticeElement.value?.focus({ preventScroll: true });
	} catch (error) { if (!disposed) editError.value = errorText(error); } finally {
		deletingId.value = '';
		await nextTick();
		if (!disposed && trigger?.isConnected) trigger.focus({ preventScroll: true });
	}
}

async function review(work: CommunityWork, decision: 'approve' | 'reject' | 'remove') {
	if (reviewingId.value || !props.moderator) return;
	reviewErrors[work.id] = '';
	if (!reviewChecks[work.id]) { reviewErrors[work.id] = t.reviewConfirmRequired; return; }
	const reason = reviewReasons[work.id]?.trim();
	if (decision !== 'approve' && !reason) { reviewErrors[work.id] = t.reasonRequired; return; }
	reviewingId.value = work.id;
	try {
		if (decision === 'remove' || (decision === 'reject' && reviewViolations[work.id])) {
			const { canceled } = await confirm({ type: 'warning', title: decision === 'remove' ? t.removeConfirmTitle : safety.acceptTitle, text: decision === 'remove' ? `${t.removeConfirmText} ${safety.acceptHint}` : safety.acceptHint });
			if (canceled || disposed) return;
		}
		const result = await props.gateway.review({ submissionId: work.id, version: work.version, decision, recordViolation: decision === 'reject' && !!reviewViolations[work.id], ...(decision !== 'approve' ? { reason } : {}) });
		if (result.id !== work.id || result.revisionPending || result.status !== (decision === 'approve' ? 'approved' : decision === 'remove' ? 'removed' : work.revisionPending ? work.status : 'rejected')) throw new Error(t.invalidResponse);
		markCommunityUpdated();
		if (disposed || props.section !== 'review') return;
		notice.value = decision === 'remove' ? t.removedNotice : t.reviewed;
		await load();
	} catch (error) { if (!disposed && props.section === 'review') reviewErrors[work.id] = errorText(error); } finally { reviewingId.value = ''; }
}

watch(() => props.section, (_section, previousSection) => {
	if (!isPublicFeed.value || !['all', 'video', 'image', 'resource'].includes(previousSection)) { query.value = ''; activeQuery.value = ''; }
	notice.value = ''; editError.value = ''; editRead?.abort(); composerOpen.value = false;
	status.value = props.section === 'review' ? 'unreviewed' : 'all';
});
watch(() => props.profileAuthorId, () => { editRead?.abort(); composerOpen.value = false; profileCategory.value = 'all'; query.value = ''; activeQuery.value = ''; });
watch(() => props.viewerId, () => { editRead?.abort(); composerOpen.value = false; if (editing.value) restoreNewDraft(); });
watch(() => props.initialQuery, () => { if (isPublicFeed.value) query.value = activeQuery.value = initialPublicQuery(); });
watch([() => props.section, () => props.initialQuery, () => props.signedIn, () => props.moderator, () => props.profileAuthorId, profileCategory, status], () => { void load(); }, { immediate: true });
watch([() => props.compose, () => props.signedIn, () => props.composeRequest], () => { if (props.compose && props.signedIn) void openComposer(); }, { immediate: true });
watch(communityUpdates, () => { if (active && !submitting.value && !deletingId.value && !reviewingId.value) void load(); });
onActivated(() => {
	active = true;
	const stale = loadedVersion !== getCommunityUpdateVersion();
	if (!isPublicFeed.value) { if (stale) void load(); return; }
	const restored = initialPublicQuery();
	const changed = activeQuery.value !== restored;
	query.value = activeQuery.value = restored;
	if (changed || stale) void load();
});
onBeforeUnmount(() => { editRead?.abort(); window.removeEventListener(communityComposeEvent, handleComposeRequest); releaseFocus?.(); disposed = true; controller?.abort(); requestId++; });
</script>

<style lang="scss" module>
.embedded.root { height: auto; overflow: visible; }
.embedded .canvas { padding: 0; min-height: 0; }
.danger { color: var(--MI_THEME-error); border: 1px solid currentColor; }
.notice a { text-decoration: underline; font-weight: 600; }
.root { color: var(--MI_THEME-fg); background: var(--MI_THEME-bg); min-width: 0; overflow-y: auto; scroll-padding-block-start: 72px; height: 100%; container-type: inline-size; font-size: 14px; line-height: 1.6; --community-gap: 28px; }
.root.discoveryLocked { overflow: hidden; }
:is(.root, .modalLayer) * { box-sizing: border-box; }
:is(.root, .modalLayer) a { color: inherit; text-decoration: none; text-underline-offset: 4px; }
:is(.root, .modalLayer) button, :is(.root, .modalLayer) input, :is(.root, .modalLayer) select, :is(.root, .modalLayer) textarea { font: inherit; }
:is(.root, .modalLayer) button { cursor: pointer; }
:is(.root, .modalLayer) button:disabled { cursor: not-allowed; opacity: .55; }
:is(.root, .modalLayer) :focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: 3px; }
:is(.root, .modalLayer) ::selection { color: var(--MI_THEME-fgOnAccent); background: var(--MI_THEME-accent); }
:is(.root, .modalLayer) h1, :is(.root, .modalLayer) h2, :is(.root, .modalLayer) h3, :is(.root, .modalLayer) p { margin: 0; }
.account { display: flex; align-items: center; gap: 12px; }
.canvas { width: 100%; min-height: 100%; padding: 24px 32px; }
.canvas.communityCanvas { padding-top: 28px; }
.headerActions { display: flex; align-items: center; gap: 20px; flex-shrink: 0; }
.heading { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 8px 8px 20px; }
.heading h1 { font-size: 24px; font-weight: 700; letter-spacing: -.03em; }
.heading p { color: var(--MI_THEME-fg); margin-top: 12px; font-size: 14px; max-width: 48ch; }
.primary, .secondary, .quiet { display: inline-flex; align-items: center; justify-content: center; gap: 8px; border: 0; min-height: 42px; padding: 9px 16px; border-radius: var(--community-radius-small, 8px); white-space: nowrap; text-decoration: none; }
.primary { background: var(--MI_THEME-accent); color: var(--MI_THEME-fgOnAccent); font-weight: 700; }
/* Galaxy 0x-Sarthak_hungry-penguin-30: directional feedback, adapted to Misskey tokens. */
.primary i:last-child { transition: transform .18s ease-out; }
.primary:hover i:last-child { transform: translateX(3px); }
.primary:active { transform: scale(.98); }
.primary:hover { filter: brightness(.9); }
.searchField:focus-within { border-color: var(--MI_THEME-fg); }
.secondary { background: var(--MI_THEME-buttonBg); color: var(--MI_THEME-fg); }
.secondary:hover, .quiet:hover { background: var(--MI_THEME-buttonHoverBg); }
.quiet { background: transparent; color: var(--MI_THEME-fg); padding-inline: 10px; }
.tabs { display: flex; gap: 8px; position: sticky; top: 0; z-index: 3; padding: 8px 0; background: var(--MI_THEME-bg); }
.tabs a, .profileTabs button { display: inline-flex; flex: 1; align-items: center; justify-content: center; padding: 12px 20px; border-radius: 8px; position: relative; white-space: nowrap; min-height: 48px; }
.tabs a:hover, .profileTabs button:hover { background: var(--MI_THEME-buttonBg); }
.tabs a[aria-current], .profileTabs button[aria-pressed='true'] { font-weight: 700; color: var(--MI_THEME-fg); background: var(--MI_THEME-panel); }
.profileTabs button { border: 0; background: transparent; color: var(--MI_THEME-fg); }
.columns { display: grid; grid-template-columns: minmax(0, 1fr); }
.withDiscovery { grid-template-columns: minmax(0, 1fr) clamp(280px, 26%, 360px); column-gap: var(--community-gap); align-items: start; }
.withDiscovery .feed { grid-column: 1; grid-row: 1; }
.discovery { grid-column: 2; grid-row: 1 / span 2; position: sticky; top: 16px; min-width: 0; }
.discovery:not(.drawerLayer) .drawerPanel { display: flex; flex-direction: column; max-height: calc(100dvh - 96px); }
.discovery:not(.drawerLayer) .drawerHeading { flex-shrink: 0; }
.discovery:not(.drawerLayer) .drawerBody { overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: var(--MI_THEME-divider) transparent; padding: 4px; margin: -4px; }
.drawerHeading { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 44px; margin-bottom: 12px; color: var(--MI_THEME-fg); font-size: 13px; font-weight: 600; span { display: inline-flex; align-items: center; gap: 8px; } button { width: 44px; height: 44px; padding: 0; } i { font-size: 18px; } }
.drawerBody { min-height: 0; min-width: 0; }
.discoveryToggle { min-height: 44px; gap: 8px; font-size: 12px !important; i { font-size: 18px; } }
.drawerLayer { position: fixed; inset: 0; background: rgb(0 0 0 / .32); color: var(--MI_THEME-fg); font: 14px/1.6 var(--community-font, sans-serif); }
.drawerLayer, .drawerLayer * { box-sizing: border-box; }
.drawerLayer :focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: 3px; }
.drawerLayer .drawerPanel { position: absolute; inset: 0 0 0 auto; display: flex; flex-direction: column; width: min(380px, calc(100% - 24px)); height: 100%; background: var(--MI_THEME-bg); border-left: 1px solid var(--MI_THEME-divider); box-shadow: -12px 0 40px rgb(0 0 0 / .1); animation: discoveryEnter 180ms var(--community-ease, ease-out); }
.drawerLayer .drawerHeading { flex: 0 0 auto; margin: 0; padding: max(12px, env(safe-area-inset-top)) 16px 12px; border-bottom: 1px solid var(--MI_THEME-divider); font-size: 14px; }
.drawerLayer .drawerBody { flex: 1; padding: 16px 16px max(16px, env(safe-area-inset-bottom)); overflow-y: auto; overscroll-behavior: contain; container-type: inline-size; }
.drawerLayer[data-motion='false'] .drawerPanel { animation: none; }
@keyframes discoveryEnter { from { transform: translateX(32px); opacity: .65; } to { transform: translateX(0); opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .drawerLayer .drawerPanel { animation: none; } }
.withDiscovery .communityFooter { grid-column: 1; }
.feed { min-width: 0; }
.toolbar, .sectionTitle { display: flex; justify-content: space-between; gap: 16px; align-items: center; }
.toolbar h2, .sectionTitle h2 { font-size: 16px; font-weight: 600; }
.toolbar { padding: 20px 8px; gap: 12px; }
.toolbar h2 { white-space: nowrap; }
.feedToolbar { padding: 0 0 20px; min-height: 68px; gap: 16px; flex-wrap: wrap; }
.feedToolbar h1 { font-size: 24px; font-weight: 700; letter-spacing: -.02em; white-space: nowrap; }
.feedFilters { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; }
.feedFilters a { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 8px 12px; border-radius: 8px; font-size: 13px; white-space: nowrap; }
.feedFilters a:hover { background: var(--MI_THEME-buttonBg); }
.feedFilters a[aria-current] { background: var(--MI_THEME-accentedBg); color: var(--MI_THEME-accent); font-weight: 650; }
.feedToolbar .refresh { margin-left: auto; width: 44px; height: 44px; padding: 0; flex-shrink: 0; }
.searchSummary { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 4px 12px; font-size: 13px; overflow-wrap: anywhere; }
.searchSummary span { min-width: 0; }
.search { display: flex; gap: 8px; margin-left: auto; width: min(100%, 320px); }
.searchField { display: flex; flex: 1; min-width: 0; align-items: center; gap: 10px; padding-left: 13px; background: var(--MI_THEME-panel); border: 1px solid transparent; border-radius: 999px; }
.searchField input { width: 100%; min-width: 0; border: 0 !important; background: transparent !important; }
.listMeta { display: flex; align-items: center; min-height: 54px; padding: 8px 24px; font-size: 13px; color: var(--MI_THEME-fg); gap: 8px; }
.listMeta span, .listMeta label { display: flex; align-items: center; gap: 8px; }
.listMeta select { padding: 6px 8px; }
.empty { background: var(--MI_THEME-panel); border-radius: 16px; min-height: 330px; display: flex; align-items: center; justify-content: center; flex-direction: column; text-align: center; gap: 15px; padding: 40px 24px; }
.empty > i { font-size: 32px; color: var(--MI_THEME-fg); }
.empty h2 { font-size: 18px; }
.empty p { max-width: 45ch; color: var(--MI_THEME-fg); }
.communityFooter { font-size: 13px; padding: 24px 8px; }
.guide summary { cursor: pointer; padding: 12px 0; min-height: 44px; }
.guide summary span { margin-left: 20px; }
.guideContent { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; padding: 20px 0; }
.guideContent h2 { font-size: 14px; font-weight: 600; }
.guideContent ol, .guideContent ul { padding-left: 20px; line-height: 2; }
.footerLinks { display: flex; gap: 24px; flex-wrap: wrap; margin-top: 12px; }
.footerLinks a { display: inline-flex; align-items: center; min-height: 44px; }
.footerLinks a:hover { text-decoration: underline; }
.works { display: grid; grid-template-columns: minmax(0, 1fr); gap: 24px; }
.works.list { grid-template-columns: 1fr; }
.work { min-width: 0; background: var(--MI_THEME-panel); border: 1px solid var(--MI_THEME-divider); border-radius: var(--community-radius, 12px); }
.cover { display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 10px; aspect-ratio: 16 / 9; max-height: 560px; border-radius: 16px; overflow: hidden; margin-top: 16px; background: var(--MI_THEME-buttonBg); position: relative; font-size: 13px; }
.cover.coverEmpty { aspect-ratio: auto; min-height: 72px; flex-direction: row; justify-content: flex-start; padding: 20px; background: var(--MI_THEME-bg); }
.cover.coverEmpty > i { font-size: 20px; }
.cover > i { font-size: 32px; }
.cover img { width: 100%; height: 100%; object-fit: contain; position: absolute; inset: 0; }
.play { position: absolute; inset: auto 14px 14px auto; padding: 8px 12px; background: var(--MI_THEME-panel); border-radius: 8px; }
.list .cover { aspect-ratio: auto; min-height: 64px; flex-direction: row; padding: 14px; justify-content: flex-start; }
.list .cover img { position: static; width: 80px; height: 54px; }
.workBody { padding: 24px; }
.publicWork { padding: 22px 24px 20px 84px; }
.publicWork .author { position: relative; min-height: 28px; margin-bottom: 6px; }
.publicWork .avatar { position: absolute; left: -60px; top: 0; }
.workMeta { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; margin-bottom: 10px; }
.work h3 { font-size: 17px; line-height: 1.5; overflow-wrap: anywhere; }
.excerpt { max-width: 75ch; margin-top: 8px !important; color: var(--MI_THEME-fg); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-wrap; overflow-wrap: anywhere; }
.author { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-bottom: 16px; font-size: 13px; }
.avatar { display: grid; place-items: center; width: 46px; height: 46px; flex-shrink: 0; border-radius: 50%; background: var(--MI_THEME-buttonBg); font-size: 18px; font-weight: 700; }
.identity { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.identity strong { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.identity span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.author time { margin-left: auto; flex-shrink: 0; }
.discuss { display: flex; gap: 8px; align-items: center; margin-top: 12px; min-height: 36px; font-size: 13px; }
.discuss span { margin-left: auto; font-variant-numeric: tabular-nums; }
.workActions { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.deleteAction { color: var(--MI_THEME-fg); i { color: var(--MI_THEME-error); } }
.editAction { flex-shrink: 0; font-size: 13px !important; min-height: 40px; padding: 8px 12px; }
.status { background: var(--MI_THEME-buttonBg); padding: 2px 8px; border-radius: 5px; }
.rejected { color: var(--MI_THEME-error); }
.form { display: grid; gap: 16px; }
.fields { display: grid; grid-template-columns: 1fr 2fr; gap: 18px; }
.form label, .reviewForm > label { display: grid; gap: 7px; font-weight: 500; min-width: 0; }
:is(.root, .modalLayer) input:not([type='checkbox'], [type='range']), :is(.root, .modalLayer) select, :is(.root, .modalLayer) textarea { background: var(--MI_THEME-panel); color: var(--MI_THEME-fg); border: 1px solid var(--MI_THEME-inputBorder); border-radius: 12px; padding: 10px 12px; width: 100%; min-width: 0; caret-color: var(--MI_THEME-accent); }
:is(.root, .modalLayer) input::placeholder, :is(.root, .modalLayer) textarea::placeholder { color: var(--MI_THEME-fg); opacity: 1; }
:is(.root, .modalLayer) textarea { resize: vertical; line-height: 1.65; }
.form .check, .reviewForm .check { display: flex; align-items: flex-start; gap: 10px; font-weight: 400; }
.check input { width: 18px; height: 18px; flex-shrink: 0; margin: 3px 0 0; accent-color: var(--MI_THEME-accent); }
.muted { color: var(--MI_THEME-fg); font-size: 13px; margin-top: 8px !important; }
.fileList { padding: 0; list-style: none; }
.fileList li { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.fileList span { flex: 1; overflow-wrap: anywhere; min-width: 0; }
.error { color: var(--MI_THEME-error); margin-top: 10px !important; overflow-wrap: anywhere; }
.notice { background: var(--MI_THEME-panel); border-radius: 8px; padding: 14px 18px; margin: 16px 24px !important; }
.details { margin-top: 15px; overflow-wrap: anywhere; }
.details summary { cursor: pointer; min-height: 40px; }
.fullText { white-space: pre-wrap; padding-block: 12px; }
.reviewMedia { margin-block: 12px; }
.reviewMedia video, .reviewMedia img { max-width: 100%; max-height: 420px; display: block; }
.reviewForm { display: grid; gap: 15px; margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--MI_THEME-divider); }
.reviewActions { display: flex; gap: 10px; flex-wrap: wrap; }
.loadMore { margin-top: 22px; width: 100%; }
.reserved { width: 100%; padding: 40px; background: var(--MI_THEME-panel); border-radius: var(--MI-radius); }
.reserved > i { font-size: 30px; }
.reserved h2 { font-size: 24px; margin-top: 16px; }
.reserved p { margin-top: 12px; max-width: 55ch; }
.reserved ul { padding: 0; list-style: none; margin-block: 28px; }
.reserved li { display: flex; justify-content: space-between; gap: 20px; padding-block: 14px; border-bottom: 1px solid var(--MI_THEME-divider); }
@container (max-width: 1100px) {
 .feedToolbar { gap: 4px 12px; }
 .feedFilters { order: 3; width: 100%; }
}
@container (max-width: 900px) {
 .withDiscovery { grid-template-columns: minmax(0, 1fr); gap: 16px; }
 .discovery { position: static; grid-column: 1; grid-row: 1; }
 .withDiscovery .feed { grid-row: 2; }
 .withDiscovery .communityFooter { grid-row: 3; }
}
@container (max-width: 600px) {
 .profileTabs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); position: static; }
 .canvas { padding: 12px; }
 .heading { padding: 4px 4px 12px; flex-wrap: wrap; }
 .heading h1 { font-size: 18px; }
 .heading p { margin-top: 8px; }
 .headerActions, .account { gap: 4px; }
 .tabs { padding: 6px 0; gap: 4px; }
 .tabs a { padding: 10px 4px; font-size: 12px; min-height: 44px; }
 .toolbar { padding: 12px 4px; flex-wrap: wrap; }
 .toolbar h2 { flex: 1; }
 .feedToolbar { padding: 0 2px 12px; }
 .feedToolbar h1 { font-size: 18px; }
 .feedFilters { gap: 2px; }
 .feedFilters a { padding-inline: 10px; font-size: 12px; }
 .search { order: 3; width: 100%; }
 .fields, .guideContent { grid-template-columns: 1fr; }
 .reserved, .workBody { padding: 20px 16px; }
 .publicWork { padding-left: 72px; }
 .publicWork .avatar { left: -56px; width: 42px; height: 42px; }
 .identity { flex-direction: column; gap: 0; }
 .author { align-items: flex-start; gap: 8px; }
 .author time { font-size: 12px; }
 .work h3 { font-size: 16px; }
 .sectionTitle { align-items: flex-start; flex-wrap: wrap; }
 .empty { min-height: 280px; padding: 32px 20px; }
 .communityFooter { padding: 20px 4px; }
 .guide summary span { display: block; margin: 6px 0 0 16px; }
 .root .primary, .root .secondary, .root .quiet { min-height: 44px; }
 .search input { font-size: 16px; }
}

.modalLayer { position: fixed; inset: 0; overflow-y: auto; overscroll-behavior: contain; padding: max(24px, 6vh) 20px 24px; background: rgb(0 0 0 / .35); color: var(--MI_THEME-fg); font-size: 14px; line-height: 1.6; }
.composer { width: min(100%, 640px); margin: 0 auto; padding: 10px 20px 12px; border-radius: 16px; background: var(--MI_THEME-panel); }
.composerHeader { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
.editorTitle { font-size: 17px; margin: 0; }
.editHint { margin: -6px 0 18px !important; padding: 12px 14px; border-radius: 8px; background: var(--MI_THEME-buttonBg); font-size: 13px; }
.composerHeader > button { width: 44px; height: 44px; padding: 0; font-size: 22px; }
.draftHint { margin-left: auto; font-size: 12px; }
.composer .form { gap: 12px; }
.editorRow { display: grid; grid-template-columns: 44px minmax(0, 1fr); gap: 12px; }
.composerAvatar { width: 44px; height: 44px; display: grid; place-items: center; border-radius: 50%; background: var(--MI_THEME-buttonBg); font-size: 22px; }
.composer .writingArea input, .composer .writingArea textarea { border: 0; border-bottom: 1px solid transparent; border-radius: 0; padding: 8px 0; background: transparent; }
.composer .writingArea input:focus-visible, .composer .writingArea textarea:focus-visible { outline: none; border-bottom-color: var(--MI_THEME-accent); }
.composer .writingArea .titleInput { font-size: 14px; font-weight: 400; }
.composer .writingArea textarea { font-size: 21px; min-height: 170px; max-height: 50vh; line-height: 1.6; }
.destinationRow { margin-left: 56px; display: flex; align-items: center; gap: 8px 16px; flex-wrap: wrap; }
.destinationSelect { display: inline-flex !important; align-items: center; gap: 5px !important; font-size: 13px; max-width: 100%; }
.composer .destinationSelect select { width: auto; max-width: 100%; border: 0; padding: 8px 2px; background: transparent; min-height: 44px; font-weight: 600; }
.publishHint { font-size: 12px; }
.extraFields { display: grid; gap: 14px; margin-left: 56px; }
.composer .check { margin-left: 56px; font-size: 12px; }
.composer .error, .composer .fileList { margin-left: 56px; }
.composerFooter { border-top: 1px solid var(--MI_THEME-divider); padding-top: 8px; }
.composerTools { display: flex; align-items: center; gap: 12px; }
.iconTools { display: flex; align-items: center; flex-wrap: wrap; gap: 2px; }
.uploadHint { font-size: 12px; margin-top: 10px !important; color: var(--MI_THEME-fg); }
.resourceFiles { list-style: none; margin: 12px 0; padding: 0; }
.resourceFiles a { display: inline-flex; gap: 8px; align-items: center; min-height: 44px; overflow-wrap: anywhere; }
.resourceFiles a:hover { text-decoration: underline; }
.iconButton { display: grid; place-items: center; width: 44px; height: 44px; flex-shrink: 0; padding: 0; background: transparent; border: 0; border-radius: 50%; color: var(--MI_THEME-fg); font-size: 23px !important; }
.iconButton:hover { background: var(--MI_THEME-buttonBg); }
.iconButton[aria-expanded='true'] { background: var(--MI_THEME-buttonBg); }
.composerTools .primary { margin-left: auto; min-height: 42px; padding-inline: 18px; }
.counter { margin-left: auto; font-size: 12px; font-variant-numeric: tabular-nums; }
@media (max-width: 600px) {
 .modalLayer { padding: 12px; padding-top: max(12px, env(safe-area-inset-top)); }
 .composer { padding: 8px 12px 12px; }
 .composerHeader { margin-bottom: 12px; }
 .editorRow { grid-template-columns: 36px minmax(0, 1fr); gap: 10px; }
 .composerAvatar { width: 36px; height: 36px; font-size: 18px; }
 .composer .writingArea .titleInput, .extraFields input { font-size: 16px; }
 .composer .writingArea textarea { font-size: 19px; }
 .destinationRow, .extraFields, .composer .check, .composer .error, .composer .fileList { margin-left: 0; }
 .destinationRow { gap: 0 12px; }
 .iconTools { gap: 0; }
 .composerTools { gap: 4px; flex-wrap: wrap; }
 .composerTools .primary { padding-inline: 12px; min-height: 44px; }
 .counter { display: none; }
}

@media (prefers-reduced-motion: reduce) { .primary, .primary i:last-child { transition: none; transform: none !important; } }
</style>
