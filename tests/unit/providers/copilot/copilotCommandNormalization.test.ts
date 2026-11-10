import { normalizeCopilotAvailableCommands } from '@/providers/copilot/commands/copilotCommandNormalization';

describe('normalizeCopilotAvailableCommands', () => {
  it('hides commands that change state Claudian owns and keeps prompts the agent can act on', () => {
    const names = normalizeCopilotAvailableCommands([
      { name: 'allow-all', description: 'Enable all permissions' },
      { name: 'cwd', description: 'Change working directory' },
      { name: 'model', description: 'Select the model' },
      { name: 'review', description: 'Run code review agent' },
      { name: 'compact', description: 'Summarize history' },
    ]).map(command => command.name.replace(/^\//, ''));

    expect(names).toEqual(['review', 'compact']);
  });
});
