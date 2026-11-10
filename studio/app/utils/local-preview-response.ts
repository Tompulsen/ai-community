import type { ChatGenerationProgress } from "../client/api";
import type { ChatMessage, ChatMessageTool } from "../store/chat";
import type { ChatResponseMetrics } from "./chat-response-metrics";
import { estimateTokenLength } from "./token-estimate";
import {
  isLocalPreviewEnabled,
  LOCAL_PREVIEW_COMPONENTS_MODEL,
  LOCAL_PREVIEW_COMPRESSION_MODEL,
  LOCAL_PREVIEW_LONG_MODEL,
  LOCAL_PREVIEW_MEDIA_MODEL,
  LOCAL_PREVIEW_METRICS_MODEL,
  LOCAL_PREVIEW_MESSAGE,
  LOCAL_PREVIEW_NO_USAGE_MODEL,
  LOCAL_PREVIEW_RESPONSE,
} from "./local-preview-models";

export type LocalPreviewResponse = {
  content: string;
  reasoning?: string;
  tools?: ChatMessageTool[];
  responseMetrics?: ChatResponseMetrics;
};

const paragraphs = [
  "清晨的街道还没有完全醒来，树影在石板路上铺开，路边的早餐店已经升起热气。有人提着刚买的蔬菜慢慢走过，有人停下来整理自行车的车篮，也有人在路口等候熟悉的朋友。生活的节奏没有统一的刻度，却在这些细微的相遇中显得格外清楚。我们愿意放慢脚步，是因为沿途总有值得再次观察的事情，而不是因为目的地变得不再重要。",
  "当阳光越过屋顶，原本安静的角落开始出现更多层次。窗边的书页被风轻轻翻动，店门口的木椅留下细小的光斑，远处传来断断续续的交谈。每一个地方都有自己的声音与颜色，也保留着不同人的记忆。与其急着寻找醒目的景物，不如留意那些被反复使用的物件，它们常常能说明一个社区怎样理解舒适、耐心和彼此照顾。",
  "午后的时间适合把注意力交还给身边的事物。广场边的长椅有人停留，小巷里的花店正在更换门前的花束，孩子们沿着树下的阴影追逐。看似平常的场景会随着季节和天气慢慢变化，同一条道路也会因此呈现不同的面貌。记录这些变化并不需要复杂的安排，只要愿意在经过时多看一眼，许多原本模糊的细节就会逐渐变得清晰。",
  "傍晚的风把白天留下的温度缓缓带走，路灯依次亮起，街边的招牌映在玻璃上。人们结束工作后重新回到熟悉的路线，有人顺路买一束花，有人在桥边停留片刻，还有人把一天的见闻讲给同行的人听。城市并不只由高楼和道路组成，也由这些细小却持续发生的选择组成。它们让公共空间拥有了可以被记住的表情，也让普通的一天有了自己的重量。",
];

const listItems = [
  "沿着较窄的人行道继续向前，观察道路怎样在树木、台阶与店铺之间保留通行的余地。真正舒适的路线往往不需要不断提醒行人改变方向，而是让不同速度的人都能自然地找到自己的位置。一个不显眼的转角、一处可以停留的阴影，都可能改变经过这里时的感受。",
  "把目光从醒目的建筑移向更接近人的尺度，留意扶手的高度、座椅的位置和门前的空地。细节之间不必完全一致，但应当形成容易理解的秩序。当人们不需要为了完成一个简单动作反复犹豫，空间就会显得更加从容，也更愿意让人停下来交流。",
  "记录同一地点在不同时间里的变化，不急着为每一种现象给出结论。早晨的安静可能来自尚未开启的店门，午后的热闹也可能只是一场短暂的相聚。把观察放回具体的天气、人物和日常安排之中，才能保留场景本来的丰富，而不是只留下一个过于简化的印象。",
];

