import { buildCopilotACPArgs } from '@/providers/copilot/runtime/CopilotLaunchArgs';

describe('buildCopilotACPArgs', () => {
  it('starts the stdio ACP server by default', () => {
    expect(buildCopilotACPArgs()).toEqual(['--acp', '--stdio']);
  });

  it('adds a valid effort and drops unknown values', () => {
    expect(buildCopilotACPArgs({ effort: 'high' })).toEqual(['--acp', '--stdio', '--reasoning-effort', 'high']);
    expect(buildCopilotACPArgs({ effort: 'turbo' })).toEqual(['--acp', '--stdio']);
  });

  it('dedupes and trims tool lists', () => {
    expect(buildCopilotACPArgs({
      availableTools: [' shell ', 'shell', ''],
      excludedTools: ['write'],
    })).toEqual(['--acp', '--stdio', '--available-tools', 'shell', '--excluded-tools', 'write']);
  });
});
