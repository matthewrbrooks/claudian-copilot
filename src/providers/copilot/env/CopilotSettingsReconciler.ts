import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import type { ProviderSettingsReconciler } from '../../../core/providers/types';
import { decodeCopilotModelId, encodeCopilotModelId } from '../models';
import { computeCopilotRuntimeInputHash } from '../runtime/CopilotRuntimeEnvironment';
import {
  COPILOT_PROVIDER_ID,
  getCopilotProviderSettings,
  updateCopilotProviderSettings,
} from '../settings';

export const copilotSettingsReconciler: ProviderSettingsReconciler = {
  // Native sessions live in the Copilot CLI's own store; a changed launch only reloads them.
  invalidateConversationSessions: () => [],

  reconcileModelWithEnvironment(settings) {
    const current = getCopilotProviderSettings(settings);
    if (!current.enabled) return { changed: false };
    const environmentHash = computeCopilotRuntimeInputHash(
      current,
      getRuntimeEnvironmentText(settings, COPILOT_PROVIDER_ID),
    );
    if (current.environmentHash === environmentHash) return { changed: false };
    updateCopilotProviderSettings(settings, { environmentHash });
    return { changed: true, sessionPolicy: 'reload' };
  },

  normalizeModelVariantSettings(settings): boolean {
    let changed = normalizeSelectionAt(settings, 'model');
    changed = normalizeSelectionAt(settings, 'titleGenerationModel') || changed;
    const saved = settings.savedProviderModel;
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      changed = normalizeSelectionAt(saved as Record<string, unknown>, COPILOT_PROVIDER_ID) || changed;
    }
    return changed;
  },
};

function normalizeSelectionAt(settings: Record<string, unknown>, key: string): boolean {
  const current = settings[key];
  if (typeof current !== 'string') return false;
  const rawId = decodeCopilotModelId(current);
  const normalized = rawId ? encodeCopilotModelId(rawId) : null;
  if (normalized === null || normalized === current) return false;
  settings[key] = normalized;
  return true;
}
