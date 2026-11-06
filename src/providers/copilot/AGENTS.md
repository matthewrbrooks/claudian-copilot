# Copilot constraints

Verified against Copilot CLI 1.0.105 unless marked unverified.

- Launch is `copilot --acp` (public preview; protocol may change). `--stdio` is accepted though absent from `--help`; unknown flags make the CLI exit with a usage error.
- Effort: `--help` documents `--reasoning-effort <none|minimal|low|medium|high|xhigh|max>`; `--effort` is also accepted. Prefer the documented name.
- `--available-tools` and `--excluded-tools` take `[<tools>...]`. All three are fixed per process; changing any retires the process. Real tool-name syntax is unverified.
- Authentication is native: never call ACP `authenticate` or store credentials. `initialize` advertises auth method `copilot-login` (run `copilot login`). BYOK uses `COPILOT_PROVIDER_*` environment variables passed through untouched.
- `initialize` reports `loadSession: true`, session `close` and `list`, MCP http+sse, image prompts. Resume with `session/load`.
- `session/new` returns both `models.availableModels` (with `currentModelId`) and a `configOptions` select with category `model`. Model ids can repeat (`auto` appears twice); dedupe by id.
- `configOptions` also has category `mode`; ids are URLs ending `#agent`, `#plan`, `#autopilot`. Claudian never selects `plan` or `autopilot`.
- `available_commands_update` arrives right after `session/new`, before its response. It includes CLI-only commands (`/allow-all`, `/permissions`, `/autopilot`, `/cwd`, `/add-dir`); filter those Claudian owns.
- Unverified: no documented system-prompt channel, so instructions are prepended to the first prompt.
- Unverified: permission option kinds and tool-call `kind`/title shapes.
- History: Claudian keeps the transcript and stores the native session id.
- Off: fork, rewind, plan mode, fast mode.
