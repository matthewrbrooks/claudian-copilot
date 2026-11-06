import type {
  ProviderExecutionBackend,
  ProviderExecutionSession,
  ProviderSessionConfig,
} from '../../../core/execution';
import type { ProviderRuntimeHost } from '../../../core/providers/ProviderRuntimeHost';
import {
  CopilotExecutionSession,
  type CopilotExecutionSessionOptions,
} from './CopilotExecutionSession';

export class CopilotExecutionBackend implements ProviderExecutionBackend {
  readonly providerId = 'copilot' as const;

  constructor(
    private readonly host: ProviderRuntimeHost,
    private readonly options: CopilotExecutionSessionOptions = {},
  ) {}

  createSession(config: ProviderSessionConfig): ProviderExecutionSession {
    return new CopilotExecutionSession(this.host, config, this.options);
  }
}
