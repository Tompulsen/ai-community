<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<XSetup v-if="instance.requireSetup"/>
<div v-else :class="$style.home" class="_selectable" :lang="homeLanguage" data-testid="project-home">
	<header :class="$style.header">
		<MkA to="/" :class="$style.brand" :aria-label="brandName"><img :src="logoUrl" alt=""/><span>{{ brandName }}</span></MkA>
		<nav :class="$style.navigation" :aria-label="homeText.navigation">
			<MkA v-for="item in creationPages" :key="item.key" :to="`/create/${item.key}`" :class="$style.navLink" :data-testid="`home-create-${item.key}`"><i :class="item.icon" aria-hidden="true"></i>{{ item.title }}</MkA>
		</nav>
		<div :class="$style.account">
			<select :value="languageSelection" :class="$style.language" :aria-label="homeText.language" data-testid="home-language" @change="changeLanguage">
				<option v-if="!languageSelection" value="" disabled>{{ homeText.language }}</option>
				<option value="zh-CN">中文</option>
				<option value="en-US" lang="en">English</option>
			</select>
			<template v-if="$i">
				<MkA v-if="$i.isAdmin" to="/admin/homepage" :class="$style.login">{{ homeText.admin }}</MkA>
				<MkA :to="`/@${$i.username}`" :class="$style.signup">{{ homeText.account }} <i class="ti ti-arrow-up-right" aria-hidden="true"></i></MkA>
			</template>
			<template v-else>
				<button class="_button" :class="$style.login" :disabled="openingAccount" @click="openAccount('signin')">{{ homeText.login }}</button>
				<button v-if="!instance.disableRegistration" class="_button" :class="$style.signup" :disabled="openingAccount" @click="openAccount('signup')">{{ homeText.signup }} <i class="ti ti-arrow-up-right" aria-hidden="true"></i></button>
			</template>
		</div>
	</header>
	<main :class="$style.hero">
		<section :class="$style.intro">
			<h1>{{ homeText.title }}<br><span>{{ homeText.titleAccent }}</span></h1>
			<p :class="$style.description">{{ homeText.description }}<br>{{ homeText.descriptionMore }}</p>
			<div :class="$style.community">
				<MkA to="/community" :class="$style.communityButton" data-testid="home-community">{{ homeText.community }} <i class="ti ti-arrow-up-right" aria-hidden="true"></i></MkA>
				<span :class="$style.communityHint"><i class="ti ti-door-enter" aria-hidden="true"></i>{{ homeText.communityHint }}</span>
			</div>
			<p :class="$style.communityDetail">{{ homeText.communityDetail }}</p>
		</section>
		<HomeShowcase :imageUrl="displayImageUrl" :logoUrl="logoUrl" :mode="instance.clientOptions.homeShowcaseMode"/>
	</main>
	<footer :class="$style.footer"><span>{{ homeText.footer }}</span><span>{{ homeText.footerNote }}</span></footer>
</div>
</template>

<script lang="ts" setup>
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref } from 'vue';
import { lang, url as siteUrl } from '@@/js/config.js';
import HomeShowcase from './home/showcase.vue';
import XSetup from './welcome.setup.vue';
import { homeLanguage, homeText } from './home/copy.js';
import { normalizeHomeImageUrl } from './home/image.js';
import { instance, fetchInstance } from '@/instance.js';
import { $i } from '@/i.js';
import { creationPages } from '@/utility/creation-pages.js';
import { definePage } from '@/page.js';
import { prefer } from '@/preferences.js';
import { getStaticImageUrl } from '@/utility/media-proxy.js';
import * as os from '@/os.js';
import { miLocalStorage } from '@/local-storage.js';

const languageSelection = lang === 'zh-CN' || lang === 'en-US' ? lang : '';
const brandName = computed(() => instance.name || homeText.brand);
const logoUrl = computed(() => instance.iconUrl || '/favicon.ico');
const imageUrl = computed(() => normalizeHomeImageUrl(instance.mascotImageUrl, siteUrl));
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
const reduceMotion = ref(motionPreference.matches);
const updateMotion = () => { reduceMotion.value = motionPreference.matches; };
motionPreference.addEventListener('change', updateMotion);
const displayImageUrl = computed(() => imageUrl.value && (prefer.s.disableShowingAnimatedImages || reduceMotion.value) ? getStaticImageUrl(imageUrl.value) : imageUrl.value);
const openingAccount = ref(false);
let refreshing = false;
let accountRequest = 0;
let disposeAccount: (() => void) | undefined;

