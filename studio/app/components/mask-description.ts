import type { Lang } from "../locales";
import type { Mask } from "../store/mask";

const descriptions: Record<string, Record<Lang, string>> = {
  通用提示词优化: {
    cn: "把需求整理成清晰、可执行的提示词",
    en: "Turn rough ideas into clear, ready-to-use prompts.",
  },
  图片反推: {
    cn: "从参考图提取主体、构图与风格",
    en: "Describe a reference image as a reusable image prompt.",
  },
  AI文生图: {
    cn: "把文字描述组织成绘图请求",
    en: "Turn a scene description into an image generation request.",
  },
  文案写手: {
    cn: "保留原意，润色中文表达",
    en: "Polish Chinese writing while preserving its meaning.",
  },
  机器学习: {
    cn: "用易懂的语言解释机器学习概念",
    en: "Explain machine learning concepts in plain language.",
  },
  后勤工作: {
    cn: "规划活动的交通、餐饮与资源安排",
    en: "Plan transport, catering, and resources for an event.",
  },
  职业顾问: {
    cn: "根据技能与兴趣梳理职业方向",
    en: "Explore career paths based on skills and interests.",
  },
  英专写手: {
    cn: "将原文翻译并润色为英文",
    en: "Translate and refine your writing into English.",
  },
  语言检测器: {
    cn: "识别一句话使用的语言",
    en: "Identify the language of a sentence.",
  },
  小红书写手: {
    cn: "围绕主题撰写小红书推荐帖",
    en: "Draft a Xiaohongshu recommendation post for your topic.",
  },
  简历写手: {
    cn: "按目标职业起草简历与项目经历",
    en: "Draft a resume and project experience for a target role.",
  },
  心理医生: {
    cn: "梳理情绪与困扰，提供支持性建议",
    en: "Talk through emotions and concerns with supportive guidance.",
  },
  创业点子王: {
    cn: "构思面向企业的 AI 创业点子",
    en: "Brainstorm AI business ideas for enterprise software.",
  },
  互联网写手: {
    cn: "撰写通俗易懂的互联网主题文章",
    en: "Write accessible articles about internet technology.",
  },
  心灵导师: {
    cn: "用中英双语名言回应生活困惑",
    en: "Respond to everyday questions with bilingual quotations.",
  },
  "越狱模式 [Jailbreak]": {
    cn: "对照常规与角色扮演两种回答",
    en: "Compare standard and role-play responses.",
  },
  "GitHub Copilot": {
    cn: "梳理编程思路并给出代码建议",
    en: "Plan programming tasks and suggest code.",
  },
  "Prompt Improvement": {
    cn: "通过建议与追问逐步改进提示词",
    en: "Refine a prompt through suggestions and follow-up questions.",
  },
  CAN: {
    cn: "澄清需求，逐步完成编程任务",
    en: "Clarify requirements and work through a coding task.",
  },
  Expert: {
    cn: "结合专家角色细化需求与提示词",
    en: "Shape detailed prompts with relevant expert roles.",
  },
};

export function getMaskDescription(
  mask: Pick<Mask, "name" | "builtin">,
  language: Lang,
) {
  return mask.builtin ? descriptions[mask.name]?.[language] : undefined;
}
