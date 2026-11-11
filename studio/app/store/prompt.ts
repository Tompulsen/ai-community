import Fuse from "fuse.js";
import { nanoid } from "nanoid";
import { StoreKey } from "../constant";
import { getLang } from "../locales";
import { createPersistStore } from "../utils/store";

export interface Prompt {
  id: string;
  isUser?: boolean;
  title: string;
  content: string;
  createdAt: number;
}

export const SearchService = {
  ready: false,
  builtinEngine: new Fuse<Prompt>([], { keys: ["title"] }),
  userEngine: new Fuse<Prompt>([], { keys: ["title"] }),
  count: {
    builtin: 0,
  },
  allPrompts: [] as Prompt[],
  builtinPrompts: [] as Prompt[],

  init(builtinPrompts: Prompt[], userPrompts: Prompt[]) {
    if (this.ready) {
      return;
    }
    this.allPrompts = userPrompts.concat(builtinPrompts);
    this.builtinPrompts = builtinPrompts.slice();
    this.builtinEngine.setCollection(builtinPrompts);
    this.userEngine.setCollection(userPrompts);
    this.ready = true;
  },

  remove(id: string) {
    this.userEngine.remove((doc) => doc.id === id);
  },

  add(prompt: Prompt) {
    this.userEngine.add(prompt);
  },

  search(text: string) {
    const userResults = this.userEngine.search(text);
    const builtinResults = this.builtinEngine.search(text);
    return userResults.concat(builtinResults).map((v) => v.item);
  },
};

let builtinLoading: Promise<void> | undefined;

export function loadBuiltinPrompts(): Promise<void> {
  if (typeof window === "undefined" || SearchService.ready)
    return Promise.resolve();
  if (!builtinLoading) {
    const lang = getLang();
    builtinLoading = fetch("./prompts.json")
      .then((response) => {
        if (!response.ok) throw new Error("Could not load builtin prompts");
        return response.json();
      })
      .then((data) => {
        const occurrences = new Map<string, number>();
        const prompts: Prompt[] = (data[lang] ?? []).map(
          ([title, content]: [string, string]) => {
            const occurrence = occurrences.get(title) ?? 0;
            occurrences.set(title, occurrence + 1);
            return {
              id: `builtin:${lang}:${title}:${occurrence}`,
              title,
              content,
              createdAt: Date.now(),
            };
          },
        );
        const builtin = prompts.filter(
          (prompt) => prompt.title && prompt.content,
        );
        SearchService.count.builtin = builtin.length;
        SearchService.init(builtin, usePromptStore.getState().getUserPrompts());
        usePromptStore.setState((state) => ({ counter: state.counter + 1 }));
      })
      .catch((error) => console.error("[Fetch] failed to fetch prompts", error))
      .finally(() => {
        builtinLoading = undefined;
      });
  }
  return builtinLoading;
}

export const usePromptStore = createPersistStore(
  {
    counter: 0,
    prompts: {} as Record<string, Prompt>,
    enabledPromptIds: {} as Record<string, boolean>,
  },

  (set, get) => ({
    add(prompt: Prompt) {
      const prompts = get().prompts;
      prompt.id = nanoid();
      prompt.isUser = true;
      prompt.createdAt = Date.now();
      prompts[prompt.id] = prompt;

      set(() => ({
        prompts: prompts,
        counter: get().counter + 1,
      }));
      SearchService.add(prompt);

      return prompt.id!;
    },

    setEnabled(id: string, enabled: boolean) {
      const enabledPromptIds = { ...get().enabledPromptIds };
      if (enabled) {
        enabledPromptIds[id] = true;
      } else {
        delete enabledPromptIds[id];
      }
      set({ enabledPromptIds });
    },

    get(id: string) {
      const targetPrompt = get().prompts[id];

      if (!targetPrompt) {
        return SearchService.builtinPrompts.find((v) => v.id === id);
      }

      return targetPrompt;
    },

    remove(id: string) {
      const prompts = get().prompts;
      delete prompts[id];

      Object.entries(prompts).some(([key, prompt]) => {
        if (prompt.id === id) {
          delete prompts[key];
          return true;
        }
        return false;
      });

      SearchService.remove(id);
      const enabledPromptIds = { ...get().enabledPromptIds };
      delete enabledPromptIds[id];

      set(() => ({
        prompts,
        enabledPromptIds,
        counter: get().counter + 1,
      }));
    },

    getUserPrompts() {
      const userPrompts = Object.values(get().prompts ?? {});
      userPrompts.sort((a, b) =>
        b.id && a.id ? b.createdAt - a.createdAt : 0,
      );
      return userPrompts;
    },

    updatePrompt(id: string, updater: (prompt: Prompt) => void) {
      const prompt = get().prompts[id] ?? {
        title: "",
        content: "",
        id,
      };

      SearchService.remove(id);
      updater(prompt);
      const prompts = get().prompts;
      prompts[id] = prompt;
      set(() => ({ prompts, counter: get().counter + 1 }));
      SearchService.add(prompt);
    },

    search(text: string, enabledOnly = false) {
      const results =
        text.length === 0
          ? this.getUserPrompts().concat(SearchService.builtinPrompts)
          : SearchService.search(text);
      return enabledOnly
        ? results.filter((prompt) => get().enabledPromptIds[prompt.id])
        : results;
    },
  }),
  {
    name: StoreKey.Prompt,
    version: 4,

    migrate(state, version) {
      const newState = JSON.parse(JSON.stringify(state)) as {
        prompts: Record<string, Prompt>;
      };

      if (version < 3) {
        Object.values(newState.prompts).forEach((p) => (p.id = nanoid()));
      }

      return { enabledPromptIds: {}, ...newState } as any;
    },

    onRehydrateStorage() {
      return (state) => {
        if (state)
          SearchService.userEngine.setCollection(state.getUserPrompts());
      };
    },
  },
);
