"use client";

import { useRef, useState, useCallback, useEffect } from "react";

// Web Speech API 类型声明
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

interface SpeechRecognitionOptions {
  lang?: string;
  continuous?: boolean;
  interimResults?: boolean;
}

/**
 * 语音输入 Hook（Web Speech API）
 * - 支持实时识别和最终结果
 * - 自动检测浏览器支持
 * - 支持中文/英文等多语言
 */
export function useVoiceInput(options: SpeechRecognitionOptions = {}) {
  const recognitionRef = useRef<any>(null);
  const stopRequestedRef = useRef(false);
  const levelRef = useRef(0);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    setIsSupported(!!SpeechRecognition);
  }, []);

  useEffect(() => {
    levelRef.current = 0;
    if (
      !isListening ||
      !navigator.mediaDevices?.getUserMedia ||
      !window.AudioContext
    ) {
      return;
    }

    let disposed = false;
    let stream: MediaStream | undefined;
    let context: AudioContext | undefined;
    let source: MediaStreamAudioSourceNode | undefined;
    let raf = 0;
    const release = () => {
      cancelAnimationFrame(raf);
      source?.disconnect();
      stream?.getTracks().forEach((track) => track.stop());
      if (context && context.state !== "closed") {
        void context.close().catch(() => {});
      }
      levelRef.current = 0;
    };

    const measure = async () => {
      try {
        const captured = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
        if (disposed) {
          captured.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = captured;
        context = new AudioContext();
        source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        await context.resume();
        if (disposed) return;
        const samples = new Float32Array(analyser.fftSize);
        const update = () => {
          analyser.getFloatTimeDomainData(samples);
          let energy = 0;
          for (const sample of samples) energy += sample * sample;
          const rms = Math.sqrt(energy / samples.length);
          const target = Math.min(1, Math.max(0, (rms - 0.008) * 10));
          const rate = target > levelRef.current ? 0.3 : 0.08;
          levelRef.current += (target - levelRef.current) * rate;
          raf = requestAnimationFrame(update);
        };
        update();
      } catch {
        // Volume feedback is optional; recognition can continue without it.
        release();
      }
    };
    void measure();
    return () => {
      disposed = true;
      release();
    };
  }, [isListening]);

  useEffect(
    () => () => {
      const recognition = recognitionRef.current;
      recognitionRef.current = null;
      try {
        recognition?.abort();
      } catch {}
    },
    [],
  );

  const start = useCallback(() => {
    if (typeof window === "undefined") return;
    if (recognitionRef.current && !stopRequestedRef.current) return;
    const previous = recognitionRef.current;
    recognitionRef.current = null;
    stopRequestedRef.current = false;
    try {
      previous?.abort();
    } catch {}
    setError(null);
    if (window.isSecureContext === false) {
      setError("语音输入需要 HTTPS 安全连接，请通过 HTTPS 地址打开。");
      return;
    }
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError("当前浏览器不支持语音输入，可尝试手机键盘的语音输入。");
      return;
    }

    let recognition: any;
    try {
      recognition = new SpeechRecognition();
      recognition.lang = options.lang || "zh-CN";
      recognition.continuous = options.continuous ?? true;
      recognition.interimResults = options.interimResults ?? true;

      setTranscript("");
      setInterimTranscript("");

      recognition.onstart = () => {
        if (recognitionRef.current !== recognition) return;
        setIsListening(true);
      };

      recognition.onresult = (event: any) => {
        if (recognitionRef.current !== recognition) return;
        let finalText = "";
        let interimText = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) {
            finalText += result[0].transcript;
          } else {
            interimText += result[0].transcript;
          }
        }
        if (finalText) {
          setTranscript((prev) => prev + finalText);
        }
        setInterimTranscript(interimText);
      };

      recognition.onerror = (event: any) => {
        if (recognitionRef.current !== recognition) return;
        if (event.error === "no-speech" || event.error === "aborted") return;
        const errorMessages: Record<string, string> = {
          "not-allowed":
            "麦克风权限未开启，请在浏览器的网站权限中允许麦克风后重试。",
          "service-not-allowed":
            "浏览器语音服务不可用，可尝试手机键盘的语音输入。",
          network:
            "无法连接浏览器语音识别服务，请检查网络或尝试手机键盘的语音输入。",
          "audio-capture": "无法使用麦克风，请检查设备是否被其他应用占用。",
        };
        setError(errorMessages[event.error] || `语音识别错误: ${event.error}`);
        recognitionRef.current = null;
        setIsListening(false);
        setInterimTranscript("");
        try {
          recognition.abort();
        } catch {}
      };

      recognition.onend = () => {
        if (recognitionRef.current !== recognition) return;
        recognitionRef.current = null;
        setIsListening(false);
        setInterimTranscript("");
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch {
      if (recognitionRef.current === recognition) {
        recognitionRef.current = null;
      }
      try {
        recognition?.abort();
      } catch {}
      setIsListening(false);
      setInterimTranscript("");
      setError(
        "语音输入未能启动，请检查麦克风权限，或尝试手机键盘的语音输入。",
      );
    }
  }, [options.lang, options.continuous, options.interimResults]);

  const stop = useCallback(() => {
    const recognition = recognitionRef.current;
    if (recognition) {
      stopRequestedRef.current = true;
      try {
        recognition.stop();
      } catch {
        recognitionRef.current = null;
        try {
          recognition.abort();
        } catch {}
        setInterimTranscript("");
      }
      setIsListening(false);
    }
  }, []);

  const reset = useCallback(() => {
    setTranscript("");
    setInterimTranscript("");
    setError(null);
  }, []);

  return {
    isSupported,
    isListening,
    levelRef,
    transcript,
    interimTranscript,
    error,
    start,
    stop,
    reset,
  };
}
