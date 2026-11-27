export interface CreationModeration {
  state: 'checking' | 'passed' | 'rejected' | 'unavailable' | 'disabled';
  reason?: string;
  checkedAt?: number;
}

export function moderationAllowsPublication(value?: CreationModeration): boolean {
  return value?.state === 'passed' || value?.state === 'disabled';
}
