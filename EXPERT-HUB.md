# Expert Hub local build

This change adds Expert teams to the existing Agents window. Press **Alt+A**, then select **Expert teams**.

## Behavior

- Reads original team manifests from `~/.agents/teams/*/team.json` on demand.
- Reads shared skills from `~/.agents/skills/*/SKILL.md`. Role-linked skill instructions enter that role's prompt.
- Runs each role as a separate turn in the active provider/session, passes findings forward, then runs synthesis. These are sequential roles on one session, not independent parallel agents.
- Locks the session during a team run and offers cancellation. Reopening the panel restores the latest run state during the same app lifetime.
- Saves completed synthesis under the app's user-data `expert-team-runs/` folder with private permissions.
- Opens existing Skills, MCP connectors, and plugin marketplace management. External skill/MCP/plugin catalog links are discovery links; arbitrary marketplace formats are not universally installable.
- Keeps existing English, Chinese, and Russian interfaces aligned.

No WorkBuddy proprietary prompts or membership bypasses are included. Existing provider credentials remain managed by omp. This remains an Electron app; no Rust migration or CPU/RAM savings are claimed.

## Local packaging

This standalone checkout uses the official v0.9.23 Intel release's bundled omp 18.12.2 sidecar, rather than building the absent parent monorepo. Source sidecar SHA-256 (packaging re-signs the binary and changes its hash):

```
a50b7a7bf8f348cedb490348da8d54814560c021946b0ff054d6c15ff5dbb764
```

Local build artifacts and verification logs live in ignored `.local-build/`. Package with `electron-builder.x64.yml`; do not use the ARM configuration. The local app is ad-hoc signed, not Developer ID notarized. Upstream updates can replace this custom build.

## Verification

- TypeScript checks, production build, Intel packaging, and strict bundle signature verification passed.
- Focused tests passed: 8 tests across expert-team helpers, rendered team controls, and Russian locale checks.
- Electron end-to-end test covers role turns, synthesis, private artifact permissions, and restoring completed runs after reopening the panel. It uses a fixture provider, not a paid API request.
- Installed bundle smoke test uses its real bundled sidecar for state/settings RPC and shared catalog discovery.
- Full standalone suite is not green: 45 failures / 1,494 tests, including missing parent-monorepo configuration and timeout/DOM failures. Focused checks above passed separately.

The previous installation is preserved under `/Users/rt/Applications/Backups/omp-20261019-pre-expert-hub/`. Restart the existing omp session when convenient to load the new bundle. No CPU/RAM comparison or real-provider team run was performed.
