<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="[$style.root, { [$style.iconOnly]: iconOnly }]">
	<div :class="$style.body">
		<div :class="$style.top">
			<button v-tooltip.noDelay.right="instance.name ?? i18n.ts.instance" class="_button" :class="$style.instance" :aria-label="instance.name ?? i18n.ts.instance" @click="openInstanceMenu">
				<img :src="instance.iconUrl || '/favicon.ico'" alt="" :class="$style.instanceIcon"/>
				<span v-if="!iconOnly" :class="$style.instanceName">{{ instance.name ?? i18n.ts.instance }}</span>
			</button>
			<button v-if="!forceIconOnly && !props.asDrawer" class="_button" :class="$style.collapse" :aria-label="iconOnly ? workbenchText.expand : workbenchText.collapse" :title="iconOnly ? workbenchText.expand : workbenchText.collapse" @click="toggleIconOnly"><i :class="iconOnly ? 'ti ti-layout-sidebar-left-expand' : 'ti ti-layout-sidebar-left-collapse'" aria-hidden="true"></i></button>
		</div>
		<div :class="$style.middle">
			<div v-if="!iconOnly" :class="$style.groupLabel">{{ workbenchText.creation }}</div>
			<MkCommunityNav :compact="iconOnly"/>
			<div v-if="!iconOnly" :class="$style.groupLabel">{{ workbenchText.personal }}</div>
			<MkA v-if="$i" :class="$style.item" :activeClass="$style.active" :to="`/@${$i.username}`" :aria-label="communityText.profile"><i :class="$style.itemIcon" class="ti ti-user ti-fw" aria-hidden="true"></i><span :class="$style.itemText">{{ communityText.profile }}</span></MkA>
			<MkA v-tooltip.noDelay.right="communityText.mine" :class="[$style.item, { [$style.active]: activeCommunityModule === 'mine' }]" to="/community/mine" :aria-label="communityText.mine" :aria-current="activeCommunityModule === 'mine' ? 'page' : undefined"><i :class="$style.itemIcon" class="ti ti-folders ti-fw" aria-hidden="true"></i><span :class="$style.itemText">{{ communityText.mine }}</span></MkA>
			<MkA v-if="$i != null && ($i.isAdmin || $i.isModerator)" v-tooltip.noDelay.right="communityText.review" :class="[$style.item, { [$style.active]: activeCommunityModule === 'review' }]" to="/community/review" :aria-label="communityText.review" :aria-current="activeCommunityModule === 'review' ? 'page' : undefined"><i :class="$style.itemIcon" class="ti ti-shield-check ti-fw" aria-hidden="true"></i><span :class="$style.itemText">{{ communityText.review }}</span></MkA>
			<div v-if="!iconOnly" :class="$style.groupLabel">{{ workbenchText.tools }}</div>
			<div v-else :class="$style.divider"></div>
			<MkA v-tooltip.noDelay.right="i18n.ts.timeline" :class="$style.item" :activeClass="$style.active" to="/timeline" exact>
				<i :class="$style.itemIcon" class="ti ti-home ti-fw" style="view-transition-name: navbar-homeIcon;"></i><span :class="$style.itemText">{{ i18n.ts.timeline }}</span>
			</MkA>
			<template v-for="item in prefer.r.menu.value">
				<div v-if="item === '-'" :class="$style.divider"></div>
				<component
					:is="navbarItemDef[item].to ? 'MkA' : 'button'"
					v-else-if="navbarItemDef[item] && (navbarItemDef[item].show == null || navbarItemDef[item].show.value !== false)"
					v-tooltip.noDelay.right="navbarItemDef[item].title"
					class="_button"
					:class="[$style.item]"
					:activeClass="$style.active"
					:to="navbarItemDef[item].to"
					v-on="navbarItemDef[item].action ? { click: navbarItemDef[item].action } : {}"
				>
					<i class="ti-fw" :class="[$style.itemIcon, navbarItemDef[item].icon]" :style="{ viewTransitionName: 'navbar-item-' + item }"></i><span :class="$style.itemText">{{ navbarItemDef[item].title }}</span>
					<span v-if="navbarItemDef[item].indicated" :class="$style.itemIndicator" class="_blink">
						<span v-if="navbarItemDef[item].indicateValue" class="_indicateCounter" :class="$style.itemIndicateValueIcon">{{ navbarItemDef[item].indicateValue }}</span>
						<i v-else class="_indicatorCircle"></i>
					</span>
				</component>
			</template>
			<div :class="$style.divider"></div>
			<MkA v-if="$i != null && ($i.isAdmin || $i.isModerator)" v-tooltip.noDelay.right="i18n.ts.controlPanel" :class="$style.item" :activeClass="$style.active" to="/admin">
				<i :class="$style.itemIcon" class="ti ti-dashboard ti-fw" style="view-transition-name: navbar-controlPanel;"></i><span :class="$style.itemText">{{ i18n.ts.controlPanel }}</span>
			</MkA>
			<button class="_button" :class="$style.item" @click="more">
				<i :class="$style.itemIcon" class="ti ti-grid-dots ti-fw" style="view-transition-name: navbar-more;"></i><span :class="$style.itemText">{{ i18n.ts.more }}</span>
				<span v-if="otherMenuItemIndicated" :class="$style.itemIndicator" class="_blink"><i class="_indicatorCircle"></i></span>
			</button>
			<MkA v-tooltip.noDelay.right="i18n.ts.settings" :class="$style.item" :activeClass="$style.active" to="/settings">
				<i :class="$style.itemIcon" class="ti ti-settings ti-fw" style="view-transition-name: navbar-settings;"></i><span :class="$style.itemText">{{ i18n.ts.settings }}</span>
			</MkA>
		</div>
		<div :class="$style.bottom">
			<div :class="$style.utilities">
				<button v-if="showWidgetButton" v-tooltip.noDelay.right="i18n.ts.widgets" class="_button" :class="$style.utility" :aria-label="i18n.ts.widgets" @click="() => emit('widgetButtonClick')"><i class="ti ti-apps" aria-hidden="true"></i></button>
				<button v-tooltip.noDelay.right="i18n.ts.realtimeMode" class="_button" :class="[$style.utility, { [$style.on]: store.r.realtimeMode.value }]" :aria-label="i18n.ts.realtimeMode" @click="toggleRealtimeMode"><i :class="store.r.realtimeMode.value ? 'ti ti-bolt' : 'ti ti-bolt-off'" aria-hidden="true"></i></button>
				<button v-if="prefer.r.showNavbarSubButtons.value" v-tooltip.noDelay.right="i18n.ts.settings" class="_button" :class="$style.utility" :aria-label="i18n.ts.settings" @click="menuEdit"><i class="ti ti-settings-2" aria-hidden="true"></i></button>
			</div>
			<button v-tooltip.noDelay.right="communityText.publish" class="_button" :class="[$style.post]" data-testid="open-post-form" :aria-label="communityText.publish" @click="requestCommunityComposer(() => router.push('/community/compose'))">
				<i class="ti ti-pencil ti-fw" :class="$style.postIcon" aria-hidden="true"></i><span :class="$style.postText">{{ communityText.publish }}</span>
			</button>
			<button v-if="$i != null" v-tooltip.noDelay.right="`${i18n.ts.account}: @${$i.username}`" class="_button" :class="[$style.account]" @click="openAccountMenu">
				<MkAvatar :user="$i" :class="$style.avatar" style="view-transition-name: navbar-avatar;"/><MkAcct class="_nowrap" :class="$style.acct" :user="$i"/>
			</button>
		</div>
	</div>

