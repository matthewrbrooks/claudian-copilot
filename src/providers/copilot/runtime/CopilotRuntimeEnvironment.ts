import { getInstallationKey } from '@/core/device/InstallationKey';
import { getEnhancedPath, parseEnvironmentVariables } from '@/core/process/env';

import { createCLIPathFingerprintInputs } from '../../../core/providers/cli/CLIPathFingerprintInputs';
import { createRuntimeInputFingerprint } from '../../../core/providers/settings/RuntimeInputFingerprint';
import type { CopilotProviderSettings } from '../config';

const INHERITED_ENV_KEYS = new Set([
  'APPDATA', 'COMSPEC', 'HOME', 'HOMEDRIVE', 'HOMEPATH', 'HOSTNAME', 'LANG', 'LOCALAPPDATA', 'LOGNAME', 'NODE_EXTRA_CA_CERTS',
  'NO_PROXY', 'PATH', 'PATHEXT', 'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'SHELL', 'SSL_CERT_DIR', 'SSL_CERT_FILE',
  'SYSTEMDRIVE', 'SYSTEMROOT', 'TEMP', 'TERM', 'TMP', 'TMPDIR', 'TZ', 'USER', 'USERNAME', 'USERPROFILE', 'WINDIR',
]);
const INHERITED_ENV_PREFIXES = ['COPILOT_', 'GH_', 'GITHUB_', 'LC_', 'XDG_'];
const PROXY_ENV_KEY = /^(?:https?|all)_proxy$/i;

function isInheritedEnvKey(key: string): boolean {
  const upper = key.toUpperCase();
  return INHERITED_ENV_KEYS.has(upper)
    || INHERITED_ENV_PREFIXES.some(prefix => upper.startsWith(prefix))
    || PROXY_ENV_KEY.test(key);
}

/**
 * The CLI can run shell commands, so only an allowlisted part of Obsidian's environment is inherited.
 * Variables from the provider's own environment setting always pass through.
 */
export function buildCopilotRuntimeEnv(environmentText: string, cliPath: string): Record<string, string> {
  const configured = parseEnvironmentVariables(environmentText);
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => isInheritedEnvKey(key)));
  const env: NodeJS.ProcessEnv = {
    ...inherited,
    ...configured,
    PATH: getEnhancedPath(configured.PATH, cliPath || undefined),
  };
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

/** Fingerprint of the launch inputs: this installation's CLI path and the environment. */
export function computeCopilotRuntimeInputHash(
  settings: Pick<CopilotProviderSettings, 'cliPath' | 'cliPathsByHost'>,
  environmentText: string,
): string {
  const environment = Object.entries(parseEnvironmentVariables(environmentText))
    .sort(([left], [right]) => left.localeCompare(right));
  return createRuntimeInputFingerprint({
    additionalInputs: createCLIPathFingerprintInputs(settings.cliPathsByHost[getInstallationKey()], settings.cliPath),
    environmentKeys: environment.map(([key]) => key),
    environmentText,
  });
}
