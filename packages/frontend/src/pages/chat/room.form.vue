<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->
<template>
<div :class="$style.root" @dragover.stop="onDragover" @drop.stop="onDrop">
	<textarea
		ref="textareaEl"
		v-model="text"
		:class="$style.textarea"
		:placeholder="i18n.ts.inputMessageHere"
		:aria-label="t.message"
		:readonly="textareaReadOnly || sending || !canWrite"
		:aria-invalid="text.length > 2000"
		@keydown="onKeydown"
		@paste="onPaste"
	></textarea>
	<div v-if="file" :class="$style.file">
		<i class="ti ti-paperclip" aria-hidden="true"></i><span>{{ file.name }}</span>
		<button class="_button" :aria-label="t.removeAttachment" :disabled="sending" @click="file = null"><i class="ti ti-x" aria-hidden="true"></i></button>
	</div>
	<p v-if="error" :class="$style.error" role="alert">{{ error }}</p>
	<p v-if="!canWrite" :class="$style.hint">{{ t.unavailable }}</p>
	<p v-else-if="text.length > 2000" :class="$style.error" role="alert">{{ t.tooLong }}</p>
	<p v-if="uploading" :class="$style.hint" role="status">{{ t.uploading }}</p>
	<footer :class="$style.footer">
		<div :class="$style.buttons">
			<button class="_button" :class="$style.button" :disabled="!canWrite || sending || uploading" :aria-label="t.attachment" :title="t.attachment" @click="chooseFile"><i class="ti ti-photo-plus" aria-hidden="true"></i></button>
			<button class="_button" :class="$style.button" :disabled="!canWrite || sending" :aria-label="t.emoji" :title="t.emoji" @click="insertEmoji"><i class="ti ti-mood-happy" aria-hidden="true"></i></button>
			<span :class="$style.count">{{ text.length }} / 2000</span>
			<button class="_button" :class="[$style.button, $style.send]" :disabled="!canSend || sending || uploading" @click="send">
				<i class="ti ti-send" aria-hidden="true"></i><span>{{ sending ? t.sending : t.send }}</span>
			</button>
		</div>
		<p :class="$style.hint">{{ prefer.r['chat.sendOnEnter'].value ? t.enterHint : t.ctrlHint }}</p>
	</footer>
</div>
</template>

<script lang="ts" setup>
import { onMounted, watch, ref, shallowRef, computed, nextTick, onBeforeUnmount, markRaw } from 'vue';
import * as Misskey from 'misskey-js';
import { chatText as t } from './copy.js';
import { selectFile } from '@/utility/drive.js';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { ensureSignin } from '@/i.js';
import { miLocalStorage } from '@/local-storage.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { prefer } from '@/preferences.js';
import { Autocomplete } from '@/utility/autocomplete.js';
import { emojiPicker } from '@/utility/emoji-picker.js';
import { checkDragDataType, getDragData } from '@/drag-and-drop.js';

const props = defineProps<{
	user?: Misskey.entities.UserDetailed | null;
	room?: Misskey.entities.ChatRoom | null;
}>();
const emit = defineEmits<{ (ev: 'sent', message: Misskey.entities.ChatMessageLite): void }>();
const $i = ensureSignin();
const textareaEl = shallowRef<HTMLTextAreaElement>();
const text = ref('');
const file = ref<Misskey.entities.DriveFile | null>(null);
const sending = ref(false);
const uploading = ref(false);
const error = ref('');
const textareaReadOnly = ref(false);
let autocompleteInstance: Autocomplete | null = null;
let disposed = false;
const canWrite = computed(() => $i.policies.chatAvailability === 'available' && (props.room != null || (props.user != null && props.user.id !== $i.id && props.user.canChat && props.user.host === null)));
const canSend = computed(() => canWrite.value && text.value.length <= 2000 && (text.value.trim().length > 0 || file.value != null));

function getDraftKey() {
	return $i.id + ':' + (props.user ? 'user:' + props.user.id : 'room:' + props.room?.id);
}

type Drafts = Record<string, { updatedAt: string; data: { text: string; file: Misskey.entities.DriveFile | null } }>;

