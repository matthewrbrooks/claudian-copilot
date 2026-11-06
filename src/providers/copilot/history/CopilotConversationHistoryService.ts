import { copyProviderHistoryState } from '@/core/providers/providerHistory';

import { mergePersistedProviderState } from '../../../core/providers/providerState';
import type {
  ProviderConversationHistoryService,
  ProviderHistoryInput,
  ProviderHistoryResult,
  ProviderHistoryUpdate,
} from '../../../core/providers/types';
import {
  buildPersistedCopilotProviderState,
  COPILOT_PROVIDER_STATE_KEYS,
  parseCopilotProviderState,
} from '../types';

/**
 * Claudian owns the transcript. The native session id is only a resume locator: it is loaded via ACP
 * `session/load` when the agent advertises it, otherwise a fresh session replays Claudian's transcript.
 */
export class CopilotConversationHistoryService implements ProviderConversationHistoryService {
  async hydrateConversationHistory(input: ProviderHistoryInput): Promise<ProviderHistoryUpdate> {
    return copyProviderHistoryState(input);
  }

  async readNativeHistoryRevision(): Promise<string | null> {
    return null;
  }

  resolveSessionIdForConversation(conversation: ProviderHistoryInput | null): string | null {
    return conversation?.sessionId ?? null;
  }

  async resolveMissingConversationSession(
    input: ProviderHistoryInput,
    _vaultPath: string | null,
    missingProviderSessionId?: string,
  ): Promise<ProviderHistoryResult<'delete' | 'reset' | 'preserve'>> {
    const conversation = copyProviderHistoryState(input);
    if (!conversation.sessionId || conversation.sessionId !== missingProviderSessionId) return { outcome: 'preserve' };
    // The transcript is Claudian's; only the native binding is retired, so the next turn starts fresh with replay.
    conversation.sessionId = null;
    conversation.providerState = {
      ...conversation.providerState,
      nativeConversationContextEstablished: false,
    };
    return { changes: conversation, outcome: 'reset' };
  }

  isPendingForkConversation(): boolean {
    return false;
  }

  buildForkProviderState(): Record<string, unknown> {
    throw new Error('GitHub Copilot does not support forking conversations.');
  }

  buildPersistedProviderState(conversation: ProviderHistoryInput): Record<string, unknown> | undefined {
    return mergePersistedProviderState(
      conversation.providerState,
      COPILOT_PROVIDER_STATE_KEYS,
      buildPersistedCopilotProviderState(parseCopilotProviderState(conversation.providerState)) as Record<string, unknown> | undefined,
    );
  }
}
