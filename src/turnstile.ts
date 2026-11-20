// Reused from studio/app/utils/turnstile.ts so the community browser bundle stays self-contained.
export type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      action?: string;
      theme: "auto";
      size: "flexible" | "compact";
      callback?: (token: string) => void;
      "error-callback"?: (code?: string) => void;
      "expired-callback"?: () => void;
      "timeout-callback"?: () => void;
      "before-interactive-callback"?: () => void;
      "after-interactive-callback"?: () => void;
    },
  ) => string;
  remove: (id: string) => void;
};

const SCRIPT_SELECTOR = "script[data-octopus-turnstile]";
const SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const LOAD_TIMEOUT_MS = 15000;

let pendingLoad: Promise<TurnstileApi> | undefined;

export class TurnstileLoadError extends Error {
  readonly code: "SDK_NETWORK_ERROR" | "SDK_TIMEOUT" | "SDK_UNAVAILABLE";

  constructor(code: TurnstileLoadError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

export function loadTurnstile(): Promise<TurnstileApi> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.reject(
      new TurnstileLoadError("SDK_UNAVAILABLE", "Cloudflare Turnstile requires a browser environment"),
    );
  }

  const turnstileWindow = window as Window & { turnstile?: TurnstileApi };
  if (turnstileWindow.turnstile) {
    return Promise.resolve(turnstileWindow.turnstile);
  }
  if (pendingLoad) return pendingLoad;

  let script = document.querySelector<HTMLScriptElement>(SCRIPT_SELECTOR);
  if (script?.dataset.failed === "true") {
    script.remove();
    script = null;
  }
  const isNewScript = !script;
  script ??= document.createElement("script");
  const currentScript = script;

  let resolveLoad!: (api: TurnstileApi) => void;
  let rejectLoad!: (reason: Error) => void;
  const currentLoad = new Promise<TurnstileApi>((resolve, reject) => {
    resolveLoad = resolve;
    rejectLoad = reject;
  });
  pendingLoad = currentLoad;

  let settled = false;
  let timeout: number;
  const cleanup = () => {
    window.clearTimeout(timeout);
    currentScript.removeEventListener("load", onLoad);
    currentScript.removeEventListener("error", onError);
    if (pendingLoad === currentLoad) pendingLoad = undefined;
  };
  const fail = (code: TurnstileLoadError["code"], message: string) => {
    if (settled) return;
    settled = true;
    cleanup();
    currentScript.remove();
    rejectLoad(new TurnstileLoadError(code, message));
  };
  const onLoad = () => {
    if (settled) return;
    const api = turnstileWindow.turnstile;
    if (!api) {
      fail("SDK_UNAVAILABLE", "Cloudflare Turnstile SDK is unavailable");
      return;
    }
    settled = true;
    cleanup();
    resolveLoad(api);
  };
  const onError = () => fail("SDK_NETWORK_ERROR", "Cloudflare Turnstile SDK failed to load");

  currentScript.addEventListener("load", onLoad);
  currentScript.addEventListener("error", onError);
  timeout = window.setTimeout(
    () => fail("SDK_TIMEOUT", "Cloudflare Turnstile SDK loading timed out"),
    LOAD_TIMEOUT_MS,
  );

  if (isNewScript) {
    currentScript.src = SCRIPT_URL;
    currentScript.async = true;
    currentScript.defer = true;
    currentScript.dataset.octopusTurnstile = "true";
    try {
      document.head.appendChild(currentScript);
    } catch {
      fail("SDK_NETWORK_ERROR", "Cloudflare Turnstile SDK failed to load");
    }
  }

  return currentLoad;
}
