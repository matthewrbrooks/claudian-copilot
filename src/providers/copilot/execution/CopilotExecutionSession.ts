import { randomUUID } from 'node:crypto';

import {
  buildContextFromHistory,
  buildPromptWithHistoryContext,
} from '@/core/prompt/historyContext';
import { appendExecutionContext } from '@/core/prompt/promptContext';
import { invokeSessionTool } from '@/core/session-tools/invokeSessionTool';
import { SESSION_TOOL_ROUTE_HEADER, type SessionToolRoute } from '@/core/session-tools/SessionToolEndpoint';
import { SESSION_TOOL_MCP_SERVER_NAME } from '@/core/session-tools/sessionToolMCP';
import { isSessionTool } from '@/core/tools/toolNames';
import {
  type ACPContentBlock,
  ACPInteractionController,
  type ACPMCPServer,
  type ACPPromptResponse,
  ACPRequestedTurn,
  type ACPRequestPermissionRequest,
  type ACPRequestPermissionResponse,
  type ACPSessionConfigOption,
  type ACPSessionModelState,
  type ACPSessionNotification,
  buildACPUsageInfo,
  mapACPApprovalDecision,
  normalizeACPAvailableCommands,
} from '@/providers/acp';

import {
  type ProviderExecutionRequest,
  type ProviderExecutionRun,
  type ProviderExecutionSession,
  type ProviderSessionConfig,
  type ProviderSessionEvent,
  type ProviderSessionInvalidation,
  type ProviderSessionSnapshot,
  type ProviderSessionStatus,
  RequestedRunChannel,
  SessionSnapshotState,
} from '../../../core/execution';
import type { ProviderRuntimeHost } from '../../../core/providers/ProviderRuntimeHost';
import type { ChatMessage, SlashCommand } from '../../../core/types';
import {
  type CopilotModel,
  decodeCopilotModelId,
  findCopilotModelConfigOption,
  isCopilotEffort,
  readCopilotSessionModels,
} from '../models';
import {
  createCopilotToolStreamAdapter,
  findCopilotSessionToolName,
  normalizeCopilotToolName,
} from '../normalization/copilotToolNormalization';
import { shouldAutoApproveCopilotPermission } from '../permissionModes';
import { resolveCopilotLaunchSpec } from '../runtime/CopilotExecutionContext';
import { buildCopilotACPArgs } from '../runtime/CopilotLaunchArgs';
import { parseCopilotProviderState } from '../types';
import { CopilotNativeConnection } from './CopilotNativeConnection';

export interface CopilotLiveModelSink {
  mergeLiveModels(models: CopilotModel[], defaultModelId: string | null): Promise<unknown>;
}

export interface CopilotExecutionSessionOptions {
  readonly modelSink?: CopilotLiveModelSink;
}

interface ActiveExecution {
  readonly abortController: AbortController;
  /** Set once the run starts native work; cancelling before any prompt then retires the process. */
  nativeTouched: boolean;
  prompt: Promise<ACPPromptResponse> | null;
  readonly request: ProviderExecutionRequest;
  readonly run: RequestedRunChannel;
  readonly turn: ACPRequestedTurn;
}

interface NativeOwner {
  /** Latest `available_commands_update` per native session; it can precede session capture. */
  readonly commandsBySession: Map<string, SlashCommand[]>;
  configOptions: ACPSessionConfigOption[];
  currentModelId: string | null;
  /** The `--effort` this process was launched with; it cannot change without a relaunch. */
  readonly effort: string | undefined;
  initialized: boolean;
  loadedSessionId: string | null;
  readonly native: CopilotNativeConnection;
  unsubscribe: () => void;
}

const CANCEL_SETTLE_TIMEOUT_MS = 2_000;

const PASSIVE_TOOL_INSTRUCTION = [
  'Do not use any tools for this request.',
  'Answer only from information supplied directly in the prompt.',
].join(' ');

export class CopilotExecutionSession implements ProviderExecutionSession {
  readonly providerId = 'copilot' as const;
  readonly sessionInstanceId = randomUUID();

  private active: ActiveExecution | null = null;
  private cancellationFlight: Promise<void> | null = null;
  private disposalFlight: Promise<void> | null = null;
  private disposed = false;
  private nativeConversationContextEstablished: boolean;
  private nativeOwner: NativeOwner | null = null;
  private nativeStartupFlight: Promise<NativeOwner> | null = null;
  private providerSessionId: string | undefined;
  private sessionToolRoute: Promise<SessionToolRoute> | null = null;
  private readonly interactionController: ACPInteractionController;
  private readonly state: SessionSnapshotState;