function readDrafts(): Drafts {
	try {
		const value = JSON.parse(miLocalStorage.getItem('chatMessageDrafts') || '{}');
		return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
	} catch { return {}; }
}

function saveDraft() {
	if (disposed) return;
	try {
		const drafts = readDrafts();
		if (!text.value && !file.value) delete drafts[getDraftKey()];
		else drafts[getDraftKey()] = { updatedAt: new Date().toISOString(), data: { text: text.value, file: file.value } };
		miLocalStorage.setItem('chatMessageDrafts', JSON.stringify(drafts));
	} catch { /* Sending remains available when browser storage is full. */ }
}

watch([text, file], saveDraft);

function uploadAttachment(files: File[]): Promise<Misskey.entities.DriveFile[]> {
	return new Promise((resolve, reject) => {
		let dispose: (() => void) | undefined;
		let closed = false;
		os.popupAsyncWithDialog(import('@/components/MkUploaderDialog.vue').then(x => x.default), {
			files: markRaw(files), multiple: false,
		}, {
			done: resolve,
			canceled: () => resolve([]),
			closed: () => {
				closed = true;
				resolve([]);
				dispose?.();
			},
		}).then(handle => {
			dispose = handle.dispose;
			if (closed) dispose();
		}, reject);
	});
}

async function attachFiles(files: File[]) {
	if (!canWrite.value || sending.value || uploading.value || files.length === 0) return;
	if (files.length !== 1) {
		error.value = i18n.ts.onlyOneFileCanBeAttached;
		return;
	}
	uploading.value = true;
	error.value = '';
	try {
		const uploaded = await uploadAttachment(files);
		if (!disposed && uploaded[0]) file.value = uploaded[0];
	} catch {
		if (!disposed) error.value = t.attachmentFailed;
	} finally {
		if (!disposed) uploading.value = false;
	}
}

function onPaste(ev: ClipboardEvent) {
	const files = Array.from(ev.clipboardData?.files ?? []);
	if (!files.length) return;
	ev.preventDefault();
	void attachFiles(files);
}

function onDragover(ev: DragEvent) {
	if (!canWrite.value || sending.value || uploading.value || !ev.dataTransfer) return;
	if (ev.dataTransfer.items[0]?.kind === 'file' || checkDragDataType(ev, ['driveFiles'])) {
		ev.preventDefault();
		ev.dataTransfer.dropEffect = 'copy';
	}
}

function onDrop(ev: DragEvent) {
	if (!canWrite.value || sending.value || uploading.value || !ev.dataTransfer) return;
	if (ev.dataTransfer.files.length) {
		ev.preventDefault();
		void attachFiles(Array.from(ev.dataTransfer.files));
		return;
	}
	const dropped = getDragData(ev, 'driveFiles');
	if (dropped != null) {
		ev.preventDefault();
		if (dropped.length === 1) file.value = dropped[0];
		else error.value = i18n.ts.onlyOneFileCanBeAttached;
	}
}

function onKeydown(ev: KeyboardEvent) {
	if (ev.isComposing || ev.key === 'Process' || ev.keyCode === 229 || ev.key !== 'Enter') return;
	const shouldSend = prefer.s['chat.sendOnEnter'] ? !(ev.ctrlKey || ev.metaKey || ev.shiftKey) : ev.ctrlKey || ev.metaKey;
	if (shouldSend) {
		ev.preventDefault();
		void send();
	}
}

async function chooseFile(ev: PointerEvent) {
	if (!canWrite.value || sending.value || uploading.value) return;
	error.value = '';
	try {
		const selected = await selectFile({ anchorElement: ev.currentTarget ?? ev.target, multiple: false, label: i18n.ts.selectFile });
		// The shared picker intentionally stays pending when its menu is dismissed.
		if (!disposed && !sending.value && canWrite.value) file.value = selected;
	} catch {
		if (!disposed) error.value = t.attachmentFailed;
	}
}

