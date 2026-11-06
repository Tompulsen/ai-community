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
 background: var(--home-cream); color: var(--home-ink); font-family: var(--home-font); color-scheme: light;
 ::selection { background: var(--home-lime); color: var(--home-ink); }
 a { color: inherit; text-decoration: none; }
 button, a { -webkit-tap-highlight-color: transparent; }
 :focus-visible { outline: 2px solid var(--home-accent); outline-offset: 4px; }
}
.header { display: flex; align-items: center; gap: clamp(20px, 3vw, 48px); padding: 20px clamp(20px, 4vw, 72px); border-bottom: 1px solid var(--home-line); background: var(--home-paper); }
.brand { display: flex; align-items: center; gap: 12px; font-size: 18px; font-weight: 650; line-height: 1.3; max-width: 28%; overflow-wrap: anywhere; letter-spacing: -.02em; img { width: 36px; height: 36px; object-fit: contain; flex-shrink: 0; border-radius: 8px; } }
.navigation { display: flex; gap: 6px; }
.navLink { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 0 14px; border-radius: 8px; font-size: 14px; white-space: nowrap; transition: background-color .18s ease, color .18s ease; &:hover { background: var(--home-lime); color: var(--home-accent); } > i { font-size: 18px; } }
.account { margin-left: auto; display: flex; align-items: center; gap: 18px; flex-shrink: 0; }
.language { min-height: 40px; max-width: 98px; padding: 7px 9px; border: 1px solid var(--home-line); border-radius: 8px; color: var(--home-muted); background: var(--home-paper); font: inherit; font-size: 12px; cursor: pointer; }
.login { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; font-size: 14px; &:hover { color: var(--home-accent); } }
.home .signup { display: inline-flex; align-items: center; justify-content: center; gap: 12px; min-height: 44px; padding: 0 18px; border-radius: 8px; background: var(--home-ink); color: var(--home-paper); font-size: 13px; font-weight: 600; transition: background-color .18s ease; &:hover { background: var(--home-accent); } }
.hero { flex: 1; display: grid; grid-template-columns: minmax(0, .8fr) minmax(0, 1.2fr); align-items: center; gap: clamp(32px, 4vw, 80px); padding: clamp(44px, 7vh, 100px) clamp(20px, 4vw, 72px); }
.intro { min-width: 0; h1 { margin: 0 0 28px; font-size: clamp(38px, 4.4vw, 72px); line-height: 1.18; font-weight: 650; letter-spacing: -.035em; text-wrap: balance; span { color: var(--home-accent); } } }
.description { margin: 0; font-size: clamp(14px, 1.1vw, 17px); line-height: 1.95; color: var(--home-muted); }
.community { display: flex; flex-wrap: wrap; align-items: center; gap: 18px; margin-top: 38px; }
.communityButton { display: inline-flex; align-items: center; justify-content: center; gap: 22px; min-height: 54px; box-sizing: border-box; padding: 12px 22px; border-radius: 10px; background: var(--home-accent); color: var(--home-paper) !important; font-size: 15px; font-weight: 600; transition: background-color .18s ease; &:hover { background: var(--home-ink); } i { font-size: 20px; transition: transform .2s cubic-bezier(.16,1,.3,1); } &:hover i { transform: translate(2px, -2px); } }
.communityHint { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--home-muted); }
.communityDetail { margin: 24px 0 0; padding-top: 24px; border-top: 1px solid var(--home-line); font-size: 12px; line-height: 1.8; color: var(--home-muted); }
.footer { display: flex; justify-content: space-between; gap: 16px; padding: 20px clamp(20px, 4vw, 72px); border-top: 1px solid var(--home-line); color: var(--home-muted); font-size: 12px; line-height: 1.6; }
@media (max-width: 1150px) { .header { flex-wrap: wrap; gap: 12px; } .brand { max-width: 55%; } .navigation { order: 3; flex-basis: 100%; justify-content: center; } .hero { gap: 32px; } .intro h1 { font-size: clamp(36px, 4.6vw, 52px); } }
@media (max-width: 850px) { .hero { grid-template-columns: minmax(0, 1fr); gap: 36px; padding-block: 40px; } .intro h1 { font-size: clamp(38px, 7vw, 60px); } .community { margin-top: 26px; } .communityDetail { margin-top: 20px; padding-top: 18px; } .footer { flex-direction: column; gap: 6px; } }
@media (max-width: 480px) { .header { padding: 14px 16px 8px; gap: 10px; } .brand { min-width: 0; flex: 1; max-width: none; font-size: 15px; gap: 8px; img { width: 28px; height: 28px; } span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } } .account { gap: 8px; } .language { width: 70px; padding: 6px; font-size: 12px; } .login { font-size: 12px; } .home .signup { min-height: 40px; padding: 0 10px; font-size: 12px; i { display: none; } } .navigation { justify-content: space-between; gap: 0; } .navLink { padding: 0 8px; gap: 6px; font-size: 13px; } .hero { padding: 32px 16px; gap: 28px; } .intro h1 { font-size: 39px; margin-bottom: 20px; } .description { font-size: 14px; } .community { gap: 12px; } .communityButton { min-height: 50px; font-size: 14px; } .home:lang(en) .intro h1 { font-size: clamp(34px, 9vw, 43px); } }
@media (max-width: 480px) {
	.navigation { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
	.navLink { min-width: 0; padding: 4px; white-space: normal; text-align: center; line-height: 1.45; > i { display: none; } }
}
@media (prefers-reduced-motion: reduce) { .navLink, .home .signup, .communityButton, .communityButton i { transition: none; transform: none; } }
</style>
