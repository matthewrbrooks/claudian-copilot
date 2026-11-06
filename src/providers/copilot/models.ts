import type { ACPSessionConfigOption, ACPSessionModelState } from '../acp';
import { extractACPSessionModelState } from '../acp';

export interface CopilotModel {
  displayName: string;
  rawId: string;
}

export const COPILOT_MODEL_PREFIX = 'copilot/';

/** `--effort` is a launch-time flag that applies to the whole process, so levels are not per model. */
export const COPILOT_EFFORT_VALUES = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

export function encodeCopilotModelId(rawModelId: string): string {
  const normalized = rawModelId.trim();
  if (!normalized || normalized === COPILOT_MODEL_PREFIX) return '';
  return normalized.startsWith(COPILOT_MODEL_PREFIX) ? normalized : `${COPILOT_MODEL_PREFIX}${normalized}`;
}

export function decodeCopilotModelId(model: string): string | null {
  const normalized = model.trim();
  if (!normalized.startsWith(COPILOT_MODEL_PREFIX)) return null;
  return normalized.slice(COPILOT_MODEL_PREFIX.length).trim() || null;
}

export function isCopilotModelSelectionId(model: string): boolean {
  return decodeCopilotModelId(model) !== null;
}

export function isCopilotEffort(value: string | undefined): value is (typeof COPILOT_EFFORT_VALUES)[number] {
  return COPILOT_EFFORT_VALUES.some(effort => effort === value);
}

/**
 * Models come from the session's `model` config option when present, else from the legacy `models` state
 * (via the shared ACP extractor). The current id is the active model reported by the same source.
 */
export function readCopilotSessionModels(
  configOptions: readonly ACPSessionConfigOption[] | null | undefined,
  sessionModels?: ACPSessionModelState | null,
): { currentModelId: string | null; models: CopilotModel[] } {
  const state = extractACPSessionModelState({
    configOptions: configOptions ? [...configOptions] : null,
    models: sessionModels,
  });
  return {
    currentModelId: state.currentModelId || null,
    models: normalizeCopilotModels(state.availableModels.map(model => ({
      displayName: model.name,
      rawId: model.id,
    }))),
  };
}

/** The select option with category `model`, if the session offers its models as a config option. */
export function findCopilotModelConfigOption(
  configOptions: readonly ACPSessionConfigOption[] | null | undefined,
): { id: string; currentValue: string } | null {
  const option = configOptions?.find(entry => entry.type === 'select' && entry.category?.trim().toLowerCase() === 'model');
  return option?.type === 'select' ? { currentValue: option.currentValue, id: option.id } : null;
}

export function normalizeCopilotModels(value: unknown): CopilotModel[] {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, CopilotModel>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const rawId = typeof record.rawId === 'string' ? record.rawId.trim() : '';
    if (!rawId || byId.has(rawId)) continue;
    const displayName = typeof record.displayName === 'string' ? record.displayName.trim() : '';
    byId.set(rawId, { displayName: displayName || rawId, rawId });
  }
  return [...byId.values()];
}
