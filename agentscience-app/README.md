# AgentScience

AgentScience is a desktop app and web UI for running research work with coding agents.

## Start here

If you are onboarding, read these first:

- [Architecture](./docs/architecture.md)
- [Design language](./docs/design.md)
- [Observability](./docs/observability.md)
- [Release](./docs/release.md)
- [Distribution](./docs/distribution.md)

## Development

Main dev entry points:

```sh
bun run dev
```

For desktop development that needs the same managed paper/science runtime layout
as a downloaded GitHub Release build, refresh the dev managed resources first:

```sh
bun run dev:desktop:resources
```

Then launch the desktop app:

```sh
bun run dev:desktop
```

`dev:desktop:resources` is idempotent. It writes
`apps/desktop/managed-resources/.manifest.json` with a hash of the managed
runtime recipe, including the Tectonic version, wrapper scripts, Python version,
package list, platform, arch, and checksums. If that manifest still matches and
the expected binaries are present, it exits quickly without re-downloading. Run
it again after changing the managed runtime/toolchain recipe; ordinary app and
server code changes only need `Ctrl-C` followed by `bun run dev:desktop`.

To build a non-default target, pass artifact-builder flags after `--`, for
example `bun run dev:desktop:resources -- --platform mac --arch x64`.

## Requirements

- Bun
- Codex CLI installed and authenticated

For example:

```sh
codex login
```

## Notes

This project is still in active development. Expect rough edges.

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).