  constructor(
    private readonly host: ProviderRuntimeHost,
    private readonly config: ProviderSessionConfig,
    private readonly options: CopilotExecutionSessionOptions = {},
  ) {
    this.providerSessionId = config.resumeSeed?.providerSessionId;
    const providerState = parseCopilotProviderState(config.resumeSeed?.providerState);
    this.state = new SessionSnapshotState({
      providerId: this.providerId,
      providerState: { ...providerState },
      readProviderSessionId: () => this.providerSessionId,
      sessionInstanceId: this.sessionInstanceId,
    });
    this.nativeConversationContextEstablished = Boolean(
      this.providerSessionId && providerState.nativeConversationContextEstablished !== false,
    );
    this.interactionController = new ACPInteractionController({
      getTurnId: () => this.active?.run.turnId ?? null,
      interactionPort: config.interactionPort,
      presentPermission: request => {
        const name = readPermissionToolName(request);
        return { description: request.toolCall.title || name, toolName: name };
      },
      sessionInstanceId: this.sessionInstanceId,
    });
  }

  execute(request: ProviderExecutionRequest): ProviderExecutionRun {
    if (this.disposed) throw new Error('GitHub Copilot execution session is disposed.');
    if (this.active) throw new Error('GitHub Copilot execution session is already executing.');
    const run = new RequestedRunChannel({
      onCancel: source => { void this.#cancelRun(run, source === 'abort-signal' ? 'aborted' : 'cancelled'); },
      sessionInstanceId: this.sessionInstanceId,
    });
    const active: ActiveExecution = {
      abortController: new AbortController(),
      nativeTouched: false,
      prompt: null,
      request,
      run,
      turn: new ACPRequestedTurn({
        onAccept: () => {
          if (this.nativeConversationContextEstablished) return;
          this.#setNativeConversationContextEstablished(true);
          this.#updateSnapshot('executing');
          this.#emitCurrentSnapshot();
        },
        run,
        toolStreamAdapter: createCopilotToolStreamAdapter(),
      }),
    };
    this.active = active;
    this.#updateSnapshot('executing');
    this.#emitCurrentSnapshot();
    run.attachAbortSignal(request.signal);
    if (!run.isCancellationRequested) void this.#performExecution(active);
    return run;
  }

  cancel(): void {
    this.active?.run.cancel();
  }

  getCommandSnapshot(): readonly SlashCommand[] | undefined {
    const sessionId = this.providerSessionId;
    const commands = sessionId ? this.nativeOwner?.commandsBySession.get(sessionId) : undefined;
    return commands?.map(command => ({ ...command }));
  }

  getSnapshot(): ProviderSessionSnapshot {
    return this.state.getSnapshot();
  }

  getStatus(): ProviderSessionStatus {
    return this.state.status;
  }

  onEvent(listener: (event: ProviderSessionEvent) => void): () => void {
    return this.state.onEvent(listener);
  }

  dispose(): Promise<void> {
    if (this.disposalFlight) return this.disposalFlight;
    this.disposed = true;
    this.disposalFlight = (async () => {
      try {
        const active = this.active;
        if (active) await this.#cancelRun(active.run, 'session-disposed');
        if (this.cancellationFlight) await this.cancellationFlight;
        await this.#shutdownNative();
      } finally {
        const route = await this.sessionToolRoute?.catch(() => null);
        route?.dispose();
        this.interactionController.dispose();
        this.state.clearListeners();
        this.#updateSnapshot('disposed');
      }
    })();
    return this.disposalFlight;
  }

  async #performExecution(active: ActiveExecution): Promise<void> {
    if (active.request.toolPolicy.kind === 'allow-list') {
      this.#failUnrecoverable(active, 'GitHub Copilot does not support exact tool allow-lists.');
      return;
    }
    let unsubscribeClose: (() => void) | undefined;
    try {
      if (this.cancellationFlight) await this.cancellationFlight;
      if (this.#isCancellationRequested(active)) return;
      active.nativeTouched = true;
      const owner = await this.#ensureSession(active);
      if (this.#isCancellationRequested(active)) return;
      await this.#applyConfiguration(owner, active);
      if (this.#isCancellationRequested(active)) return;
      const sessionId = this.providerSessionId!;
      active.turn.beginLiveOutput();
      const closed = new Promise<never>((_resolve, reject) => {
        unsubscribeClose = owner.native.onClose(error => reject(new Error('GitHub Copilot transport closed', { cause: error })));
      });
      const prompt = owner.native.prompt({
        prompt: buildPromptBlocks(active.request, !this.nativeConversationContextEstablished),
        sessionId,
      });
      active.prompt = prompt;
      active.run.emit({ content: getInputText(active.request), type: 'user_message_started' });
      const response = await Promise.race([closed, prompt]);
      if (this.#isCancellationRequested(active)) return;
      this.#finishCompleted(active, response);
    } catch (error) {
      if (this.#isCancellationRequested(active)) return;
      this.#failRecoverable(active, error);
    } finally {
      unsubscribeClose?.();
    }
  }

  async #ensureNative(active: ActiveExecution, effort: string | undefined): Promise<NativeOwner> {
    const owner = this.nativeOwner;
    if (!this.nativeStartupFlight && owner?.initialized && owner.native.isAlive() && owner.effort === effort) return owner;
    let flight = this.nativeStartupFlight;
    if (!flight) {
      flight = this.#startNative(active, effort);
      this.nativeStartupFlight = flight;
      const clear = () => { if (this.nativeStartupFlight === flight) this.nativeStartupFlight = null; };
      flight.then(clear, clear);
    }
    const started = await flight;
    this.#throwIfCancellationRequested(active);
    return started;
  }

  async #startNative(active: ActiveExecution, effort: string | undefined): Promise<NativeOwner> {
    const previous = this.nativeOwner;
    if (previous) await this.#shutdownNativeOwner(previous);
    const launch = await resolveCopilotLaunchSpec(this.host, buildCopilotACPArgs({ effort }), this.config.workingDirectory);
    // A run cancelled during CLI lookup must not spawn a process that cancellation then waits on.
    this.#throwIfCancellationRequested(active);
    const native = new CopilotNativeConnection({
      launch,
      requestPermission: request => this.#handlePermission(request),
      version: this.host.clientVersion ?? '0.0.0',
    });
    const owner: NativeOwner = {
      commandsBySession: new Map(),
      configOptions: [],
      currentModelId: null,
      effort,
      initialized: false,
      loadedSessionId: null,
      native,
      unsubscribe: () => {},
    };
    this.nativeOwner = owner;
    try {
      owner.unsubscribe = native.onNotification(notification => {
        if (this.#isCurrentOwner(owner)) this.#handleNotification(owner, notification);
      });
      await native.initialize();
      if (this.disposed || !this.#isCurrentOwner(owner)) throw new CopilotExecutionCancellationError();
      owner.initialized = true;
      return owner;
    } catch (error) {
      await this.#shutdownNativeOwner(owner).catch(() => undefined);
      throw error;
    }
  }

  async #ensureSession(active: ActiveExecution): Promise<NativeOwner> {
    const reasoning = active.request.configuration.reasoning?.trim();
    const owner = await this.#ensureNative(active, isCopilotEffort(reasoning) ? reasoning : undefined);
    if (this.providerSessionId && owner.loadedSessionId === this.providerSessionId) return owner;
    const mcpServers = await this.#getMCPServers();
    this.#throwIfCancellationRequested(active);
    const request = { cwd: owner.native.launch.targetCwd, mcpServers };
    if (this.providerSessionId) {
      if (owner.native.supportsLoadSession()) {
        try {
          const response = await owner.native.loadSession({ ...request, sessionId: this.providerSessionId });
          this.#throwIfCancellationRequested(active);
          owner.loadedSessionId = this.providerSessionId;
          this.#adoptConfigOptions(owner, response.configOptions, response.models);
          this.#emitCurrentSnapshot();
          return owner;
        } catch (error) {
          if (this.#isCancellationRequested(active) || !owner.native.isAlive()) throw error;
          // The native session is gone; continue in a fresh one that replays Claudian's transcript.
        }
      }
      this.providerSessionId = undefined;
    }
    const response = await owner.native.newSession(request);
    this.providerSessionId = response.sessionId;
    owner.loadedSessionId = response.sessionId;
    this.#setNativeConversationContextEstablished(false);
    this.#adoptConfigOptions(owner, response.configOptions, response.models);
    this.#updateSnapshot('executing');
    this.#emitCurrentSnapshot();
    this.#throwIfCancellationRequested(active);
    return owner;
  }

  async #applyConfiguration(owner: NativeOwner, active: ActiveExecution): Promise<void> {
    const sessionId = this.providerSessionId!;
    const rawModel = active.request.configuration.model
      ? decodeCopilotModelId(active.request.configuration.model)
      : null;
    if (!rawModel || owner.currentModelId === rawModel) return;
    const { models } = readCopilotSessionModels(owner.configOptions);
    if (models.length > 0 && !models.some(model => model.rawId === rawModel)) {
      throw new Error(`GitHub Copilot model "${rawModel}" is not available in this session.`);
    }
    const option = findCopilotModelConfigOption(owner.configOptions);
    if (option) {
      const response = await owner.native.setConfigOption({ configId: option.id, sessionId, value: rawModel });
      this.#throwIfCancellationRequested(active);
      this.#adoptConfigOptions(owner, response.configOptions);
    } else {
      await owner.native.setModel({ modelId: rawModel, sessionId });
      this.#throwIfCancellationRequested(active);
      owner.currentModelId = rawModel;
    }
  }

  /** Only session/new and load responses carry the full model list, so only they report it to the catalog. */
  #adoptConfigOptions(
    owner: NativeOwner,
    configOptions: ACPSessionConfigOption[] | null | undefined,
    sessionModels?: ACPSessionModelState | null,
  ): void {
    if (configOptions?.length) owner.configOptions = configOptions;
    const { currentModelId, models } = readCopilotSessionModels(owner.configOptions, sessionModels);
    if (currentModelId) owner.currentModelId = currentModelId;
    if (sessionModels && models.length > 0) {
      void this.options.modelSink?.mergeLiveModels(models, currentModelId).catch(() => undefined);
    }
  }

  async #getMCPServers(): Promise<ACPMCPServer[]> {
    if (!this.config.sessionTools) return [];
    this.sessionToolRoute ??= this.host.sessionToolEndpoint.registerMCPRoute(call => {
      // Capture ownership before dispatch: a pending call must never adopt a later run.
      const active = this.active;
      return invokeSessionTool(call.name, call.args, {
        port: this.config.sessionTools,
        signal: active ? AbortSignal.any([active.abortController.signal, call.signal]) : AbortSignal.abort(),
        toolPolicy: active?.request.toolPolicy,
      });
    }).then(route => {
      if (this.disposed) {
        route.dispose();
        throw new CopilotExecutionCancellationError();
      }
      return route;
    }).catch(error => {
      this.sessionToolRoute = null;
      throw error;
    });
    const route = await this.sessionToolRoute;
    return [{
      headers: [{ name: SESSION_TOOL_ROUTE_HEADER, value: route.routeId }],
      name: SESSION_TOOL_MCP_SERVER_NAME,
      type: 'http',
      url: route.url,
    }];
  }

  #handlePermission(request: ACPRequestPermissionRequest): Promise<ACPRequestPermissionResponse> {
    const active = this.active;
    const cancelled: ACPRequestPermissionResponse = { outcome: { outcome: 'cancelled' } };
    if (!active || this.#isCancellationRequested(active) || request.sessionId !== this.providerSessionId) {
      return Promise.resolve(cancelled);
    }
    const toolName = readPermissionToolName(request);
    const policy = active.request.toolPolicy.kind;
    if (policy === 'passive') return Promise.resolve(cancelled);
    if (policy === 'read-only') {
      return Promise.resolve(request.toolCall.kind === 'read' || request.toolCall.kind === 'search'
        ? mapACPApprovalDecision('allow', request.options) : cancelled);
    }
    if (isSessionTool(toolName)) {
      return Promise.resolve(this.config.sessionTools ? mapACPApprovalDecision('allow', request.options) : cancelled);
    }
    if (policy === 'unrestricted' || shouldAutoApproveCopilotPermission(active.request.configuration.permissionMode)) {
      return Promise.resolve(mapACPApprovalDecision('allow', request.options));
    }
    return this.interactionController.requestPermission(request, active.abortController.signal);
  }

  #handleNotification(owner: NativeOwner, notification: ACPSessionNotification): void {
    if (notification.update.sessionUpdate === 'available_commands_update') {
      owner.commandsBySession.set(notification.sessionId, normalizeACPAvailableCommands(notification.update.availableCommands));
      if (notification.sessionId === this.providerSessionId) this.state.emit({ type: 'commands_changed' });
      return;
    }
    const active = this.active;
    if (!active || this.#isCancellationRequested(active) || notification.sessionId !== this.providerSessionId) return;
    const update = notification.update;
    // Output is gated by the turn's live window, so `session/load` history replay never reaches the run.
    switch (update.sessionUpdate) {
      case 'user_message_chunk':
        if (active.turn.acceptingLiveOutput) active.turn.accept();
        return;
      case 'session_info_update':
        // Claudian owns conversation titles.
        return;
      default: {
        const metadata = active.turn.handleUpdate(update);
        if (metadata?.type === 'config_options') this.#adoptConfigOptions(owner, metadata.configOptions);
      }
    }
  }

  #finishCompleted(active: ActiveExecution, response: ACPPromptResponse): void {
    // A successful response proves acceptance even when nothing was streamed for it.
    active.turn.accept();
    if (response.usage) {
      const model = active.request.configuration.model
        ? decodeCopilotModelId(active.request.configuration.model) ?? undefined
        : undefined;
      const usage = buildACPUsageInfo({ contextWindow: null, model, promptUsage: response.usage });
      if (usage) active.run.emit({ type: 'usage_updated', usage });
    }
    this.#updateSnapshot('idle');
    this.#emitCurrentSnapshot();
    active.abortController.abort();
    active.run.finish({
      providerPayload: response,
      reason: response.stopReason === 'max_tokens' ? 'max-tokens' : response.stopReason === 'end_turn' ? 'completed' : 'provider-ended',
      type: 'turn_completed',
    });
    active.turn.dispose();
    this.active = null;
  }

