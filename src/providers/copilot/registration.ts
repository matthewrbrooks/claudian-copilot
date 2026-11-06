import { NOOP_TASK_RESULT_INTERPRETER } from '../../core/providers/NoopTaskResultInterpreter';
import { getProviderConfig } from '../../core/providers/providerConfig';
import { hasStoredConfigNormalization } from '../../core/providers/settings/storedSettings';
import type { ProviderModule } from '../../core/providers/types';
import {
  copilotWorkspaceRegistration,
  getCopilotWorkspaceServices,
} from './app/CopilotWorkspaceServices';
import { COPILOT_PROVIDER_CAPABILITIES } from './capabilities';
import { getCopilotMigratedVisibleModelIds } from './config';
import { copilotModelPolicy } from './CopilotModelPolicy';
import { copilotSettingsReconciler } from './env/CopilotSettingsReconciler';
import { CopilotExecutionBackend } from './execution/CopilotExecutionBackend';
import { CopilotConversationHistoryService } from './history/CopilotConversationHistoryService';
import {
  COPILOT_PROVIDER_ID,
  getCopilotProviderSettings,
  projectCopilotModelSettings,
  updateCopilotProviderSettings,
} from './settings';
import { copilotChatUIConfig } from './ui/CopilotChatUIConfig';

export const copilotProviderRegistration: ProviderModule = {
  id: COPILOT_PROVIDER_ID,
  blankTabOrder: 16,
  capabilities: COPILOT_PROVIDER_CAPABILITIES,
  chatUIConfig: copilotChatUIConfig,
  createExecutionBackend: plugin => new CopilotExecutionBackend(plugin.getRuntimeHost(COPILOT_PROVIDER_ID), {
    modelSink: getCopilotWorkspaceServices().modelCatalogOwner,
  }),
  displayName: 'GitHub Copilot',
  environmentKeyPatterns: [/^COPILOT_/i, /^GH_/i, /^GITHUB_/i],
  historyService: new CopilotConversationHistoryService(),
  isEnabled: settings => getCopilotProviderSettings(settings).enabled,
  modelPolicy: copilotModelPolicy,
  setEnabled: (settings, enabled) => updateCopilotProviderSettings(settings, { enabled }),
  settingsReconciler: copilotSettingsReconciler,
  settingsStorage: {
    hostScopedFields: ['cliPathsByHost', 'catalogsByHost', 'selectedModelsByHost'],
    normalizeStored(target, stored) {
      const storedConfig = getProviderConfig(stored, COPILOT_PROVIDER_ID);
      const current = getCopilotProviderSettings(stored);
      updateCopilotProviderSettings(target, { ...current, visibleModels: getCopilotMigratedVisibleModelIds(current) });
      return hasStoredConfigNormalization(storedConfig, getProviderConfig(target, COPILOT_PROVIDER_ID));
    },
    projectPersistedConfig: projectCopilotModelSettings,
  },
  taskResultInterpreter: NOOP_TASK_RESULT_INTERPRETER,
  workspace: copilotWorkspaceRegistration,
};
