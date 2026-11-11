<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModalWindow
	ref="dialogEl"
	:withOkButton="true"
	:okButtonDisabled="selected == null"
	@click="cancel()"
	@close="cancel()"
	@ok="ok()"
	@closed="emit('closed')"
>
	<template #header>{{ i18n.ts.selectUser }}</template>
	<div>
		<div :class="$style.form">
			<MkInput v-if="computedLocalOnly" v-model="username" :autofocus="true" @update:modelValue="search">
				<template #label>{{ searchByName ? `${i18n.ts.username} / ${i18n.ts.name}` : i18n.ts.username }}</template>
				<template #prefix><i class="ti ti-search" aria-hidden="true"></i></template>
			</MkInput>
			<FormSplit v-else :minWidth="170">
				<MkInput v-model="username" :autofocus="true" @update:modelValue="search">
					<template #label>{{ searchByName ? `${i18n.ts.username} / ${i18n.ts.name}` : i18n.ts.username }}</template>
					<template #prefix><i class="ti ti-search" aria-hidden="true"></i></template>
				</MkInput>
				<MkInput v-model="host" :datalist="[hostname]" @update:modelValue="search">
					<template #label>{{ i18n.ts.host }}</template>
					<template #prefix>@</template>
				</MkInput>
			</FormSplit>
		</div>
		<div v-if="username != '' || host != ''" :class="[$style.result, { [$style.hit]: users.length > 0 }]">
			<div v-if="searching" :class="$style.empty" role="status">{{ i18n.ts.loading }}</div>
			<div v-else-if="searchFailed" :class="$style.empty" role="alert">
				<p>{{ i18n.ts.failedToFetchAccountInformation }}</p>
				<MkButton inline @click="search">{{ i18n.ts.retry }}</MkButton>
			</div>
			<div v-else-if="users.length > 0" :class="$style.users">
				<button v-for="user in users" :key="user.id" type="button" class="_button" :class="[$style.user, { [$style.selected]: selected && selected.id === user.id }]" :aria-pressed="selected?.id === user.id" @click="selected = user" @dblclick="ok()">
					<MkAvatar :user="user" :class="$style.avatar" indicator/>
					<div :class="$style.userBody">
						<MkUserName :user="user" :class="$style.userName"/>
						<MkAcct :user="user" :class="$style.userAcct"/>
					</div>
				</button>
			</div>
			<div v-else :class="$style.empty">
				<span>{{ i18n.ts.noUsers }}</span>
			</div>
		</div>
		<div v-if="username == '' && host == ''" :class="$style.recent">
			<div :class="$style.users">
				<button v-for="user in recentUsers" :key="user.id" type="button" class="_button" :class="[$style.user, { [$style.selected]: selected && selected.id === user.id }]" :aria-pressed="selected?.id === user.id" @click="selected = user" @dblclick="ok()">
					<MkAvatar :user="user" :class="$style.avatar" indicator/>
					<div :class="$style.userBody">
						<MkUserName :user="user" :class="$style.userName"/>
						<MkAcct :user="user" :class="$style.userAcct"/>
					</div>
				</button>
			</div>
		</div>
	</div>
</MkModalWindow>
</template>

<script lang="ts" setup>
import { onMounted, ref, computed, useTemplateRef } from 'vue';
import * as Misskey from 'misskey-js';
import { hostname } from '@@/js/config.js';
import MkInput from '@/components/MkInput.vue';
import MkButton from '@/components/MkButton.vue';
import FormSplit from '@/components/form/split.vue';
import MkModalWindow from '@/components/MkModalWindow.vue';
import { misskeyApi } from '@/utility/misskey-api.js';
import { store } from '@/store.js';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';
import { instance } from '@/instance.js';

const emit = defineEmits<{
	(ev: 'ok', selected: Misskey.entities.UserDetailed): void;
	(ev: 'cancel'): void;
	(ev: 'closed'): void;
}>();

const props = withDefaults(defineProps<{
	includeSelf?: boolean;
	localOnly?: boolean;
	initialQuery?: string;
}>(), {
	includeSelf: false,
	localOnly: false,
});

const computedLocalOnly = computed(() => props.localOnly || instance.federation === 'none');

