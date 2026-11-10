import { z } from "zod";

export const CHAT_PROJECT_NAME_MAX_LENGTH = 80;
export const chatProjectNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(CHAT_PROJECT_NAME_MAX_LENGTH);
export const chatProjectSchema = z.object({
  id: z.string().min(1).max(200),
  name: chatProjectNameSchema,
  createdAt: z.number().finite().nonnegative(),
});
export type ChatProject = z.infer<typeof chatProjectSchema>;

export function normalizeChatProjects(value: unknown): ChatProject[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  return value.flatMap((item) => {
    const parsed = chatProjectSchema.safeParse(item);
    if (!parsed.success || ids.has(parsed.data.id)) return [];
    ids.add(parsed.data.id);
    return [parsed.data];
  });
}

export function normalizeChatProjectSessions<T extends { projectId?: string }>(
  sessions: T[],
  projects: ChatProject[],
): T[] {
  const ids = new Set(projects.map((project) => project.id));
  let changed = false;
  const normalized = sessions.map((session) => {
    if (session.projectId === undefined || ids.has(session.projectId))
      return session;
    changed = true;
    const unfiled = { ...session };
    delete unfiled.projectId;
    return unfiled;
  });
  return changed ? normalized : sessions;
}
