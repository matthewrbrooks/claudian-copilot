import type {
  ProviderPermissionModeOption,
  ProviderPermissionModePolicy,
} from '../../core/providers/types';

export const COPILOT_PERMISSION_MODES = ['normal', 'yolo'] as const;

export const COPILOT_PERMISSION_MODE_POLICY: ProviderPermissionModePolicy = Object.freeze({
  values: COPILOT_PERMISSION_MODES,
  fallbackValue: 'normal',
  defaultValue: 'normal',
});

export const COPILOT_PERMISSION_MODE_OPTIONS: readonly ProviderPermissionModeOption[] = Object.freeze([
  { value: 'normal', label: 'Ask', description: 'Ask before edits and commands' },
  {
    value: 'yolo',
    label: 'YOLO',
    description: 'Accept all permissions without asking',
    bypassesApprovals: true,
  },
]);

/** Claudian approves YOLO prompts itself; the process never gets `--allow-all`, so modes switch without restarts. */
export function shouldAutoApproveCopilotPermission(permissionMode: string | undefined): boolean {
  return permissionMode === 'yolo';
}