</div>
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { openInstanceMenu } from './common.js';
import * as os from '@/os.js';
import { navbarItemDef } from '@/navbar.js';
import { store } from '@/store.js';
import { i18n } from '@/i18n.js';
import MkCommunityNav from '@/components/MkCommunityNav.vue';
import { instance } from '@/instance.js';
import { getHTMLElementOrNull } from '@/utility/get-dom-node-or-null.js';
import { useRouter } from '@/router.js';
import { prefer } from '@/preferences.js';
import { getAccountMenu } from '@/accounts.js';
import { $i } from '@/i.js';
import { communityText } from '@/pages/community/copy.js';
import { requestCommunityComposer } from '@/pages/community/compose.js';
import { workbenchText } from '@/utility/creation-pages.js';

const router = useRouter();
const activeCommunityModule = computed(() => {
	const current = router.currentRef.value;
	return current.route.path === '/community/:module' ? current.props.get('module') : null;
});

const props = defineProps<{
	showWidgetButton?: boolean;
	asDrawer?: boolean;
}>();

const emit = defineEmits<{
	(ev: 'widgetButtonClick'): void;
}>();

const forceIconOnly = ref(!props.asDrawer && window.innerWidth <= 1279);
const iconOnly = computed(() => {
	return !props.asDrawer && (forceIconOnly.value || (store.r.menuDisplay.value === 'sideIcon'));
});

