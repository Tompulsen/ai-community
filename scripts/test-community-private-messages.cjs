/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Execute the real service methods with isolated persistence and delivery boundaries.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { createRequire } = require('node:module');
const backendRequire = createRequire(path.resolve(__dirname, '../packages/backend/package.json'));
const root = path.resolve(__dirname, '../packages/backend/src');
const cache = new Map();
const actual = new Set(['core/ChatService.ts', 'core/UserFollowingService.ts', 'core/NoteCreateService.ts', 'misc/community-chat.ts', 'misc/emoji-regex.ts', 'server/api/error.ts']);
const noop = () => {};
const mockModule = new Proxy({ __esModule: true, default: class {} }, { get: (target, key) => key in target ? target[key] : class {} });

function load(relative) {
	if (cache.has(relative)) return cache.get(relative).exports;
	const filename = path.join(root, relative);
	const module = { exports: {} };
	cache.set(relative, module);
	const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
	const localRequire = name => {
		if (name === '@nestjs/common') return { Inject: () => noop, Injectable: () => noop };
		if (name === '@/decorators.js') return { bindThis: (_target, _key, descriptor) => descriptor };
		if (name === '@/di-symbols.js') return { DI: {} };
		if (name === '@/misc/community-comment-media.js') return { assertCommunityCommentMedia: async () => {}, isCommunityReply: async () => false };
		if (name === '@/misc/extract-urls-for-keyword-check.js') return { extractUrlsForKeyWordCheck: () => [] };
		if (name === '@/const.js') return { DB_MAX_NOTE_TEXT_LENGTH: 100000 };
		if (name === '@/misc/identifiable-error.js') return { IdentifiableError: class extends Error {} };
		if (name.startsWith('node:')) return require(name);
		if (name === '@misskey-dev/emoji-data/regex') return backendRequire(name);
		const target = name.startsWith('@/') ? name.slice(2).replace(/\.js$/, '.ts') : '';
		return actual.has(target) ? load(target) : mockModule;
	};
	vm.runInThisContext(`(function(require, module, exports, setTimeout) {${code}\n})`, { filename })(localRequire, module, module.exports, noop);
	return module.exports;
}

const { ApiError } = load('server/api/error.ts');
const { parseCommunityChatContent, communityMutualFollowMessage } = load('misc/community-chat.ts');
const { ChatService } = load('core/ChatService.ts');
const { UserFollowingService } = load('core/UserFollowingService.ts');
const { NoteCreateService } = load('core/NoteCreateService.ts');
const site = 'https://community.example';
const work = `${site}/community/work/abc123`;
const alice = { id: 'alice', host: null, isSuspended: false, isDeleted: false, movedToUri: null, chatScope: 'everyone' };
const bob = { ...alice, id: 'bob' };
let checks = 0;
const pass = label => { checks++; console.log(`PASS ${label}`); };
const errorCode = code => error => error.code === code;

function fixture() {
	const state = { mutual: true, blocked: false, blocking: false, users: [alice, bob], inserts: [], audiences: [], emojis: new Map([['wave', { roleIdsThatCanBeUsedThisEmojiAsReaction: [] }]]) };
	const chain = new Proxy({}, { get: (_target, key) => key === 'getMany' ? async () => [{ userId: 'alice' }, { userId: 'bob' }] : () => chain });
	const redis = new Proxy({}, { get: (_target, key) => key === 'exec' ? async () => [] : () => redis });
	const service = Object.assign(Object.create(ChatService.prototype), {
		config: { url: site },
		usersRepository: { findOneBy: async ({ id }) => state.users.find(user => user.id === id) },
		userFollowingService: { isMutual: async () => state.mutual },
		userBlockingService: { checkBlocked: async (a) => a === 'bob' ? state.blocked : state.blocking },
		roleService: { getUserPolicies: async () => ({ chatAvailability: 'available' }), getUserRoles: async () => [] },
		customEmojiService: { localEmojisCache: { fetch: async () => state.emojis } },
		communityService: { show: async (id, viewer) => { state.audiences.push(viewer); if (state.unavailable === viewer) throw new ApiError({ code: 'COMMUNITY_NOT_FOUND', message: 'Unavailable', id: 'not-found' }); return { id }; } },
		chatApprovalsRepository: { createQueryBuilder: () => chain, insertOne: async () => {} },
		chatMessagesRepository: { insertOne: async message => { state.inserts.push(message); return message; }, findOneBy: async () => ({ id: 'existing', fromUserId: 'bob', toUserId: 'alice', toRoomId: null, reactions: [] }), createQueryBuilder: () => chain },
		chatEntityService: { packMessageLiteFor1on1: async message => message },
		userEntityService: { isLocalUser: () => true },
		idService: { gen: () => 'message' },
		redisClient: { pipeline: () => redis },
		globalEventService: { publishChatUserStream: noop },
	});
	return { service, state, send: (text, file) => service.createMessageToUser(alice, bob, { text, file }) };
}