function longContent() {
  const themes = [
    "清晨的街口",
    "树下的人行道",
    "转角的早餐店",
    "沿河的步行路线",
    "小巷里的书店",
    "广场与长椅",
    "雨后的石板路",
    "午间的公共花园",
    "旧建筑的新生活",
    "自行车与慢行",
    "邻里之间的问候",
    "季节留下的颜色",
    "桥边的短暂停留",
    "放学后的街道",
    "回家的熟悉路线",
    "留给明天的记录",
  ];
  return [
    "# 城市日常观察笔记",
    "这是一份本地长文本样例。沿着一天的时间，从清晨走到傍晚，记录街道、人物与公共空间之间细小而持续的联系。",
    ...themes.map((theme, index) =>
      [
        `## ${index + 1}. ${theme}`,
        paragraphs[index % paragraphs.length],
        paragraphs[(index + 1) % paragraphs.length],
        `### ${theme}的三个观察`,
        listItems
          .map((item, itemIndex) => `${itemIndex + 1}. ${item}`)
          .join("\n"),
      ].join("\n\n"),
    ),
    "## 结语",
    "走过这些熟悉的地方之后，我们仍然可以在下一次经过时发现新的细节。记录并不是为了把生活固定下来，而是为了保留继续观察的耐心。",
  ].join("\n\n");
}

function componentResponse(): LocalPreviewResponse {
  return {
    reasoning:
      "本地推理过程示例：先整理文章的层次，让标题、正文和补充说明各有清楚的位置。\n\n接着把需要比较的内容放入表格，把行动项与观察记录分别放入任务列表和嵌套列表。代码与公式作为独立段落保留，方便连续阅读。\n\n最后检查各部分的顺序与衔接，并附上两份预先准备的静态工具结果。本段内容与工具数据均为固定样例，没有执行搜索或模型请求。",
    content: [
      "# 一天的观察手记",
      "本地组件样例：从一段完整的阅读内容出发，展示不同信息之间自然的衔接。",
      "## 沿着街道慢慢走",
      paragraphs[0],
      paragraphs[1],
      "### 留意身边的尺度",
      paragraphs[2],
      "#### 在细节里发现变化",
      paragraphs[3],
      "## 观察记录表",
      [
        "| 时间 | 地点 | 观察内容 | 停留时长 |",
        "| :--- | :--- | :--- | ---: |",
        "| 清晨 | 街角早餐店 | 店门与人行道之间留下了短暂停留的位置 | 12 分钟 |",
        "| 上午 | 沿河步道 | 树影和长椅构成了一条连续的慢行路线 | 28 分钟 |",
        "| 午后 | 社区书店 | 窗边阅读区与街道保持着安静的联系 | 35 分钟 |",
        "| 傍晚 | 小广场 | 灯光亮起后，行人的路线发生了细微变化 | 18 分钟 |",
      ].join("\n"),
      "## 一段旁注",
      "> “一个地方值得被记住，往往不是因为它足够醒目，而是因为它让人在日常经过时感到自在。”\n>\n> 把观察留在具体的场景里，也给不同的解释保留一点空间。",
      "## 明天的行动清单",
      "- [x] 记录清晨与傍晚的光线变化\n- [x] 整理今天经过的四个地点\n- [ ] 补充雨天的人行道观察\n- [ ] 再次访问街角的书店，与店主交流",
      "## 分层观察",
      [
        "1. 先看人与空间的关系。",
        "   - 路线是否连续，是否容易辨认。",
        "     - 树下和转角是否留有停留的位置。",
        "     - 不同速度的行人能否自然地错开。",
        "   - 小店门口与公共道路怎样衔接。",
        "2. 再看时间带来的变化。",
        "   - 对比早晨、午后与傍晚的使用方式。",
        "   - 区分持续发生的习惯与偶然出现的场景。",
      ].join("\n"),
      "## 一段简单的记录代码",
      [
        "```ts",
        "type Observation = {",
        "  place: string;",
        "  minutes: number;",
        "  notes: string[];",
        "};",
        "",
        "const observations: Observation[] = [",
        '  { place: "Riverside", minutes: 28, notes: ["trees", "benches"] },',
        '  { place: "Bookshop", minutes: 35, notes: ["reading", "daylight"] },',
        "];",
        "",
        "const totalMinutes = observations.reduce(",
        "  (total, observation) => total + observation.minutes,",
        "  0,",
        ");",
        "```",
      ].join("\n"),
      "## 用公式整理时间",
      "假设每个地点的停留时间为 $t_i$，全部观察所用的时间可以写为：",
      "$$\nT = \\sum_{i=1}^{n} t_i\n\\qquad\n\\bar{t} = \\frac{1}{n}\\sum_{i=1}^{n} t_i\n$$",
      "如果希望给步行与休息留下固定比例，还可以使用：",
      "$$\n\\begin{aligned}\nT_{\\mathrm{total}} &= T_{\\mathrm{observe}} + T_{\\mathrm{walk}} + T_{\\mathrm{rest}} \\\\\nT_{\\mathrm{rest}} &= 0.15\\,T_{\\mathrm{total}}\n\\end{aligned}\n$$",
      "## 回到连续的阅读",
      ...paragraphs,
      "---",
      "**观察仍在继续。** 不必急着把每个地方解释清楚，先把经过时的感受认真记下来。",
    ].join("\n\n"),
    tools: [
      {
        id: "local-preview-observations",
        function: {
          name: "local_preview_observation_report",
          arguments: JSON.stringify({ day: "sample-day", limit: 3 }),
        },
        content: JSON.stringify({
          structuredContent: [
            { place: "沿河步道", minutes: 28, category: "慢行" },
            { place: "社区书店", minutes: 35, category: "阅读" },
            { place: "街角广场", minutes: 18, category: "休息" },
          ],
        }),
        isError: false,
      },
      {
        id: "local-preview-sources",
        function: {
          name: "local_preview_reference_notes",
          arguments: JSON.stringify({ topic: "阅读与排版", sample: true }),
        },
        content: JSON.stringify({
          results: [
            {
              title: "MDN CSS 参考 · 静态示例",
              url: "https://developer.mozilla.org/zh-CN/docs/Web/CSS",
              snippet:
                "预先写入的参考条目，用于展示来源卡片，没有执行联网搜索。",
            },
            {
              title: "MDN HTML 参考 · 静态示例",
              url: "https://developer.mozilla.org/zh-CN/docs/Web/HTML",
              snippet: "预先写入的参考条目，与本地示例中的内容一起展示。",
            },
          ],
        }),
        isError: false,
      },
    ],
  };
}