const username = ref(props.initialQuery ?? '');
const host = ref('');
const searchByName = computed(() => Boolean($i?.isAdmin || $i?.isModerator) && (computedLocalOnly.value || !host.value.trim() || host.value.trim().toLowerCase() === hostname || host.value.trim() === '.'));
const searching = ref(false);
const searchFailed = ref(false);
let searchRequest = 0;
const users = ref<Misskey.entities.UserLite[]>([]);
const recentUsers = ref<Misskey.entities.UserDetailed[]>([]);
const selected = ref<Misskey.entities.UserLite | null>(null);
const dialogEl = useTemplateRef('dialogEl');

async function search() {
	const request = ++searchRequest;
	const query = username.value.trim().replace(/^@/, '');
	const searchHost = host.value.trim().toLowerCase();
	selected.value = null;
	users.value = [];
	searchFailed.value = false;
	searching.value = false;
	if (query === '' && searchHost === '') return;

	searching.value = true;
	try {
		const foundUsers = searchByName.value
			? await misskeyApi('admin/show-users', {
				username: query,
				origin: computedLocalOnly.value || searchHost ? 'local' : 'combined',
				state: 'available',
				limit: 10,
			})
			: await misskeyApi('users/search-by-username-and-host', {
				username: query,
				host: computedLocalOnly.value ? '.' : searchHost,
				limit: 10,
				detail: false,
			});
		if (request !== searchRequest) return;
		users.value = foundUsers.filter(u => (props.includeSelf || u.id !== $i?.id) && (!computedLocalOnly.value || u.host == null));
	} catch {
		if (request === searchRequest) searchFailed.value = true;
	} finally {
		if (request === searchRequest) searching.value = false;
	}
}

async function ok() {
	if (selected.value == null) return;
	const userId = selected.value.id;
	const request = searchRequest;

	const user = await misskeyApi('users/show', {
		userId,
	});
	if (request !== searchRequest || selected.value?.id !== userId) return;
	emit('ok', user);

	dialogEl.value?.close();

	// 最近使ったユーザー更新
	let recents = store.s.recentlyUsedUsers;
	recents = recents.filter(x => x !== userId);
	recents.unshift(userId);
	store.set('recentlyUsedUsers', recents.splice(0, 16));
}

function cancel() {
	searchRequest++;
	emit('cancel');
	dialogEl.value?.close();
}

onMounted(() => {
	if (username.value) search();
	misskeyApi('users/show', {
		userIds: store.s.recentlyUsedUsers,
	}).then(foundUsers => {
		let _users = foundUsers;
		_users = _users.filter((u) => {
			if (computedLocalOnly.value) {
				return u.host == null;
			} else {
				return true;
			}
		});
		_users = _users.filter((u) => {
			if (props.includeSelf) {
				return true;
			} else {
				return u.id !== $i?.id;
			}
		});
		recentUsers.value = _users;
	});
});
</script>

<style lang="scss" module>

.form {
	padding: calc(var(--root-margin) / 2) var(--root-margin);
}

.result,
.recent {
	display: flex;
	flex-direction: column;
	overflow: auto;
	height: 100%;

	&.result.hit {
		padding: 0;
	}

	&.recent {
		padding: 0;
	}
}

.users {
	flex: 1;
	overflow: auto;
	padding: 8px 0;
}

.user {
	display: flex;
	align-items: center;
	width: 100%;
	text-align: start;
	padding: 8px var(--root-margin);
	font-size: 14px;

	&:focus-visible {
		outline: 2px solid var(--MI_THEME-accent);
		outline-offset: -2px;
	}

	&:hover {
		background: light-dark(rgba(0, 0, 0, 0.05), rgba(255, 255, 255, 0.05));
	}

	&.selected {
		background: var(--MI_THEME-accent);
		color: #fff;
	}
}

.userBody {
	padding: 0 8px;
	min-width: 0;
}

.avatar {
	width: 45px;
	height: 45px;
}

.userName {
	display: block;
	font-weight: bold;
}

.userAcct {
	opacity: 0.5;
}

.empty {
	opacity: 0.7;
	text-align: center;
	padding: 16px;
}
</style>
