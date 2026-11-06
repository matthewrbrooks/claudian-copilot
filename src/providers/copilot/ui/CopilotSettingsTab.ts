import * as fs from 'node:fs';
import * as path from 'node:path';

import { normalizeConfiguredCLIPath } from '@/core/process/cliPath';
import { resolveExecutionTarget } from '@/core/process/execution-target/ExecutionTargetResolver';
import { probeTargetCLIInstallation } from '@/core/providers/cli/TargetCLIInstallationProbe';
import { getRuntimeEnvironmentText } from '@/core/providers/providerEnvironment';
import { COPILOT_PROVIDER_ICON } from '@/shared/icons';
import { AccessibleSetting } from '@/shared/settings/AccessibleSetting';
import { renderCLIInstallationSetting } from '@/shared/settings/CLIInstallationSetting';

import { ProviderSettingsCoordinator } from '../../../core/providers/ProviderSettingsCoordinator';
import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type { ProviderSettingsTabRenderer } from '../../../core/providers/types';
import type { ClaudianSettings } from '../../../core/types';
import { t } from '../../../i18n/i18n';
import { renderEnvironmentSettingsSection } from '../../../shared/settings/EnvironmentSettingsSection';
import type { ProviderEnablementSettingOptions } from '../../../shared/settings/ProviderEnablementSetting';
import {
  renderLastEnabledProviderWarning,
  renderProviderModelEnablementWarning,
} from '../../../shared/settings/ProviderModelEnablementWarning';
import { renderProviderModelsSection } from '../../../shared/settings/ProviderModelsSection';
import type { CopilotWorkspaceServices } from '../app/CopilotWorkspaceServices';
import { buildCopilotRuntimeEnv } from '../runtime/CopilotRuntimeEnvironment';
import {
  COPILOT_PROVIDER_ID,
  getCopilotProviderSettings,
  updateCopilotProviderSettings,
} from '../settings';

const DISPLAY_NAME = 'GitHub Copilot';

export const copilotSettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
    const hostnameKey = context.plugin.storage.installationKey;
    const workspace = getCopilotWorkspaceServices();

    const enablement: Omit<ProviderEnablementSettingOptions, 'container' | 'description'> = {
      getValue: () => getCopilotProviderSettings(settingsBag).enabled,
      name: t('settings.providerEnablement.name', { provider: DISPLAY_NAME }),
      onChange: async (enabled) => {
        if (!ProviderSettingsCoordinator.canApplyProviderEnablement(settingsBag, COPILOT_PROVIDER_ID, enabled)) {
          lastProviderWarning.showFor();
          return;
        }
        let accepted = true;
        await context.plugin.runProviderExecutionTransition(
          [COPILOT_PROVIDER_ID],
          async () => context.plugin.mutateSettings((settings) => {
            accepted = ProviderSettingsCoordinator.applyProviderEnablement(settings, COPILOT_PROVIDER_ID, enabled);
          }),
        );
        if (accepted) lastProviderWarning.hide();
        else lastProviderWarning.showFor();
        modelWarning.context.notifyProviderModelOptionsChanged(COPILOT_PROVIDER_ID);
      },
    };

    const installationContainer = container.createDiv();
    const lastProviderWarning = renderLastEnabledProviderWarning(container);
    const modelWarning = renderProviderModelEnablementWarning(container, context, {
      getHasEnabledModels: () => {
        const current = getCopilotProviderSettings(settingsBag);
        return (current.visibleModels ?? current.currentCatalog?.models ?? []).length > 0;
      },
      getIsEnabled: () => getCopilotProviderSettings(settingsBag).enabled,
      providerId: COPILOT_PROVIDER_ID,
      providerName: DISPLAY_NAME,
    });

    renderCLIInstallationSetting({
      cliName: DISPLAY_NAME,
      container: installationContainer,
      enablement,
      getValue: () => {
        const current = getCopilotProviderSettings(settingsBag);
        return current.cliPathsByHost[hostnameKey] ?? current.cliPath ?? '';
      },
      icon: COPILOT_PROVIDER_ICON,
      inspect: async () => {
        const settings = context.plugin.settings as unknown as Record<string, unknown>;
        const config = getCopilotProviderSettings(settings);
        const command = await context.plugin.getResolvedProviderCliPath(COPILOT_PROVIDER_ID);
        return probeTargetCLIInstallation({
          args: ['--version'],
          command,
          configuredPath: config.cliPathsByHost[hostnameKey] || config.cliPath,
          env: buildCopilotRuntimeEnv(getRuntimeEnvironmentText(settings, COPILOT_PROVIDER_ID), command ?? ''),
          hostCwd: context.plugin.workingDirectory ?? process.cwd(),
          target: resolveExecutionTarget({ settings: { installationMethod: 'native-windows', wslDistroOverride: '' } }),
        });
      },
      name: t('settings.cliPath.genericName'),
      onChange: async (value) => {
        const cliPathsByHost = { ...getCopilotProviderSettings(settingsBag).cliPathsByHost };
        if (value) cliPathsByHost[hostnameKey] = value;
        else delete cliPathsByHost[hostnameKey];
        await context.plugin.applyProviderRuntimeSettings(
          [COPILOT_PROVIDER_ID],
          (settings: ClaudianSettings) => { updateCopilotProviderSettings(settings, { cliPath: '', cliPathsByHost }); },
          () => workspace.cliResolver.reset(),
        );
        modelWarning.context.notifyProviderModelOptionsChanged(COPILOT_PROVIDER_ID);
      },
      placeholder: process.platform === 'win32'
        ? 'C:\\Users\\you\\AppData\\Roaming\\npm\\copilot.cmd'
        : '/usr/local/bin/copilot',
      validate: validateCLIPath,
    });

    new AccessibleSetting(container).setName('Models').setHeading();
    const modelPicker = renderProviderModelsSection(
      container, COPILOT_PROVIDER_ID, DISPLAY_NAME, workspace.modelCatalog!, () => modelWarning.refresh(),
    );

    renderEnvironmentSettingsSection({
      container,
      desc: t('settings.copilot.environment.desc'),
      heading: t('settings.environment'),
      name: t('settings.copilot.environment.name'),
      placeholder: 'COPILOT_PROVIDER_BASE_URL=https://…',
      plugin: context.plugin,
      renderCustomContextLimits: target => context.renderCustomContextLimits(target, COPILOT_PROVIDER_ID),
      scope: `provider:${COPILOT_PROVIDER_ID}`,
    });
    return modelPicker;
  },
};

function validateCLIPath(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const expandedPath = normalizeConfiguredCLIPath(trimmed);
  if (!path.posix.isAbsolute(expandedPath) && !path.win32.isAbsolute(expandedPath)) {
    return t('settings.cliPath.validation.mustBeAbsolute');
  }
  try {
    if (!fs.existsSync(expandedPath)) return t('settings.cliPath.validation.notExist');
    if (!fs.statSync(expandedPath).isFile()) return t('settings.cliPath.validation.notFile');
    if (process.platform !== 'win32') fs.accessSync(expandedPath, fs.constants.X_OK);
  } catch {
    return process.platform === 'win32'
      ? t('settings.cliPath.validation.notAccessible')
      : t('settings.cliPath.validation.notExecutable');
  }
  return null;
}

function getCopilotWorkspaceServices(): CopilotWorkspaceServices {
  return ProviderWorkspaceRegistry.requireServices(COPILOT_PROVIDER_ID) as CopilotWorkspaceServices;
}
