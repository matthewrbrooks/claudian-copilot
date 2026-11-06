import {
  isSessionTool,
  TOOL_BASH,
  TOOL_EDIT,
  TOOL_GREP,
  TOOL_READ,
  TOOL_WEB_FETCH,
  TOOL_WRITE,
} from '@/core/tools/toolNames';
import type { ToolProviderPayload } from '@/core/types';
import {
  type ACPResolvedToolRawName,
  ACPToolStreamAdapter,
} from '@/providers/acp';

/**
 * ACP tool kinds mapped to Claudian tool names. Copilot's own tool names and raw input shapes are unverified,
 * so presentation relies on the standard ACP `kind`; unmapped kinds keep their raw name.
 */
const COPILOT_KIND_TOOL_MAP: Readonly<Record<string, string>> = {
  delete: TOOL_WRITE,
  edit: TOOL_EDIT,
  execute: TOOL_BASH,
  fetch: TOOL_WEB_FETCH,
  move: TOOL_EDIT,
  read: TOOL_READ,
  search: TOOL_GREP,
};

export function normalizeCopilotToolName(rawName: string): string {
  const name = rawName.trim();
  if (!name) return 'tool';
  return Object.hasOwn(COPILOT_KIND_TOOL_MAP, name) ? COPILOT_KIND_TOOL_MAP[name] : name;
}

/** Claudian's session tools arrive over MCP; their display titles end with the tool name (unverified shape). */
export function findCopilotSessionToolName(title: string): string | null {
  return title.split(/[^A-Za-z0-9_]+/).find(token => token && isSessionTool(token)) ?? null;
}

export function resolveCopilotRawToolName(
  current: ACPResolvedToolRawName | undefined,
  update: { kind?: string | null; title?: string | null },
): ACPResolvedToolRawName {
  if (current?.provenance === 'title') return current;
  const title = update.title?.trim();
  const sessionTool = title ? findCopilotSessionToolName(title) : null;
  if (sessionTool) return { provenance: 'title', rawName: sessionTool };
  const kind = update.kind?.trim();
  if (kind && kind !== 'other') return { provenance: 'kind', rawName: kind };
  if (current?.provenance === 'kind') return current;
  if (title) return { provenance: 'title', rawName: title };
  return current ?? { provenance: 'fallback', rawName: 'tool' };
}

export function buildCopilotToolProviderPayload(
  rawName: string,
  rawInput: unknown,
  rawOutput: unknown,
): ToolProviderPayload {
  return {
    ...(rawInput !== undefined ? { rawInput } : {}),
    rawName,
    ...(rawOutput !== undefined ? { rawOutput } : {}),
  };
}

export function createCopilotToolStreamAdapter(): ACPToolStreamAdapter {
  return new ACPToolStreamAdapter({
    buildToolProviderPayload: (rawName, rawInput, rawOutput) => buildCopilotToolProviderPayload(rawName ?? 'tool', rawInput, rawOutput),
    normalizeToolInput: (_rawName, input) => input,
    normalizeToolName: rawName => normalizeCopilotToolName(rawName ?? 'tool'),
    normalizeToolResultDetails: () => undefined,
    resolveRawToolName: resolveCopilotRawToolName,
  });
}