async function changeLanguage(event: Event) {
	const selected = (event.target as HTMLSelectElement).value;
	if ((selected !== 'zh-CN' && selected !== 'en-US') || selected === lang) return;
	try {
		miLocalStorage.setItem('lang', selected);
		// Reload the native locale bundle too, so login and signup use the same language.
		window.location.reload();
	} catch {
		(event.target as HTMLSelectElement).value = languageSelection;
		await os.alert({ type: 'error', text: homeText.languageError });
	}
}

async function refresh() {
	if (refreshing) return;
	refreshing = true;
	try { await fetchInstance(true); } catch { /* Keep the cached branding available offline. */ } finally { refreshing = false; }
}

async function openAccount(kind: 'signin' | 'signup') {
	if (openingAccount.value || $i || (kind === 'signup' && instance.disableRegistration)) return;
	const request = ++accountRequest;
	openingAccount.value = true;
	try {
		const component = await accountDialogLoaders[kind]();
		if (request !== accountRequest) return;
		const { dispose } = await os.popupAsyncWithDialog(Promise.resolve(component.default), { autoSet: true }, {
			closed: () => { dispose(); if (request === accountRequest) { openingAccount.value = false; disposeAccount = undefined; } },
		});
		if (request !== accountRequest) { dispose(); return; }
		disposeAccount = dispose;
	} catch {
		if (request !== accountRequest) return;
		openingAccount.value = false;
		await os.alert({ type: 'error', text: homeText.loginError });
	}
}

// Keep each import in its own loader so production preloads include that dialog's CSS.
const accountDialogLoaders = {
	signin: () => import('@/components/MkSigninDialog.vue'),
	signup: () => import('@/components/MkSignupDialog.vue'),
};

function closeAccount() { accountRequest++; disposeAccount?.(); disposeAccount = undefined; openingAccount.value = false; }

onMounted(refresh);
onActivated(refresh);
onDeactivated(closeAccount);
onBeforeUnmount(closeAccount);
onBeforeUnmount(() => motionPreference.removeEventListener('change', updateMotion));
definePage(() => ({ title: brandName.value, icon: 'ti ti-home', needWideArea: true }));
</script>