  #failUnrecoverable(active: ActiveExecution, message: string): void {
    this.#updateSnapshot('invalidated', { message, reason: 'configuration-changed', recoverable: false });
    this.#emitCurrentSnapshot();
    active.abortController.abort();
    active.run.finish({ category: 'configuration', message, recoverable: false, type: 'execution_error' });
    active.turn.dispose();
    if (this.active === active) this.active = null;
  }

  #failRecoverable(active: ActiveExecution, error: unknown): void {
    const message = describeCopilotError(error);
    const category = classifyCopilotError(error);
    this.#updateSnapshot('invalidated', {
      message,
      reason: category === 'provider-session-missing'
        ? 'provider-session-missing'
        : category === 'transport' ? 'transport-closed' : 'provider-error',
      recoverable: true,
    });
    this.#emitCurrentSnapshot();
    active.abortController.abort();
    active.run.finish({
      category,
      message,
      ...(category === 'provider-session-missing' && this.providerSessionId
        ? { missingProviderSessionId: this.providerSessionId }
        : {}),
      recoverable: true,
      type: 'execution_error',
    });
    active.turn.dispose();
    if (this.active === active) this.active = null;
  }

  async #cancelRun(run: RequestedRunChannel, reason: string): Promise<void> {
    const active = this.active;
    if (!active || active.run !== run || run.isTerminal) return;
    if (this.cancellationFlight) return this.cancellationFlight;
    this.#updateSnapshot('cancelling');
    this.#emitCurrentSnapshot();
    active.abortController.abort();
    this.interactionController.dismissAll('cancelled');
    const owner = this.nativeOwner;
    const sessionId = this.providerSessionId;
    this.cancellationFlight = (async () => {
      try {
        if (owner && sessionId && active.prompt) {
          owner.native.cancel(sessionId);
          // A process that does not settle its cancelled prompt is replaced.
          const settled = await settleWithin(active.prompt, CANCEL_SETTLE_TIMEOUT_MS);
          if (!settled) await this.#shutdownNative();
        } else if (active.nativeTouched) {
          // Startup, load or configuration was interrupted; its native outcome is unknown.
          await this.#shutdownNative();
        }
      } catch {
        // Teardown failure cannot replace the already-requested cancellation terminal.
      } finally {
        if (!this.disposed) {
          this.#updateSnapshot('idle');
          this.#emitCurrentSnapshot();
        }
        active.run.finish({ reason, type: 'cancelled' });
        active.turn.dispose();
        if (this.active === active) this.active = null;
      }
    })().finally(() => { this.cancellationFlight = null; });
    return this.cancellationFlight;
  }

  #isCancellationRequested(active: ActiveExecution): boolean {
    return this.disposed || active.run.isCancellationRequested || this.active !== active || active.run.isTerminal;
  }

  #throwIfCancellationRequested(active: ActiveExecution): void {
    if (this.#isCancellationRequested(active)) throw new CopilotExecutionCancellationError();
  }

  async #shutdownNative(): Promise<void> {
    const flight = this.nativeStartupFlight;
    const owner = this.nativeOwner;
    if (owner) await this.#shutdownNativeOwner(owner);
    if (flight) await flight.catch(() => undefined);
    const remaining = this.nativeOwner;
    if (remaining) await this.#shutdownNativeOwner(remaining);
  }

  async #shutdownNativeOwner(owner: NativeOwner): Promise<void> {
    if (this.nativeOwner === owner) {
      this.nativeOwner = null;
      owner.unsubscribe();
    }
    await owner.native.shutdown();
  }

  #isCurrentOwner(owner: NativeOwner): boolean {
    return !this.disposed && this.nativeOwner === owner;
  }

  #setNativeConversationContextEstablished(established: boolean): void {
    this.nativeConversationContextEstablished = established;
    this.state.setProviderStateValue('nativeConversationContextEstablished', established);
  }

  #updateSnapshot(status: ProviderSessionStatus, invalidation?: ProviderSessionInvalidation): void {
    if (status === 'invalidated') this.state.invalidate(invalidation!);
    else this.state.setStatus(status);
  }

  #emitCurrentSnapshot(): void {
    const active = this.active;
    const event = { snapshot: this.state.getSnapshot(), type: 'session_state_changed' as const };
    if (active && !active.run.isTerminal) {
      active.run.emit(event);
      return;
    }
    this.state.emit(event);
  }
}

