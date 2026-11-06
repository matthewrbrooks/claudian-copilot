import { resolveExecutionTarget } from '@/core/process/execution-target/ExecutionTargetResolver';
import { buildTargetLaunchSpec } from '@/core/process/execution-target/TargetLaunchSpec';
import type { TargetLaunchSpec } from '@/core/process/execution-target/types';
import type { ProviderRuntimeHost } from '@/core/providers/ProviderRuntimeHost';
import type { ProviderCLIResolutionContext } from '@/core/providers/types';

import { buildCopilotRuntimeEnv } from './CopilotRuntimeEnvironment';

/** Copilot runs on the host only; WSL installations are not supported. */
export async function resolveCopilotLaunchSpec(
  host: ProviderRuntimeHost,
  args: readonly string[],
  hostCwd = host.workingDirectory ?? process.cwd(),
  ownerContext?: ProviderCLIResolutionContext,
): Promise<TargetLaunchSpec> {
  const command = await host.resolveCliPath(ownerContext) ?? 'copilot';
  return buildTargetLaunchSpec({
    args,
    command,
    env: buildCopilotRuntimeEnv(host.environmentText, command),
    hostCwd,
    target: resolveExecutionTarget({ settings: { installationMethod: 'native-windows', wslDistroOverride: '' } }),
  });
}