<style lang="scss" module>
@use './home/palette.scss';
.home {
	@include palette.home;
	min-height: 100%; width: 100%; box-sizing: border-box; display: flex; flex-direction: column;
	background: var(--home-cream); color: var(--home-ink); font-family: var(--home-font);
	::selection { background: var(--home-lime); color: var(--home-ink); }
	a { color: inherit; text-decoration: none; }
	button, a { -webkit-tap-highlight-color: transparent; }
	button:focus-visible, a:focus-visible { outline: 3px solid var(--home-accent); outline-offset: 5px; }
}
.header { display: flex; align-items: center; gap: clamp(24px, 3vw, 56px); padding: 22px clamp(24px, 4vw, 72px); border-bottom: 2px solid var(--home-ink); background: var(--home-paper); }
.brand { display: flex; align-items: center; gap: 10px; font-size: 21px; font-weight: 850; line-height: 1.25; max-width: 26%; overflow-wrap: anywhere; img { width: 42px; height: 42px; object-fit: contain; flex-shrink: 0; } }
.navigation { display: flex; gap: clamp(14px, 2vw, 34px); }
.navLink { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; font-size: 16px; white-space: nowrap; border-bottom: 2px solid transparent; &:hover { border-color: var(--home-accent); color: var(--home-accent); } > i:first-child { font-size: 20px; } .lock { font-size: 12px; opacity: .65; } }
.account { margin-left: auto; display: flex; align-items: center; gap: 22px; flex-shrink: 0; }
.language { min-height: 40px; max-width: 100px; padding: 6px 8px; border: 1px solid var(--home-muted); border-radius: 8px; color: var(--home-ink); background: var(--home-paper); font: inherit; font-size: 13px; cursor: pointer; &:focus-visible { outline: 3px solid var(--home-accent); outline-offset: 3px; } }
.login { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; font-size: 15px; &:hover { text-decoration: underline; text-underline-offset: 5px; } }
.home .signup { display: flex; align-items: center; gap: 14px; min-height: 48px; padding: 0 20px; border: 2px solid var(--home-ink); border-radius: 12px; background: var(--home-coral); box-shadow: 3px 4px 0 var(--home-ink); font-size: 15px; font-weight: 750; transition: transform .15s, box-shadow .15s; &:hover { transform: translateY(-2px); } &:active { transform: translate(2px, 2px); box-shadow: 1px 2px 0 var(--home-ink); } }
.hero { flex: 1; display: grid; grid-template-columns: minmax(0, .88fr) minmax(0, 1.12fr); align-items: center; gap: clamp(40px, 5vw, 100px); padding: clamp(48px, 6vh, 100px) clamp(24px, 4vw, 72px) clamp(56px, 7vh, 100px); }
.intro { min-width: 0; h1 { margin: 0 0 30px; font-size: clamp(40px, 4.25vw, 76px); line-height: 1.3; font-weight: 900; letter-spacing: -.035em; span { color: var(--home-accent); } } }
.description { margin: 0; font-size: clamp(15px, 1.25vw, 20px); line-height: 1.9; color: var(--home-muted); }
.community { display: flex; flex-wrap: wrap; align-items: center; gap: 20px; margin-top: 42px; }
.communityButton { display: flex; align-items: center; justify-content: center; gap: 30px; min-height: 60px; box-sizing: border-box; padding: 12px 24px; border: 2px solid var(--home-ink); border-radius: 12px; background: var(--home-ink); color: var(--home-paper) !important; font-size: 18px; font-weight: 750; transition: transform .15s, background-color .15s; &:hover { background: var(--home-accent); transform: translateY(-2px); } &:active { transform: translateY(1px); } i { font-size: 23px; } }
.communityHint { display: flex; align-items: center; gap: 7px; font-size: 13px; color: var(--home-muted); }
.communityDetail { margin: 22px 0 0; font-size: 13px; color: var(--home-muted); }
.footer { display: flex; justify-content: space-between; gap: 16px; padding: 22px clamp(24px, 4vw, 72px); border-top: 2px solid var(--home-ink); background: var(--home-paper); color: var(--home-muted); font-size: 13px; line-height: 1.6; }
@media (max-width: 1100px) { .header { flex-wrap: wrap; gap: 16px; } .brand { max-width: 55%; } .navigation { order: 3; flex-basis: 100%; justify-content: center; gap: 40px; } .hero { gap: 36px; } .community { gap: 16px; } }
@media (max-width: 800px) { .header { padding: 16px 24px 10px; } .hero { grid-template-columns: minmax(0, 1fr); gap: 40px; padding: 42px 24px 44px; } .intro h1 { font-size: clamp(38px, 7.7vw, 60px); margin-bottom: 22px; } .description { font-size: 15px; } .community { margin-top: 28px; } .footer { flex-direction: column; gap: 6px; padding: 18px 24px; } }
@media (max-width: 480px) { .brand { font-size: 17px; max-width: 51%; gap: 7px; img { width: 32px; height: 32px; } } .account { gap: 12px; } .login { font-size: 13px; } .home .signup { min-height: 42px; padding: 0 12px; gap: 4px; font-size: 13px; i { display: none; } } .navigation { gap: 0; justify-content: space-between; } .navLink { gap: 5px; font-size: 14px; .lock { display: none; } } .community { gap: 14px; } .communityButton { min-height: 54px; font-size: 16px; } .communityHint { font-size: 12px; } }
@media (max-width: 600px) { .header { gap: 12px; } .brand { flex: 1; max-width: 100%; } .account { gap: 12px; flex-wrap: wrap; justify-content: flex-end; } .language { max-width: 84px; min-height: 38px; padding: 5px 6px; } }
@media (max-width: 480px) {
	.header { padding-right: 16px; padding-left: 16px; }
	.brand { min-width: 0; font-size: 15px; gap: 6px; img { width: 28px; height: 28px; } span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } }
	.account { gap: 8px; flex-wrap: nowrap; }
	.language { width: 72px; font-size: 12px; }
	.home .signup { padding: 0 10px; }
	.navLink > i { display: none; }
	.home:lang(en) .intro h1 { font-size: clamp(31px, 7.2vw, 42px); }
}
@media (prefers-reduced-motion: reduce) { .home .signup, .communityButton { transition: none; &:hover, &:active { transform: none; } } }
</style>
