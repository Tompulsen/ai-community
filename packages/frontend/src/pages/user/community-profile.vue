<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<CommunitySurface :key="user.id" section="profile" :profileAuthorId="user.id" :viewerId="$i?.id" :publicationMode="instance.clientOptions.communityPublicationMode === 'after' ? 'after' : 'before'" :signedIn="!!$i" :moderator="iAmModerator" :registrationClosed="instance.disableRegistration" :gateway="gateway" @navigate="navigate">
	<template #profileHeader>
		<ProfileHeader :profile="profile" @navigate="navigate">
			<template #actions><MkFollowButton v-if="$i?.id !== user.id" :user="user" full/></template>
			<template #description><Mfm :text="user.description ?? ''" :isNote="false" :author="user"/></template>
		</ProfileHeader>
	</template>
</CommunitySurface>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type * as Misskey from 'misskey-js';
import { acct, userPage } from '@@/js/user.js';
import CommunitySurface from '../community/surface.vue';
import ProfileHeader from '../community/profile-header.vue';
import { createBrowserCommunityGateway } from '../community/browser-gateway.js';
import type { CommunityProfile } from '../community/types.js';
import MkFollowButton from '@/components/MkFollowButton.vue';
import { $i, iAmModerator } from '@/i.js';
import { instance } from '@/instance.js';
import { useRouter } from '@/router.js';
import { prefer } from '@/preferences.js';
import { getStaticImageUrl } from '@/utility/media-proxy.js';
import { isFollowingVisibleForMe, isFollowersVisibleForMe } from '@/utility/isFfVisibleForMe.js';
const props = defineProps<{ user: Misskey.entities.UserDetailed; }>();
const router = useRouter();
const navigate = (path: string) => { router.push(path); };
const gateway = createBrowserCommunityGateway();
const profile = computed<CommunityProfile>(() => ({
 id: props.user.id, name: props.user.name || props.user.username, handle: acct(props.user),
 description: props.user.description ?? '',
 avatarUrl: props.user.avatarUrl && (prefer.s.disableShowingAnimatedImages || prefer.s.dataSaver.avatar) ? getStaticImageUrl(props.user.avatarUrl) : props.user.avatarUrl,
 bannerUrl: props.user.bannerUrl && prefer.s.disableShowingAnimatedImages ? getStaticImageUrl(props.user.bannerUrl) : props.user.bannerUrl,
 createdAt: props.user.createdAt, isOwn: $i?.id === props.user.id,
 followingCount: isFollowingVisibleForMe(props.user) ? props.user.followingCount : undefined,
 followersCount: isFollowersVisibleForMe(props.user) ? props.user.followersCount : undefined,
 followingPath: userPage(props.user, 'following'), followersPath: userPage(props.user, 'followers'),
 detailsPath: userPage(props.user, 'home'),
}));
</script>
