import { CachedProviderCLIResolver } from '../../../core/providers/cli/CachedProviderCLIResolver';
import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import { COPILOT_PROVIDER_ID, getCopilotProviderSettings } from '../settings';

export class CopilotCLIResolver {
  private readonly resolver = new CachedProviderCLIResolver({
    binaryName: 'copilot',
    getSettingsProjection: (settings) => {
      const providerSettings = getCopilotProviderSettings(settings);
      return {
        cliPathsByHost: providerSettings.cliPathsByHost,
        environmentText: getRuntimeEnvironmentText(settings, COPILOT_PROVIDER_ID),
        legacyCliPath: providerSettings.cliPath,
      };
    },
    providerId: COPILOT_PROVIDER_ID,
  });

  resolveFromSettings(settings: Record<string, unknown>): string | null {
    return this.resolver.resolveFromSettings(settings);
  }

  reset(): void {
    this.resolver.reset();
  }
}
