import dynamic from "next/dynamic";
import Image from "next/image";
import styles from "./emoji.module.scss";

import { ModelType } from "../store";

import {
  getModelVendor,
  getModelVendorName,
  ModelVendor,
} from "../utils/model";
import BotIconOpenAI from "../icons/llm-icons/openai.svg";
import { GeminiIcon as BotIconGemini } from "./gemini-icon";
import BotIconGemma from "../icons/llm-icons/gemma.svg";
import BotIconClaude from "../icons/llm-icons/claude.svg";
import BotIconMeta from "../icons/llm-icons/meta.svg";
import BotIconMistral from "../icons/llm-icons/mistral.svg";
import BotIconDeepseek from "../icons/llm-icons/deepseek.svg";
import BotIconMoonshot from "../icons/llm-icons/moonshot.svg";
import BotIconQwen from "../icons/llm-icons/qwen.svg";
import BotIconWenxin from "../icons/llm-icons/wenxin.svg";
import BotIconGrok from "../icons/llm-icons/grok.svg";
import BotIconHunyuan from "../icons/llm-icons/hunyuan.svg";
import BotIconDoubao from "../icons/llm-icons/doubao.svg";
import BotIconZai from "../icons/llm-icons/zai.svg";
import BotIconMinimax from "../icons/llm-icons/minimax.svg";
import BotIconStepfun from "../icons/llm-icons/stepfun.svg";
import BotIconSpark from "../icons/llm-icons/spark.svg";
import BotIconBaichuan from "../icons/llm-icons/baichuan.svg";
import BotIconYi from "../icons/llm-icons/yi.svg";
import BotIconCohere from "../icons/llm-icons/cohere.svg";
import BotIconNvidia from "../icons/llm-icons/nvidia.svg";
import BotIconPerplexity from "../icons/llm-icons/perplexity.svg";

const MODEL_ICONS: Partial<Record<ModelVendor, typeof BotIconOpenAI>> = {
  openai: BotIconOpenAI,
  gemini: BotIconGemini,
  gemma: BotIconGemma,
  claude: BotIconClaude,
  meta: BotIconMeta,
  mistral: BotIconMistral,
  deepseek: BotIconDeepseek,
  moonshot: BotIconMoonshot,
  qwen: BotIconQwen,
  wenxin: BotIconWenxin,
  grok: BotIconGrok,
  hunyuan: BotIconHunyuan,
  doubao: BotIconDoubao,
  chatglm: BotIconZai,
  minimax: BotIconMinimax,
  stepfun: BotIconStepfun,
  spark: BotIconSpark,
  baichuan: BotIconBaichuan,
  yi: BotIconYi,
  cohere: BotIconCohere,
  nvidia: BotIconNvidia,
  perplexity: BotIconPerplexity,
};

const LazyEmojiPicker = dynamic(
  () => import("./avatar-picker").then((mod) => mod.AvatarPickerContent),
  { ssr: false },
);

export function AvatarPicker(props: {
  onEmojiClick: (emojiId: string) => void;
}) {
  return <LazyEmojiPicker onEmojiClick={props.onEmojiClick} />;
}

export function Avatar(props: { model?: ModelType; avatar?: string }) {
  if (props.model) {
    const vendor = getModelVendor(props.model);
    const LlmIcon = MODEL_ICONS[vendor] ?? BotIconOpenAI;

    return (
      <div
        className="no-dark model-avatar"
        data-model-vendor={vendor}
        title={getModelVendorName(props.model) ?? props.model}
      >
        {vendor === "agnes" ? (
          <Image
            className="user-avatar"
            src="/studio/model-icons/agnes.png"
            alt="Agnes AI"
            width={32}
            height={32}
            unoptimized
            loading="eager"
          />
        ) : (
          <LlmIcon
            className="user-avatar"
            width={30}
            height={30}
            {...(LlmIcon === BotIconOpenAI ? { fill: "var(--black)" } : {})}
          />
        )}
      </div>
    );
  }

  return (
    <div className="user-avatar">
      {props.avatar && <EmojiAvatar avatar={props.avatar} />}
    </div>
  );
}

export function EmojiAvatar(props: { avatar: string; size?: number }) {
  if (!/^[0-9a-f]{1,6}(?:-[0-9a-f]{1,6})*$/i.test(props.avatar)) return null;
  const points = props.avatar.split("-").map((hex) => parseInt(hex, 16));
  if (
    points.some(
      (point) => point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff),
    )
  )
    return null;
  const size = props.size ?? 18;
  return (
    <span
      className={`${styles.native} epr-emoji-native`}
      data-unified={props.avatar}
      style={{ width: size, height: size, fontSize: size }}
    >
      {String.fromCodePoint(...points)}
    </span>
  );
}
