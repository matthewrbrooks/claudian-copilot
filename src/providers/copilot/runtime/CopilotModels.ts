import { createConfigCatalogStore, ProviderModelCatalogController } from '../../../core/providers/models/ProviderModelCatalog';
import type { ProviderRuntimeHost } from '../../../core/providers/ProviderRuntimeHost';
import { decodeCopilotConfig, getOrderedCopilotVisibleModelIds, updateCopilotConfig } from '../config';
import type { CopilotModelCatalog } from './CopilotModelCatalog';

export function createCopilotModels(
  host: ProviderRuntimeHost,
  catalog: Pick<CopilotModelCatalog, 'refresh'>,
): ProviderModelCatalogController {
  return new ProviderModelCatalogController({
    providerName: 'GitHub Copilot',
    store: createConfigCatalogStore(host, {
      update: updateCopilotConfig,
      read: (config, selection) => {
        const current = decodeCopilotConfig(config, selection);
        return {
          aliases: current.modelAliases,
          enabled: current.enabled,
          models: (current.currentCatalog?.models ?? []).map(model => ({ id: model.rawId, name: model.displayName })),
          selectedIds: getOrderedCopilotVisibleModelIds(current),
        };
      },
    }),
    discover: signal => catalog.refresh(signal),
  });
}
