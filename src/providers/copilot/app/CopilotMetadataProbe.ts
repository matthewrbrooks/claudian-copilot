import { OwnedProbeRegistry } from '@/core/providers/metadata/OwnedProbeRegistry';
import { ProviderTransitionFence } from '@/core/providers/metadata/ProviderTransitionFence';
import type { ProviderRuntimeHost } from '@/core/providers/ProviderRuntimeHost';
import type { SlashCommand } from '@/core/types';
import { type ACPSessionNotification, normalizeACPAvailableCommands } from '@/providers/acp';

import { CopilotNativeConnection } from '../execution/CopilotNativeConnection';
import { type CopilotModel, readCopilotSessionModels } from '../models';
import { resolveCopilotLaunchSpec } from '../runtime/CopilotExecutionContext';
import { buildCopilotACPArgs } from '../runtime/CopilotLaunchArgs';

export interface CopilotMetadata {
  readonly commands: SlashCommand[];
  readonly currentModelId: string | null;
  readonly models: CopilotModel[];
}

const ABORT_MESSAGE = 'GitHub Copilot metadata probe aborted';
const DISPOSED_MESSAGE = 'GitHub Copilot metadata probe is disposed.';
/** Commands arrive in a notification after `session/new` returns (timing unverified). */
const COMMANDS_WAIT_MS = 3_000;

/** Reads models and commands from a prompt-less session that is closed at once. */
export class CopilotMetadataProbe {
  private disposeFlight: Promise<void> | null = null;
  private inFlight: Promise<CopilotMetadata> | null = null;
  private readonly probes = new OwnedProbeRegistry<CopilotNativeConnection>({
    abortMessage: ABORT_MESSAGE,
    dispose: native => native.shutdown(),
    unavailableError: () => new Error(DISPOSED_MESSAGE),
  });
  private readonly transitionFence = new ProviderTransitionFence({ abortMessage: ABORT_MESSAGE });

  constructor(private readonly host: ProviderRuntimeHost) {}

  /** Concurrent callers share one probe. */
  async load(signal?: AbortSignal): Promise<CopilotMetadata> {
    if (this.transitionFence.isUnavailable()) {
      const available = await this.transitionFence.waitUntilAvailable(signal);
      if (!available) throw new Error(DISPOSED_MESSAGE);
    }
    if (signal?.aborted) throw new Error(ABORT_MESSAGE);
    if (!this.inFlight) {
      const flight = this.#probe();
      this.inFlight = flight;
      const clear = () => { if (this.inFlight === flight) this.inFlight = null; };
      flight.then(clear, clear);
    }
    const flight = this.inFlight;
    if (!signal) return flight;
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(new Error(ABORT_MESSAGE));
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      return await Promise.race([flight, aborted]);
    } finally {
      signal.removeEventListener('abort', onAbort!);
    }
  }

  #probe(): Promise<CopilotMetadata> {
    return this.probes.run({
      create: async (ownedSignal) => {
        const launch = await resolveCopilotLaunchSpec(this.host, buildCopilotACPArgs());
        ownedSignal.throwIfAborted();
        return new CopilotNativeConnection({
          launch,
          requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
          version: this.host.clientVersion ?? '0.0.0',
        });
      },
      initialize: async (native) => { await native.initialize(); },
      query: async (native, ownedSignal) => {
        let resolveCommands!: (commands: SlashCommand[]) => void;
        const commandsReceived = new Promise<SlashCommand[]>(resolve => { resolveCommands = resolve; });
        let sessionId: string | null = null;
        const pending: ACPSessionNotification[] = [];
        const accept = (notification: ACPSessionNotification) => {
          if (notification.update.sessionUpdate === 'available_commands_update' && notification.sessionId === sessionId) {
            resolveCommands(normalizeACPAvailableCommands(notification.update.availableCommands));
          }
        };
        const unsubscribe = native.onNotification(notification => {
          if (sessionId) accept(notification);
          else pending.push(notification);
        });
        try {
          const response = await native.newSession({ cwd: native.launch.targetCwd, mcpServers: [] });
          sessionId = response.sessionId;
          pending.splice(0).forEach(accept);
          let timer: number | undefined;
          const commands = await Promise.race([
            commandsReceived,
            new Promise<SlashCommand[]>(resolve => { timer = window.setTimeout(() => resolve([]), COMMANDS_WAIT_MS); }),
          ]).finally(() => window.clearTimeout(timer));
          ownedSignal.throwIfAborted();
          await native.closeSession(response.sessionId).catch(() => undefined);
          const { currentModelId, models } = readCopilotSessionModels(response.configOptions, response.models);
          return { commands, currentModelId, models };
        } finally {
          unsubscribe();
        }
      },
    });
  }

  beginEnvironmentTransition(): void {
    this.transitionFence.beginTransition();
  }

  endEnvironmentTransition(): void {
    this.transitionFence.endTransition();
  }

  quiesceForEnvironmentChange(): Promise<void> {
    return this.probes.quiesce();
  }

  dispose(): Promise<void> {
    if (this.disposeFlight) return this.disposeFlight;
    this.transitionFence.dispose();
    this.disposeFlight = this.probes.dispose();
    return this.disposeFlight;
  }
}
