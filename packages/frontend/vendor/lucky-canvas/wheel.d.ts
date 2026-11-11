/** lucky-canvas 1.7.26 integration surface. Apache-2.0; see LICENSE. */
type Font = { text: string; top?: string; fontSize?: string; fontColor?: string; fontWeight?: string; lineClamp?: number; lengthLimit?: string };
type Prize = { background: string; fonts: Font[] };
export default class LuckyWheel {
	constructor(config: { divElement: HTMLDivElement }, data: {
		width: number; height: number;
		blocks: { padding: string; background: string }[];
		prizes: Prize[];
		buttons: { radius: string; background: string; pointer?: boolean }[];
		defaultConfig: { gutter: number; offsetDegree: number; speed: number; accelerationTime: number; decelerationTime: number; stopRange: number };
		defaultStyle: { fontColor: string; fontSize: string; fontWeight: string; lineClamp: number; lengthLimit: string };
		end: () => void;
	});
	play(): void;
	stop(index: number): void;
	settle(index: number): void;
	destroy(): void;
}
