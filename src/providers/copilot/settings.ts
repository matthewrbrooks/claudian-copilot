import { selectModelMetadata } from '../../core/providers/models/selectedModelMetadata';
import { getProviderConfig, getProviderSelectionInputs, setProviderConfig } from '../../core/providers/providerConfig';
import {
  type CopilotProviderSettings,
  decodeCopilotConfig,
  getCopilotMigratedVisibleModelIds,
  updateCopilotConfig,
} from './config';

export const COPILOT_PROVIDER_ID = 'copilot' as const;

/** Reads Copilot's configuration from the settings document. */
export function getCopilotProviderSettings(settings: Record<string, unknown>): CopilotProviderSettings {
  return decodeCopilotConfig(
    getProviderConfig(settings, COPILOT_PROVIDER_ID),
    getProviderSelectionInputs(settings, COPILOT_PROVIDER_ID),
  );
}

/** Writes Copilot's configuration into the settings document. */
export function updateCopilotProviderSettings(
  settings: Record<string, unknown>,
  updates: Partial<CopilotProviderSettings>,
): CopilotProviderSettings {
  const config = getProviderConfig(settings, COPILOT_PROVIDER_ID);
  const next = updateCopilotConfig(config, getProviderSelectionInputs(settings, COPILOT_PROVIDER_ID), updates);
  setProviderConfig(settings, COPILOT_PROVIDER_ID, config);
  return next;
}

/** Durable projection: only selected models persist; full discovery catalogs stay runtime-only. */
export function projectCopilotModelSettings(settings: Record<string, unknown>): Record<string, unknown> {
  const current = getCopilotProviderSettings(settings);
  const visibleModels = getCopilotMigratedVisibleModelIds(current);
  const selected = new Set(visibleModels);
  const selectedModelsByHost = Object.fromEntries(Object.entries(current.catalogsByHost).map(([host, catalog]) => [host, {
    ...catalog,
    defaultModelId: catalog.defaultModelId && selected.has(catalog.defaultModelId) ? catalog.defaultModelId : null,
    models: catalog.models.filter(model => selected.has(model.rawId)),
  }]));
  const config: Record<string, unknown> = {
    ...getProviderConfig(settings, COPILOT_PROVIDER_ID),
    modelAliases: selectModelMetadata(current.modelAliases, selected),
    preferredReasoningByModel: selectModelMetadata(current.preferredReasoningByModel, selected),
    selectedModelsByHost,
    visibleModels,
  };
  delete config.catalogsByHost;
  delete config.currentCatalog;
  return config;
}
