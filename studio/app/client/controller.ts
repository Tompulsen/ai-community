import { forgetTask } from "../utils/local-tasks";

const listeners = new Set<() => void>();
const notifyChange = () => listeners.forEach((listener) => listener());
type StopOptions = { preserveTasks?: boolean };

// To store message streaming controller
export const ChatControllerPool = {
  controllers: {} as Record<string, AbortController>,

  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  addController(
    sessionId: string,
    messageId: string,
    controller: AbortController,
  ) {
    const key = this.key(sessionId, messageId);
    this.controllers[key] = controller;
    notifyChange();
    return key;
  },

  stop(sessionId: string, messageId: string, options?: StopOptions) {
    if (!options?.preserveTasks) forgetTask(messageId);
    const key = this.key(sessionId, messageId);
    const controller = this.controllers[key];
    delete this.controllers[key];
    controller?.abort();
    notifyChange();
  },

  stopAll() {
    const controllers = Object.values(this.controllers);
    this.controllers = {};
    controllers.forEach((v) => v.abort());
    notifyChange();
  },

  stopSession(sessionId: string, options?: StopOptions) {
    const prefix = `${sessionId},`;
    for (const key of Object.keys(this.controllers)) {
      if (key.startsWith(prefix))
        this.stop(sessionId, key.slice(prefix.length), options);
    }
  },

  hasPending(sessionId?: string) {
    return Object.keys(this.controllers).some(
      (key) => sessionId === undefined || key.startsWith(`${sessionId},`),
    );
  },

  remove(sessionId: string, messageId: string) {
    const key = this.key(sessionId, messageId);
    delete this.controllers[key];
    notifyChange();
  },

  key(sessionId: string, messageIndex: string) {
    return `${sessionId},${messageIndex}`;
  },
};
