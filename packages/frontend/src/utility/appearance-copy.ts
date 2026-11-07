/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { lang } from '@@/js/config.js';

// Project-owned copy, following the community's bilingual UI convention.
export const appearanceText = lang.startsWith('zh') ? {
	title: '界面模式', light: '明亮模式', dark: '暗色模式', schedule: '定时切换', system: '跟随系统',
	settings: '界面模式设置', intro: '选择后立即生效，偏好会自动保存。',
	current: '当前显示', lightStart: '明亮模式开始时间', darkStart: '暗色模式开始时间',
	localTime: '按此设备的本地时间每天切换，支持跨午夜时段。',
	invalid: '请输入有效时间，且两个开始时间不能相同。',
	save: '保存时间段', saved: '时间段已保存并生效。',
	manual: '手动选择明亮或暗色模式后，将停止自动切换。',
	dayRange: '明亮时段', nightRange: '暗色时段', nextDay: '次日',
} : {
	title: 'Appearance', light: 'Light mode', dark: 'Dark mode', schedule: 'Scheduled', system: 'System',
	settings: 'Appearance settings', intro: 'Changes apply immediately and your preference is saved automatically.',
	current: 'Currently showing', lightStart: 'Light mode starts at', darkStart: 'Dark mode starts at',
	localTime: 'Switches daily using this device’s local time, including overnight periods.',
	invalid: 'Enter valid times. The two start times must be different.',
	save: 'Save schedule', saved: 'Schedule saved and applied.',
	manual: 'Choosing light or dark mode manually stops automatic switching.',
	dayRange: 'Light hours', nightRange: 'Dark hours', nextDay: 'next day',
};
