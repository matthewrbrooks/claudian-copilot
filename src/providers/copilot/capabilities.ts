import type { ProviderCapabilities } from '../../core/providers/types';

/** Conservative until verified against `copilot --acp`: no fork, rewind, plan mode, fast mode or steering. */
export const COPILOT_PROVIDER_CAPABILITIES: Readonly<ProviderCapabilities> = Object.freeze({
  providerId: 'copilot',
  supportsResponseThroughput: false,
  supportsNativeHistory: false,
  supportsEphemeralSessions: false,
  supportsRewind: false,
  supportsFork: false,
  supportsProviderCommands: true,
  supportsImageAttachments: true,
  supportsTurnSteer: false,
  reasoningControl: 'effort',
});
