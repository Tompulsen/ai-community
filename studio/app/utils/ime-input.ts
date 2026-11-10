type InputKey = {
  key: string;
  keyCode?: number;
  isComposing?: boolean;
  repeat?: boolean;
};

export function createImeGuard(now = () => performance.now()) {
  let composing = false;
  let endedAt = -Infinity;
  return {
    start() {
      composing = true;
    },
    end() {
      composing = false;
      endedAt = now();
    },
    release(event: InputKey) {
      const candidateReleased =
        !composing &&
        !event.isComposing &&
        event.keyCode !== 229 &&
        (event.key === " " ||
          event.key === "Spacebar" ||
          event.keyCode === 32 ||
          /^[0-9]$/.test(event.key) ||
          (event.keyCode !== undefined &&
            event.keyCode >= 48 &&
            event.keyCode <= 57));
      // A fresh Enter after the candidate key is released is intentional.
      if (event.key === "Enter" || event.keyCode === 13 || candidateReleased)
        endedAt = -Infinity;
    },
    isComposing(event: InputKey) {
      return composing || !!event.isComposing || event.keyCode === 229;
    },
    blocks(event: InputKey) {
      return (
        this.isComposing(event) ||
        (event.key === "Enter" && (event.repeat || now() - endedAt < 200))
      );
    },
  };
}
