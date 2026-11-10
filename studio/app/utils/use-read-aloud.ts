"use client";

import { useCallback, useEffect, useRef, useState } from "react";

let speechParser: Promise<typeof import("./speech-text")> | undefined;

export async function speechText(markdown: string): Promise<string> {
  speechParser ??= import("./speech-text").catch((error) => {
    speechParser = undefined;
    throw error;
  });
  return (await speechParser).speechText(markdown);
}

export function speechChunks(text: string): string[] {
  const chunks: string[] = [];
  for (const sentence of text.match(
    /[^。！？.!?；;\n]+[。！？.!?；;\n]*|[。！？.!?；;\n]+/g,
  ) ?? []) {
    const characters = Array.from(sentence);
    for (let i = 0; i < characters.length; i += 180) {
      const chunk = characters
        .slice(i, i + 180)
        .join("")
        .trim();
      if (chunk) chunks.push(chunk);
    }
  }
  return chunks;
}

export function useReadAloud(
  options: {
    voiceURI?: string;
    rate?: number;
    lang?: string;
  } = {},
) {
  const [supported, setSupported] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useRef(0);
  const current = useRef<SpeechSynthesisUtterance | null>(null);

  const cancelCurrent = useCallback(() => {
    run.current++;
    if (current.current) {
      current.current.onend = null;
      current.current.onerror = null;
      window.speechSynthesis?.cancel();
      current.current = null;
    }
  }, []);
  const stop = useCallback(() => {
    cancelCurrent();
    setActiveId(null);
  }, [cancelCurrent]);

  useEffect(() => {
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance)
      return cancelCurrent;
    const synth = window.speechSynthesis;
    setSupported(true);
    const refresh = () => setVoices(synth.getVoices());
    refresh();
    synth.addEventListener("voiceschanged", refresh);
    return () => {
      synth.removeEventListener("voiceschanged", refresh);
      cancelCurrent();
    };
  }, [cancelCurrent]);

  const speak = useCallback(
    async (id: string, markdown: string) => {
      stop();
      setError(null);
      if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
        setError("当前浏览器不支持朗读，请尝试使用系统浏览器。");
        return;
      }
      const token = run.current;
      setActiveId(id);
      let chunks: string[];
      try {
        chunks = speechChunks(await speechText(markdown));
      } catch {
        if (run.current !== token) return;
        setActiveId(null);
        setError("朗读未能启动，请重试或更换声音。");
        return;
      }
      if (run.current !== token) return;
      if (!chunks.length) {
        setActiveId(null);
        setError("这条回复没有可朗读的正文。");
        return;
      }
      const synth = window.speechSynthesis;
      const available = synth.getVoices();
      const lang = options.lang || navigator.language || "zh-CN";
      const matchesLanguage = (voice: SpeechSynthesisVoice) =>
        voice.lang.split(/[-_]/)[0] === lang.split(/[-_]/)[0];
      const voice =
        available.find((v) => v.voiceURI === options.voiceURI) ??
        available.find((v) => v.localService && matchesLanguage(v)) ??
        available.find(matchesLanguage) ??
        available.find((v) => v.localService) ??
        available.find((v) => v.default);
      const rate = Number.isFinite(options.rate)
        ? Math.min(2, Math.max(0.5, options.rate!))
        : 1;
      let index = 0;
      const next = () => {
        if (run.current !== token) return;
        if (index >= chunks.length) {
          current.current = null;
          setActiveId(null);
          return;
        }
        const utterance = new SpeechSynthesisUtterance(chunks[index++]);
        current.current = utterance;
        if (voice) utterance.voice = voice;
        utterance.lang = voice?.lang || lang;
        utterance.rate = rate;
        utterance.onend = next;
        utterance.onerror = (event) => {
          if (run.current !== token) return;
          current.current = null;
          setActiveId(null);
          if (event.error !== "canceled" && event.error !== "interrupted") {
            run.current++;
            setError("朗读失败，请更换声音后重试。");
          }
        };
        try {
          synth.speak(utterance);
        } catch {
          if (run.current !== token) return;
          run.current++;
          current.current = null;
          setActiveId(null);
          setError("朗读未能启动，请重试或更换声音。");
        }
      };
      next();
    },
    [stop, options.voiceURI, options.rate, options.lang],
  );

  return { supported, voices, activeId, error, speak, stop };
}