const otherMenuItemIndicated = computed(() => {
	for (const def in navbarItemDef) {
		if (prefer.r.menu.value.includes(def)) continue;
		if (navbarItemDef[def].indicated) return true;
	}
	return false;
});

function calcViewState() {
	forceIconOnly.value = window.innerWidth <= 1279;
}

window.addEventListener('resize', calcViewState);
onBeforeUnmount(() => window.removeEventListener('resize', calcViewState));

watch(store.r.menuDisplay, () => {
	calcViewState();
});

function toggleIconOnly() {
	if (window.document.startViewTransition && prefer.s.animation) {
		window.document.startViewTransition(() => {
			store.set('menuDisplay', iconOnly.value ? 'sideFull' : 'sideIcon');
		});
	} else {
		store.set('menuDisplay', iconOnly.value ? 'sideFull' : 'sideIcon');
	}
}

function toggleRealtimeMode(ev: PointerEvent) {
	os.popupMenu([{
		type: 'label',
		text: i18n.ts.realtimeMode,
	}, {
		text: store.s.realtimeMode ? i18n.ts.turnItOff : i18n.ts.turnItOn,
		icon: store.s.realtimeMode ? 'ti ti-bolt-off' : 'ti ti-bolt',
		action: () => {
			store.set('realtimeMode', !store.s.realtimeMode);
			window.location.reload();
		},
	}], ev.currentTarget ?? ev.target);
}

async function openAccountMenu(ev: PointerEvent) {
	const menuItems = await getAccountMenu({
		withExtraOperation: true,
	});

	os.popupMenu(menuItems, ev.currentTarget ?? ev.target);
}

async function more(ev: PointerEvent) {
	const target = getHTMLElementOrNull(ev.currentTarget ?? ev.target);
	if (!target) return;
	const { dispose } = await os.popupAsyncWithDialog(import('@/components/MkLaunchPad.vue').then(x => x.default), {
		anchorElement: target,
	}, {
		closed: () => dispose(),
	});
}

function menuEdit() {
	router.push('/settings/navbar');
}
</script>

