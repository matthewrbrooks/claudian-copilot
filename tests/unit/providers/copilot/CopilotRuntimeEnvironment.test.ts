import { buildCopilotRuntimeEnv } from '@/providers/copilot/runtime/CopilotRuntimeEnvironment';

describe('buildCopilotRuntimeEnv', () => {
  const snapshot = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, snapshot);
  });

  it('inherits only allowlisted variables from the host environment', () => {
    Object.assign(process.env, {
      AWS_SECRET_ACCESS_KEY: 'aws',
      COPILOT_PROVIDER_API_KEY: 'byok',
      GH_TOKEN: 'gh',
      HOME: '/home/test',
      https_proxy: 'http://proxy',
      NPM_TOKEN: 'npm',
      OPENAI_API_KEY: 'openai',
    });

    const env = buildCopilotRuntimeEnv('', '');

    expect(env).toMatchObject({
      COPILOT_PROVIDER_API_KEY: 'byok',
      GH_TOKEN: 'gh',
      HOME: '/home/test',
      https_proxy: 'http://proxy',
    });
    expect(env).not.toHaveProperty('AWS_SECRET_ACCESS_KEY');
    expect(env).not.toHaveProperty('NPM_TOKEN');
    expect(env).not.toHaveProperty('OPENAI_API_KEY');
  });

  it('always passes variables from the provider environment setting', () => {
    process.env.OPENAI_API_KEY = 'host';

    const env = buildCopilotRuntimeEnv('OPENAI_API_KEY=configured\nCUSTOM_FLAG=1', '');

    expect(env.OPENAI_API_KEY).toBe('configured');
    expect(env.CUSTOM_FLAG).toBe('1');
  });
});
