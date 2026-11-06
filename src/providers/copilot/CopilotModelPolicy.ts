import { DEFAULT_REASONING_VALUE, formatReasoningValueLabel } from '../../core/providers/reasoning';
import type {
  ProviderModelPolicy,
  ProviderUIOption,
} from '../../core/providers/types';
import { getOrderedCopilotVisibleModelIds } from './config';
import {
  COPILOT_EFFORT_VALUES,
  decodeCopilotModelId,
  encodeCopilotModelId,
  isCopilotModelSelectionId,
} from './models';
import { COPILOT_PERMISSION_MODE_POLICY } from './permissionModes';
import {
  COPILOT_PROVIDER_ID,
  getCopilotProviderSettings,
  updateCopilotProviderSettings,
} from './settings';

const REASONING_OPTIONS: readonly ProviderUIOption[] = COPILOT_EFFORT_VALUES
  .map(value => ({ label: formatReasoningValueLabel(value), value }));

export const copilotModelPolicy: ProviderModelPolicy = {
  permissionModes: COPILOT_PERMISSION_MODE_POLICY,

  getModelOptions(settings): ProviderUIOption[] {
    const current = getCopilotProviderSettings(settings);
    const catalogModels = current.currentCatalog?.models ?? [];
    const options: ProviderUIOption[] = [];
    for (const rawId of getOrderedCopilotVisibleModelIds(current)) {
      const model = catalogModels.find(entry => entry.rawId === rawId);
      const value = encodeCopilotModelId(rawId);
      if (!model || options.some(option => option.value === value)) continue;
      options.push({
        label: Object.hasOwn(current.modelAliases, rawId) ? current.modelAliases[rawId] : model.displayName,
        value,
      });
    }
    return options;
  },

  getDefaultModel(settings): string | null {
    const current = getCopilotProviderSettings(settings);
    const rawId = getOrderedCopilotVisibleModelIds(current)
      .find(id => current.currentCatalog?.models.some(model => model.rawId === id));
    return rawId ? encodeCopilotModelId(rawId) : null;
  },

  ownsModel(model): boolean {
    return isCopilotModelSelectionId(model);
  },

  supportsReasoningEffort(model): boolean {
    return isCopilotModelSelectionId(model);
  },

  getReasoningOptions(model): ProviderUIOption[] {
    return isCopilotModelSelectionId(model) ? [...REASONING_OPTIONS] : [];
  },

  getDefaultReasoningValue(model, settings): string {
    const rawId = decodeCopilotModelId(model);
    if (!rawId) return '';
    const preferred = getCopilotProviderSettings(settings).preferredReasoningByModel;
    const value = Object.hasOwn(preferred, rawId) ? preferred[rawId] : undefined;
    return value && COPILOT_EFFORT_VALUES.some(effort => effort === value) ? value : DEFAULT_REASONING_VALUE;
  },

  isDefaultModel(): boolean {
    return false;
  },

  applyModelDefaults(model, settings): void {
    if (!isRecord(settings)) return;
    const normalized = normalizeSelection(model);
    if (!isCopilotModelSelectionId(normalized)) return;
    clearSavedEffortProjection(settings);
    settings.model = normalized;
    settings.effortLevel = this.getDefaultReasoningValue(normalized, settings);
  },

  applyModelProjectionDefaults(model, settings): void {
    if (!isRecord(settings)) return;
    clearSavedEffortProjection(settings);
    if (!decodeCopilotModelId(model)) {
      delete settings.effortLevel;
      return;
    }
    settings.effortLevel = this.getDefaultReasoningValue(model, settings);
  },

  applyReasoningSelection(model, value, settings): void {
    if (!isRecord(settings)) return;
    const rawId = decodeCopilotModelId(model);
    if (!rawId) {
      clearSavedEffortProjection(settings);
      delete settings.effortLevel;
      return;
    }
    const preferredReasoningByModel = { ...getCopilotProviderSettings(settings).preferredReasoningByModel };
    if (COPILOT_EFFORT_VALUES.some(effort => effort === value)) {
      Object.defineProperty(preferredReasoningByModel, rawId, { value, enumerable: true, writable: true, configurable: true });
    } else {
      delete preferredReasoningByModel[rawId];
    }
    updateCopilotProviderSettings(settings, { preferredReasoningByModel });
  },

  normalizeModelVariant(model): string {
    return normalizeSelection(model);
  },

  getCustomModelIds(): Set<string> {
    return new Set();
  },
};

function normalizeSelection(model: string): string {
  const rawId = decodeCopilotModelId(model);
  return rawId ? encodeCopilotModelId(rawId) : model;
}

function clearSavedEffortProjection(settings: Record<string, unknown>): void {
  if (isRecord(settings.savedProviderEffort)) delete settings.savedProviderEffort[COPILOT_PROVIDER_ID];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
