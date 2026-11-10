import { createContext } from "react";

export const ChatPreviewContext = createContext<
  ((code: string) => void) | undefined
>(undefined);