function isMetricsPreview(model?: string) {
  return (
    model === LOCAL_PREVIEW_METRICS_MODEL ||
    model === LOCAL_PREVIEW_NO_USAGE_MODEL ||
    model === LOCAL_PREVIEW_COMPRESSION_MODEL
  );
}

function metricsResponse(model: string): LocalPreviewResponse {
  const content = [
    model === LOCAL_PREVIEW_COMPRESSION_MODEL
      ? "# 延续观察记录"
      : "# 本地统计观察",
    model === LOCAL_PREVIEW_COMPRESSION_MODEL
      ? "历史摘要保留了地点、时间和观察重点，现在继续整理下一次出行。原有消息仍然可以回看。"
      : "上一轮的结果留在统计栏中。新的文字逐步出现时，输出速度会随着每次增加的内容和间隔变化。",
    "## 街道里的日常",
    paragraphs[0],
    paragraphs[1],
    "## 留给下一次的记录",
    "下次仍然沿着街角、树下和河边慢慢走。把清晨与傍晚的光线、能够停留的位置，以及邻里相遇时的感受一同记下来，保留可以继续补充的线索。",
  ].join("\n\n");
  return {
    content,
    responseMetrics:
      model === LOCAL_PREVIEW_NO_USAGE_MODEL
        ? {
            usage: {},
            generationDurationMs: 6000,
            estimatedOutputTokens: estimateTokenLength(content),
          }
        : {
            usage: {
              inputTokens: 1000,
              outputTokens: 300,
              cachedInputTokens: 100,
            },
            generationDurationMs: 6000,
          },
  };
}

export function getLocalPreviewHistory(
  model?: string,
): Array<
  Pick<
    ChatMessage,
    "role" | "content" | "responseMetrics" | "imageRequestDurationMs"
  >
