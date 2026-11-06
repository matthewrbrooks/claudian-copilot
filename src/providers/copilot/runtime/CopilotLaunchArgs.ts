import { isCopilotEffort } from '../models';

export interface CopilotLaunchOptions {
  readonly availableTools?: readonly string[];
  readonly effort?: string;
  readonly excludedTools?: readonly string[];
}

export const COPILOT_ACP_BASE_ARGS = ['--acp', '--stdio'] as const;

/**
 * `--reasoning-effort`, `--available-tools` and `--excluded-tools` are fixed per process, so a change in any
 * of them needs a relaunch. Tool lists are passed as separate argv values after their flag.
 */
export function buildCopilotACPArgs(options: CopilotLaunchOptions = {}): string[] {
  const args: string[] = [...COPILOT_ACP_BASE_ARGS];
  const effort = options.effort?.trim();
  if (isCopilotEffort(effort)) args.push('--reasoning-effort', effort);
  const available = cleanTools(options.availableTools);
  if (available.length > 0) args.push('--available-tools', ...available);
  const excluded = cleanTools(options.excludedTools);
  if (excluded.length > 0) args.push('--excluded-tools', ...excluded);
  return args;
}

function cleanTools(tools: readonly string[] | undefined): string[] {
  return [...new Set((tools ?? []).map(tool => tool.trim()).filter(Boolean))];
}