async function send() {
	if (!canSend.value || sending.value || uploading.value) return;
	sending.value = true;
	error.value = '';
	const draftKey = getDraftKey();
	const submittedText = text.value;
	const payload = { text: submittedText.trim() || undefined, fileId: file.value?.id };
	try {
		const message = props.user
			? await misskeyApi('chat/messages/create-to-user', { ...payload, toUserId: props.user.id })
			: await misskeyApi('chat/messages/create-to-room', { ...payload, toRoomId: props.room!.id });
		// The composer may have unmounted while the request succeeded. Remove only
		// this exact submitted draft, preserving newer drafts from another instance.
		try {
			const drafts = readDrafts();
			const saved = drafts[draftKey]?.data;
			if (saved?.text === submittedText && saved.file?.id === payload.fileId) {
				delete drafts[draftKey];
				miLocalStorage.setItem('chatMessageDrafts', JSON.stringify(drafts));
			}
		} catch { /* A storage failure must not turn a successful send into a retry. */ }
		if (disposed) return;
		emit('sent', message);
		text.value = '';
		file.value = null;
		saveDraft();
		nextTick(() => textareaEl.value?.focus());
	} catch {
		if (!disposed) error.value = t.sendFailed;
	} finally {
		if (!disposed) sending.value = false;
	}
}

function insertEmoji(ev: MouseEvent) {
	if (!canWrite.value || sending.value) return;
	const target = ev.currentTarget ?? ev.target;
	if (target == null) return;
	textareaReadOnly.value = true;
	let pos = textareaEl.value?.selectionStart ?? 0;
	let posEnd = textareaEl.value?.selectionEnd ?? text.value.length;
	emojiPicker.show(target as HTMLElement, emoji => {
		text.value = text.value.substring(0, pos) + emoji + text.value.substring(posEnd);
		pos += emoji.length;
		posEnd = pos;
	}, () => {
		textareaReadOnly.value = false;
		nextTick(() => textareaEl.value?.focus());
	});
}

onMounted(() => {
	if (textareaEl.value) autocompleteInstance = new Autocomplete(textareaEl.value, text);
	const draft = readDrafts()[getDraftKey()];
	if (draft?.data && typeof draft.data.text === 'string') {
		text.value = draft.data.text;
		file.value = draft.data.file ?? null;
	}
});

onBeforeUnmount(() => {
	disposed = true;
	autocompleteInstance?.detach();
});
</script>

<style lang="scss" module>
.root { position: relative; border: 1px solid var(--MI_THEME-divider); border-radius: var(--MI-radius); overflow: clip; background: var(--MI_THEME-panel); }
.root:focus-within { border-color: var(--MI_THEME-accent); }
.textarea { display: block; width: 100%; min-width: 0; min-height: 96px; max-height: 240px; padding: 16px; margin: 0; resize: vertical; font: inherit; font-size: 16px; line-height: 1.6; color: var(--MI_THEME-fg); background: var(--MI_THEME-panel); border: 0; box-sizing: border-box; field-sizing: content; }
.textarea:focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: -3px; }
.textarea::placeholder { color: var(--MI_THEME-fg); opacity: .8; }
.footer { padding: 0 8px 8px; }
.file { display: flex; gap: 8px; align-items: center; padding: 4px 16px; font-size: 14px; }
.file span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.file button { flex-shrink: 0; width: 44px; height: 44px; }
.buttons { display: flex; align-items: center; gap: 4px; }
.button { min-width: 44px; min-height: 44px; border-radius: var(--MI-radius); }
.button:hover:not(:disabled) { background: var(--MI_THEME-buttonHoverBg); }
.root button:focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: -2px; }
.button:disabled { opacity: .55; cursor: not-allowed; }
.send { display: flex; gap: 8px; align-items: center; justify-content: center; margin-left: auto; padding-inline: 16px; background: var(--MI_THEME-accent); color: var(--MI_THEME-fgOnAccent); }
.send:hover:not(:disabled) { background: var(--MI_THEME-accent); filter: brightness(.95); }
.count { font-size: 12px; font-variant-numeric: tabular-nums; }
.hint { margin: 4px 8px; font-size: 12px; line-height: 1.5; }
.error { margin: 8px 16px; font-size: 14px; color: var(--MI_THEME-error); }
</style>