(async () => {
	for (const text of ['hello', '你好', 'hello👍', '👍hello', '👍👍', ':wave:extra', ':remote@elsewhere:', 'https://outside.example/', `${work}?caption=hello`, `${work}#hello`, `${work}/`, `${site}/community/work/../abc123`, `${work}\n`, ` ${work}`, `${site}/community/work/abc123%0a`, '']) {
		assert.equal(parseCommunityChatContent(text, site), null, text);
	}
	for (const text of [work, ':wave:', '👍', '👨‍👩‍👦', '❤️']) assert.ok(parseCommunityChatContent(text, site), text);
	pass('Exact content allowlist rejects text, external/modified URLs, remote emoji and mixed payloads');
	{
		const { state, send } = fixture();
		await send(work); await send(':wave:'); await send('👍');
		assert.deepEqual(state.audiences, ['alice', 'bob']);
		assert.equal(state.inserts.length, 3);
		assert.equal(state.inserts[0].text, work);
		assert.ok(state.inserts.every(message => message.fileId === null));
		pass('Mutual participants can send a visible work, local custom emoji and built-in Unicode emoji');
	}
	for (const flag of ['mutual', 'blocked', 'blocking']) {
		const { state, send } = fixture(); state[flag] = flag !== 'mutual';
		await assert.rejects(send(work), errorCode('COMMUNITY_CHAT_MUTUAL_REQUIRED'));
		assert.equal(state.inserts.length, 0);
	}
	pass('Old chat approvals cannot bypass one-way following or either blocking direction');
	{
		const { state, send } = fixture(); await send('👍'); state.mutual = false;
		await assert.rejects(send('👍'), errorCode('COMMUNITY_CHAT_MUTUAL_REQUIRED'));
		assert.equal(state.inserts.length, 1);
		pass('Unfollowing revokes sending in an existing conversation');
	}
	for (const change of [{ host: 'remote.example' }, { isSuspended: true }, { isDeleted: true }, { movedToUri: 'remote' }]) {
		const { state, send } = fixture(); state.users = [alice, { ...bob, ...change }];
		await assert.rejects(send('👍'), errorCode('COMMUNITY_CHAT_MUTUAL_REQUIRED'));
	}
	pass('Remote, suspended, deleted and moved accounts cannot receive community private messages');
	for (const text of ['arbitrary text', 'https://outside.example', ':missing:', ':remote@elsewhere:', '👍 hi']) {
		const { state, send } = fixture();
		await assert.rejects(send(text), errorCode('COMMUNITY_CHAT_CONTENT_RESTRICTED')); assert.equal(state.inserts.length, 0);
	}
	{
		const { send } = fixture(); await assert.rejects(send('👍', { id: 'file' }), errorCode('COMMUNITY_CHAT_CONTENT_RESTRICTED'));
	}
	pass('Service boundary rejects unknown emoji, arbitrary text and attachments');
	for (const viewer of ['alice', 'bob']) {
		const { state, send } = fixture(); state.unavailable = viewer;
		await assert.rejects(send(work), errorCode('COMMUNITY_CHAT_WORK_UNAVAILABLE')); assert.equal(state.inserts.length, 0);
	}
	pass('Works unavailable to either participant are rejected before persistence');
	{
		const { state, send, service } = fixture(); state.emojis.set('locked', { roleIdsThatCanBeUsedThisEmojiAsReaction: ['paid'] });
		await assert.rejects(send(':locked:'), errorCode('COMMUNITY_CHAT_CONTENT_RESTRICTED'));
		await assert.rejects(service.createMessageToRoom(alice, { id: 'room' }, { text: 'bypass' }), errorCode('COMMUNITY_CHAT_PRIVATE_ONLY'));
		await assert.rejects(service.createRoom(alice, { name: 'bypass', description: 'https://outside.example' }), errorCode('COMMUNITY_CHAT_PRIVATE_ONLY'));
		await assert.rejects(service.createRoomInvitation('alice', 'room', 'bob'), errorCode('COMMUNITY_CHAT_PRIVATE_ONLY'));
		await assert.rejects(service.updateRoom({ id: 'room' }, { description: 'bypass' }), errorCode('COMMUNITY_CHAT_PRIVATE_ONLY'));
		state.mutual = false;
		await assert.rejects(service.react('existing', 'alice', '👍'), errorCode('COMMUNITY_CHAT_MUTUAL_REQUIRED'));
		pass('Restricted emoji, group sender and reactions after unfollow cannot bypass the rules');
	}
	for (const mutual of [false, true]) {
		const notifications = [];
		const service = Object.assign(Object.create(UserFollowingService.prototype), {
			followingsRepository: { insert: async () => {} }, idService: { gen: () => 'follow' },
			cacheService: { userFollowingsCache: { refresh: noop }, userProfileCache: { fetch: async () => ({ followedMessage: null }) } },
			followRequestsRepository: { exists: async () => false }, isMutual: async () => mutual,
			notificationService: { createNotification: (...args) => notifications.push(args) },
			globalEventService: { publishInternalEvent: noop, publishMainStream: noop },
			usersRepository: { findOneByOrFail: async ({ id }) => ({ id, movedToUri: 'skip-stats' }) },
			userEntityService: { isRemoteUser: () => false, isLocalUser: () => true, pack: async user => user },
			webhookService: { enqueueUserWebhook: noop },
		});
		await service.insertFollowingDoc(bob, alice);
		assert.ok(notifications.some(([to, type, , from]) => to === 'bob' && type === 'follow' && from === 'alice'));
		const mutualNotices = notifications.filter(([, type, data]) => type === 'followRequestAccepted' && data.message === communityMutualFollowMessage);
		assert.deepEqual(mutualNotices.map(([to]) => to).sort(), mutual ? ['alice', 'bob'] : []);
	}
	pass('A follow notifies its recipient; mutual-follow completion notifies both participants');
	{
		const note = Object.assign(Object.create(NoteCreateService.prototype), {
			db: { manager: {} }, meta: { sensitiveWords: [], prohibitedWords: [], silencedHosts: [], mediaSilencedHosts: [] },
			utilityService: { isSilencedHost: () => false, isMediaSilencedHost: () => false },
			roleService: { getUserPolicies: async () => ({ canPublicNote: true }) },
			checkProhibitedWordsContain: () => false, isRenote: () => false,
			insertNote: async () => { throw new Error('reached-public-insert'); },
		});
		for (const data of [{ visibility: 'specified', visibleUsers: [bob] }, { visibility: 'public', visibleUsers: [bob], reply: { userId: 'alice', visibility: 'specified', channelId: null } }]) {
			await assert.rejects(note.create(alice, { text: 'bypass', apHashtags: [], apEmojis: [], apMentions: [], ...data }), errorCode('COMMUNITY_DIRECT_NOTES_DISABLED'));
		}
		await assert.rejects(note.create(alice, { text: 'public still works', visibility: 'public', apHashtags: [], apEmojis: [], apMentions: [] }), { message: 'reached-public-insert' });
		pass('Specified notes and inherited private replies are blocked while public publishing still reaches persistence');
	}
	console.log(`Community private-message checks: ${checks} PASS`);
})().catch(error => { console.error(error); process.exitCode = 1; });
