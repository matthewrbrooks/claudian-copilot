import type { ProviderChatUIConfig } from '../../../core/providers/types';
import { COPILOT_PROVIDER_ICON } from '../../../shared/icons';
import { copilotModelPolicy } from '../CopilotModelPolicy';
import { COPILOT_PERMISSION_MODE_OPTIONS } from '../permissionModes';

export const copilotChatUIConfig: ProviderChatUIConfig = {
  ...copilotModelPolicy,
  getPermissionModeOptions() {
    return COPILOT_PERMISSION_MODE_OPTIONS;
  },
  getModeSelector(): null {
    return null;
  },
  getProviderIcon() {
    return COPILOT_PROVIDER_ICON;
  },
};