> {
  if (!isLocalPreviewEnabled()) return [];
  if (model === LOCAL_PREVIEW_MEDIA_MODEL) {
    return [
      { role: "user", content: "单张图片预览" },
      {
        role: "assistant",
        content: "![Generated Image](/local-preview/media/image-1.jpg)",
        imageRequestDurationMs: 1850,
      },
      { role: "user", content: "四宫格图片预览" },
      {
        role: "assistant",
        content: Array.from(
          { length: 4 },
          (_, index) =>
            `![Generated Image](/local-preview/media/image-${index + 1}.jpg)`,
        ).join("\n\n"),
        imageRequestDurationMs: 266000,
      },
    ];
  }
  if (
    model === LOCAL_PREVIEW_METRICS_MODEL ||
    model === LOCAL_PREVIEW_NO_USAGE_MODEL
  ) {
    return [
      {
        role: "user",
        content: "请记录这次街道观察的重点，之后继续补充。",
      },
      {
        role: "assistant",
        content: "已记录清晨街角、树下步道和沿河路线，之后可以继续观察。",
        responseMetrics: {
          usage: {
            inputTokens: 1000,
            outputTokens: 84,
            cachedInputTokens: 994,
          },
          generationDurationMs: 3000,
        },
      },
    ];
  }
  if (model === LOCAL_PREVIEW_COMPRESSION_MODEL) {
    return Array.from({ length: 8 }, (_, index) => ({
      role: index % 2 ? ("assistant" as const) : ("user" as const),
      content: [
        `第 ${Math.floor(index / 2) + 1} 次街道观察记录`,
        ...Array.from(
          { length: 5 },
          (_, offset) => paragraphs[(index + offset) % paragraphs.length],
        ),
      ].join("\n\n"),
    }));
  }
  return [];
}

export function getLocalPreviewResponse(model?: string): LocalPreviewResponse {
  if (model === LOCAL_PREVIEW_LONG_MODEL) return { content: longContent() };
  if (model === LOCAL_PREVIEW_COMPONENTS_MODEL) return componentResponse();
  if (model === LOCAL_PREVIEW_MEDIA_MODEL)
    return { content: "[本地视频预览](/local-preview/media/preview.mp4)" };
  if (model && isMetricsPreview(model)) return metricsResponse(model);
  return { content: LOCAL_PREVIEW_RESPONSE };
}

function abortError() {
  return new DOMException("Local preview stopped", "AbortError");
}

function pause(duration: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, duration);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

export async function getLocalPreviewSummary(signal: AbortSignal) {
  if (!isLocalPreviewEnabled()) throw new Error(LOCAL_PREVIEW_MESSAGE);
  await pause(2500, signal);
  return "用户持续记录街道与公共空间：清晨观察街角早餐店和邻里来往，白天留意树下步道、沿河长椅、书店与花园，傍晚对比光线和行人路线。记录重点是通行是否自然、是否有舒适的停留位置，以及日常细节如何体现彼此照顾。后续继续比较不同时段和天气下的变化，保留地点、时间、具体见闻与待补充的问题。";
}