<style lang="scss" module>
.root {
	--nav-width: 232px;
	--nav-icon-only-width: 72px;
	flex: 0 0 var(--nav-width);
	width: var(--nav-width);
	min-height: 0;
	box-sizing: border-box;
	background: var(--MI_THEME-navBg);
	color: var(--MI_THEME-navFg);
}
.body { display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: hidden; }
.top { display: flex; align-items: center; gap: 4px; flex: 0 0 auto; min-height: 72px; padding: 8px 12px; box-sizing: border-box; }
.instance { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1; min-height: 44px; text-align: left; border-radius: 8px; }
.instanceIcon { flex: 0 0 auto; width: 32px; height: 32px; border-radius: 8px; }
.instanceName { font-size: 14px; line-height: 1.4; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.collapse, .utility { display: grid; place-items: center; flex: 0 0 auto; width: 36px; height: 44px; border-radius: 8px; color: var(--MI_THEME-navFg); }
.collapse i, .utility i { font-size: 18px; }
.middle { flex: 1; min-height: 0; padding: 0 12px 12px; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: var(--MI_THEME-divider) transparent; }
.groupLabel { padding: 20px 12px 6px; color: color-mix(in srgb, var(--MI_THEME-navFg), var(--MI_THEME-navBg) 25%); font-size: 12px; line-height: 1.5; font-weight: 500; &:first-child { padding-top: 0; } }
.item { position: relative; display: flex; align-items: center; gap: 12px; width: 100%; min-height: 44px; padding: 8px 12px; box-sizing: border-box; border-radius: 8px; color: var(--MI_THEME-navFg); font-size: 14px; line-height: 1.5; text-align: left; transition: background-color 160ms ease, color 160ms ease; }
.itemIcon { flex: 0 0 20px; width: 20px; font-size: 20px; }
.itemText { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item:hover, .instance:hover, .collapse:hover, .utility:hover, .account:hover { background: var(--MI_THEME-buttonHoverBg); text-decoration: none; }
.active { background: var(--MI_THEME-accentedBg); color: var(--MI_THEME-accent); font-weight: 650; }
.itemIndicator { flex: 0 0 auto; margin-left: auto; color: var(--MI_THEME-navIndicator); font-size: 8px; &:has(.itemIndicateValueIcon) { animation: none; font-size: 11px; } }
.itemIndicateValueIcon { font-variant-numeric: tabular-nums; }
.divider { margin: 10px 12px; border-top: 1px solid var(--MI_THEME-divider); }
.bottom { flex: 0 0 auto; padding: 0 12px 12px; background: var(--MI_THEME-navBg); }
.utilities { display: flex; align-items: center; gap: 4px; border-top: 1px solid var(--MI_THEME-divider); padding-block: 4px; }
.on { color: var(--MI_THEME-accent); }
.post { display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; min-height: 44px; padding: 8px 12px; box-sizing: border-box; border-radius: 8px; color: var(--MI_THEME-fgOnAccent); background: var(--MI_THEME-accent); font-size: 14px; font-weight: 650; &:hover { background: color-mix(in srgb, var(--MI_THEME-accent), var(--MI_THEME-fg) 12%); } }
.postIcon { font-size: 18px; }
.account { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 48px; padding: 8px; margin-top: 6px; box-sizing: border-box; text-align: left; border-radius: 8px; }
.avatar { flex: 0 0 auto; width: 30px; height: 30px; }
.acct { min-width: 0; overflow: hidden; text-overflow: ellipsis; font-size: 13px; }
.item, .instance, .collapse, .utility, .post, .account { &:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: -2px; } }
.post:focus-visible { outline-color: var(--MI_THEME-fgOnAccent); outline-offset: -4px; }
.iconOnly {
	flex-basis: var(--nav-icon-only-width); width: var(--nav-icon-only-width);
	.top { flex-direction: column; min-height: 64px; padding: 8px 12px; }
	.instance { justify-content: center; width: 48px; flex: none; }
	.middle { padding-inline: 8px; }
	.item { justify-content: center; min-height: 46px; padding: 12px; }
	.itemText, .postText, .acct { display: none; }
	.itemIndicator { position: absolute; top: 4px; right: 2px; }
	.divider { margin-inline: 8px; }
	.bottom { padding-inline: 8px; }
	.utilities { justify-content: center; flex-wrap: wrap; gap: 0; }
	.utility { width: 44px; }
	.account { justify-content: center; }
}
@media (prefers-reduced-motion: reduce) { .item { transition: none; } }
</style>
