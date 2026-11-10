import type { ACPAvailableCommand } from '@/providers/acp';
import { normalizeACPAvailableCommands } from '@/providers/acp';

import type { SlashCommand } from '../../../core/types';

/**
 * Copilot commands that change state Claudian owns (permissions, model, working directory, sessions) or that
 * manage the CLI itself. Hiding them keeps the picker to prompts the agent can act on.
 */
const COPILOT_HIDDEN_COMMANDS: ReadonlySet<string> = new Set([
  'add-dir', 'allow-all', 'autopilot', 'cwd', 'list-dirs', 'mcp', 'model', 'permissions', 'plan', 'plugin', 'remote',
  'rename', 'reset-allowed-tools', 'sandbox', 'session', 'share', 'skills', 'subconscious',
]);

export function normalizeCopilotAvailableCommands(commands: readonly ACPAvailableCommand[]): SlashCommand[] {
  return normalizeACPAvailableCommands(commands).filter(command => (
    !COPILOT_HIDDEN_COMMANDS.has(command.name.replace(/^\//, '').toLowerCase())
  ));
}
