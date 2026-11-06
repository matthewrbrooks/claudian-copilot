import type { TargetLaunchSpec } from '@/core/process/execution-target/types';
import {
  ACPClientConnection,
  type ACPInitializeResponse,
  ACPJSONRPCTransport,
  type ACPLoadSessionRequest,
  type ACPLoadSessionResponse,
  type ACPNewSessionRequest,
  type ACPNewSessionResponse,
  type ACPPromptRequest,
  type ACPPromptResponse,
  type ACPRequestPermissionRequest,
  type ACPRequestPermissionResponse,
  type ACPSessionNotification,
  type ACPSetSessionConfigOptionRequest,
  type ACPSetSessionConfigOptionResponse,
  type ACPSetSessionModelRequest,
  type ACPSetSessionModelResponse,
  ACPSubprocess,
} from '@/providers/acp';

export interface CopilotNativeConnectionOptions {
  readonly launch: TargetLaunchSpec;
  readonly version: string;
  readonly requestPermission: (request: ACPRequestPermissionRequest) => Promise<ACPRequestPermissionResponse>;
}

/** One `copilot --acp --stdio` process and its ACP client. */
export class CopilotNativeConnection {
  readonly launch: TargetLaunchSpec;
  private readonly client: ACPClientConnection;
  private readonly listeners = new Set<(notification: ACPSessionNotification) => void>();
  private readonly process: ACPSubprocess;
  private readonly transport: ACPJSONRPCTransport;
  private shutdownFlight: Promise<void> | null = null;
  private loadSessionSupported = false;

  constructor(options: CopilotNativeConnectionOptions) {
    this.launch = options.launch;
    this.process = new ACPSubprocess({
      args: options.launch.args,
      command: options.launch.command,
      cwd: options.launch.spawnCwd,
      env: options.launch.env,
      windowsVerbatimArguments: options.launch.windowsVerbatimArguments,
    });
    this.process.start();
    this.transport = new ACPJSONRPCTransport({
      input: this.process.stdout,
      onClose: listener => this.process.onClose(listener),
      output: this.process.stdin,
    });
    this.client = new ACPClientConnection({
      clientInfo: { name: 'claudian', version: options.version },
      delegate: {
        onSessionNotification: notification => {
          for (const listener of this.listeners) listener(notification);
        },
        requestPermission: options.requestPermission,
      },
      transport: this.transport,
    });
  }

  /** Authentication is native (`copilot login`); `authenticate` is never called. */
  async initialize(): Promise<ACPInitializeResponse> {
    const response = await this.client.initialize();
    this.loadSessionSupported = response.agentCapabilities?.loadSession === true;
    return response;
  }

  /** Whether the agent advertised `loadSession` during initialize. */
  supportsLoadSession(): boolean {
    return this.loadSessionSupported;
  }

  newSession(request: ACPNewSessionRequest): Promise<ACPNewSessionResponse> {
    return this.client.newSession(request);
  }

  loadSession(request: ACPLoadSessionRequest): Promise<ACPLoadSessionResponse> {
    return this.client.loadSession(request);
  }

  async closeSession(sessionId: string): Promise<void> {
    await this.client.closeSession({ sessionId });
  }

  setConfigOption(request: ACPSetSessionConfigOptionRequest): Promise<ACPSetSessionConfigOptionResponse> {
    return this.client.setConfigOption(request);
  }

  setModel(request: ACPSetSessionModelRequest): Promise<ACPSetSessionModelResponse> {
    return this.client.setModel(request);
  }

  prompt(request: ACPPromptRequest): Promise<ACPPromptResponse> {
    return this.client.prompt(request);
  }

  cancel(sessionId: string): void {
    this.client.cancel({ sessionId });
  }

  flush(): Promise<void> {
    return this.transport.flush();
  }

  isAlive(): boolean {
    return this.process.isAlive();
  }

  onClose(listener: (error?: Error) => void): () => void {
    return this.process.onClose(listener);
  }

  onNotification(listener: (notification: ACPSessionNotification) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  shutdown(): Promise<void> {
    this.shutdownFlight ??= (async () => {
      this.listeners.clear();
      this.client.dispose();
      this.transport.dispose();
      await this.process.shutdown();
    })();
    return this.shutdownFlight;
  }
}
