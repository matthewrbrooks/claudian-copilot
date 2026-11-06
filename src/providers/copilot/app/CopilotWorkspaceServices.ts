import type { ProviderCommandCatalog } from '../../../core/providers/commands/ProviderCommandCatalog';
import type { ProviderHost } from '../../../core/providers/ProviderHost';
import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../core/providers/types';
import { CopilotCommandCatalog } from '../commands/CopilotCommandCatalog';
import { CopilotCLIResolver } from '../runtime/CopilotCLIResolver';
import { CopilotModelCatalog } from '../runtime/CopilotModelCatalog';
import { createCopilotModels } from '../runtime/CopilotModels';
import { COPILOT_PROVIDER_ID } from '../settings';
import { copilotSettingsTabRenderer } from '../ui/CopilotSettingsTab';
import { CopilotCommandLoader } from './CopilotCommandLoader';
import { CopilotMetadataProbe } from './CopilotMetadataProbe';

export interface CopilotWorkspaceServices extends ProviderWorkspaceServices {
  cliResolver: CopilotCLIResolver;
  commandCatalog: ProviderCommandCatalog;
  modelCatalogOwner: CopilotModelCatalog;
  dispose(): Promise<void>;
}

export async function createCopilotWorkspaceServices(plugin: ProviderHost): Promise<CopilotWorkspaceServices> {
  const runtimeHost = plugin.getRuntimeHost(COPILOT_PROVIDER_ID);
  const metadataProbe = new CopilotMetadataProbe(runtimeHost);
  const modelCatalogOwner = new CopilotModelCatalog(runtimeHost, signal => metadataProbe.load(signal));
  const modelCatalog = createCopilotModels(runtimeHost, modelCatalogOwner);
  const unregisterTransitionHook = plugin.executionLifecycleRegistry.registerTransitionHook(COPILOT_PROVIDER_ID, {
    beforeTransition: async () => {
      modelCatalog.beginTransition();
      metadataProbe.beginEnvironmentTransition();
      await metadataProbe.quiesceForEnvironmentChange();
    },
    afterTransition: async () => {
      try {
        await metadataProbe.quiesceForEnvironmentChange();
      } finally {
        metadataProbe.endEnvironmentTransition();
        modelCatalog.endTransition();
      }
    },
  });

  return {
    cliResolver: new CopilotCLIResolver(),
    commandCatalog: new CopilotCommandCatalog(),
    commandLoader: new CopilotCommandLoader(metadataProbe),
    modelCatalog,
    modelCatalogOwner,
    settingsTabRenderer: copilotSettingsTabRenderer,
    async dispose() {
      unregisterTransitionHook();
      modelCatalogOwner.dispose();
      await Promise.all([modelCatalog.dispose(), metadataProbe.dispose()]);
    },
  };
}

export const copilotWorkspaceRegistration: ProviderWorkspaceRegistration<CopilotWorkspaceServices> = {
  consumesAgentSkills: true,
  initialize: async ({ plugin }) => createCopilotWorkspaceServices(plugin),
};

export function getCopilotWorkspaceServices(): CopilotWorkspaceServices {
  return ProviderWorkspaceRegistry.requireServices(COPILOT_PROVIDER_ID) as CopilotWorkspaceServices;
}