class CopilotExecutionCancellationError extends Error {
  constructor() {
    super('GitHub Copilot execution was cancelled.');
    this.name = 'CopilotExecutionCancellationError';
  }
}

function readPermissionToolName(request: ACPRequestPermissionRequest): string {
  const title = request.toolCall.title?.trim() ?? '';
  const sessionTool = findCopilotSessionToolName(title);
  if (sessionTool) return sessionTool;
  const kind = request.toolCall.kind?.trim();
  return normalizeCopilotToolName(kind && kind !== 'other' ? kind : title);
}

function getInputText(request: ProviderExecutionRequest): string {
  return request.input.filter(block => block.type === 'text').map(block => block.text).join('\n');
}

/**
 * A fresh native session carries no Claudian system instructions, so they lead its first prompt
 * (unverified: Copilot's ACP server has no documented system-prompt channel).
 */
function buildPromptBlocks(request: ProviderExecutionRequest, freshSession: boolean): ACPContentBlock[] {
  const blocks: ACPContentBlock[] = [];
  let text = appendExecutionContext(getInputText(request), request.context);
  if (freshSession && request.conversationHistory?.length) {
    const history = [...request.conversationHistory] as ChatMessage[];
    text = buildPromptWithHistoryContext(buildContextFromHistory(history), text, text, history);
  }
  const { systemInstructions } = request.configuration;
  const passive = request.toolPolicy.kind === 'passive';
  const preamble = [
    freshSession || passive ? systemInstructions.instructions : '',
    passive ? PASSIVE_TOOL_INSTRUCTION : '',
  ].filter(Boolean).join('\n\n');
  if (preamble) text = `${preamble}\n\n${text}`;
  if (text) blocks.push({ text, type: 'text' });
  for (const block of request.input) {
    if (block.type === 'image' && block.image.data) {
      blocks.push({ data: block.image.data, mimeType: block.image.mediaType, type: 'image' });
    }
  }
  return blocks;
}

async function settleWithin(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: number | undefined;
  const timeout = new Promise<false>(resolve => { timer = window.setTimeout(() => resolve(false), timeoutMs); });
  try {
    return await Promise.race([promise.then(() => true, () => true), timeout]);
  } finally {
    window.clearTimeout(timer);
  }
}

const AUTH_PATTERN = /auth|sign[ -]?in|log[ -]?in|credential|unauthori[sz]ed|\b401\b/i;

export function describeCopilotError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return AUTH_PATTERN.test(message) ? `${message}\nSign in by running \`copilot login\` in a terminal.` : message;
}

export function classifyCopilotError(
  error: unknown,
): 'authentication' | 'configuration' | 'provider-session-missing' | 'transport' | 'unknown' {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (AUTH_PATTERN.test(message)) return 'authentication';
  if (message.includes('session') && (message.includes('not found') || message.includes('missing'))) {
    return 'provider-session-missing';
  }
  if (message.includes('transport') || message.includes('closed')) return 'transport';
  if (message.includes('model') || message.includes('config')) return 'configuration';
  return 'unknown';
}