async function streamMetricsPreview(
  response: LocalPreviewResponse,
  phases: Array<{ text: string; update: (text: string) => void }>,
  signal: AbortSignal,
  onGenerationProgress?: (progress: ChatGenerationProgress) => void,
) {
  const length = phases.reduce((total, phase) => total + phase.text.length, 0);
  const events: Array<{
    text: string;
    delta: string;
    update: (text: string) => void;
  }> = [];
  const chunkWeights = [1, 4, 2, 5, 1, 3];
  for (const phase of phases) {
    const steps = Math.max(1, Math.round((36 * phase.text.length) / length));
    const weights = Array.from(
      { length: steps },
      (_, index) => chunkWeights[index % chunkWeights.length],
    );
    const totalWeight = weights.reduce((total, weight) => total + weight, 0);
    let weight = 0;
    let previous = 0;
    for (const partWeight of weights) {
      weight += partWeight;
      const end = Math.ceil((phase.text.length * weight) / totalWeight);
      if (end <= previous) continue;
      events.push({
        text: phase.text.slice(0, end),
        delta: phase.text.slice(previous, end),
        update: phase.update,
      });
      previous = end;
    }
  }
  const cadenceWeights = [1, 2, 1, 3, 2];
  const intervals = events
    .slice(1)
    .map((_, index) => cadenceWeights[index % cadenceWeights.length]);
  const totalIntervalWeight = intervals.reduce(
    (total, weight) => total + weight,
    0,
  );
  let firstOutputAt: number | undefined;
  let lastOutputAt = 0;
  let lastProgressAt: number | undefined;
  let emitted = "";
  let lastProgress: ChatGenerationProgress | undefined;
  const publishProgress = () => {
    const durationMs = lastOutputAt - (firstOutputAt ?? lastOutputAt);
    if (durationMs <= 0) return;
    const progress = {
      outputTokens: estimateTokenLength(emitted),
      durationMs,
    };
    if (
      lastProgress &&
      lastProgress.outputTokens === progress.outputTokens &&
      lastProgress.durationMs === progress.durationMs
    )
      return;
    lastProgress = progress;
    onGenerationProgress?.({ ...progress });
  };
  await pause(700, signal);
  for (let index = 0; index < events.length; index++) {
    if (signal.aborted) throw abortError();
    const event = events[index];
    lastOutputAt = performance.now();
    firstOutputAt ??= lastOutputAt;
    emitted += event.delta;
    event.update(event.text);
    if (signal.aborted) throw abortError();
    if (lastProgressAt === undefined || lastOutputAt - lastProgressAt >= 250) {
      publishProgress();
      if (lastProgress) lastProgressAt = lastOutputAt;
    }
    if (index < intervals.length) {
      await pause(
        Math.round((6000 * intervals[index]) / totalIntervalWeight),
        signal,
      );
    }
  }
  publishProgress();
  return {
    ...response,
    responseMetrics: {
      ...response.responseMetrics,
      usage: { ...response.responseMetrics?.usage },
      generationDurationMs: lastOutputAt - (firstOutputAt ?? lastOutputAt),
      ...(response.responseMetrics?.usage.outputTokens === undefined
        ? { estimatedOutputTokens: estimateTokenLength(emitted) }
        : {}),
    },
  };
}

export async function streamLocalPreviewResponse({
  model,
  signal,
  onUpdate,
  onReasoning,
  onGenerationProgress,
}: {
  model?: string;
  signal: AbortSignal;
  onUpdate: (content: string) => void;
  onReasoning?: (content: string) => void;
  onGenerationProgress?: (progress: ChatGenerationProgress) => void;
}) {
  if (!isLocalPreviewEnabled()) throw new Error(LOCAL_PREVIEW_MESSAGE);
  if (signal.aborted) throw abortError();
  const response = getLocalPreviewResponse(model);
  const phases = [
    ...(response.reasoning && onReasoning
      ? [{ text: response.reasoning, update: onReasoning }]
      : []),
    { text: response.content, update: onUpdate },
  ];
  if (isMetricsPreview(model))
    return streamMetricsPreview(response, phases, signal, onGenerationProgress);
  const expanded =
    model === LOCAL_PREVIEW_LONG_MODEL ||
    model === LOCAL_PREVIEW_COMPONENTS_MODEL;
  const length = phases.reduce((total, phase) => total + phase.text.length, 0);
  const chunk = expanded ? Math.max(4, Math.ceil(length / 480)) : 4;
  const steps = phases.reduce(
    (total, phase) => total + Math.ceil(phase.text.length / chunk),
    0,
  );
  const interval = expanded
    ? Math.max(40, Math.floor(19_200 / Math.max(1, steps - 1)))
    : 40;
  await pause(700, signal);
  let remaining = steps;
  for (const phase of phases) {
    for (let end = chunk; end < phase.text.length + chunk; end += chunk) {
      if (signal.aborted) throw abortError();
      phase.update(phase.text.slice(0, end));
      if (signal.aborted) throw abortError();
      if (--remaining > 0) await pause(interval, signal);
    }
  }
  return response;
}
