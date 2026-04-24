Bundled scientific Python runtimes live here for packaged desktop builds.

For local desktop development, populate this directory with:

```sh
bun run dev:desktop:resources
```

That command uses the same bundling logic as the desktop release artifact build
and writes `../.manifest.json`. If the manifest hash still matches the release
runtime recipe and the expected binaries are present, the command exits without
downloading anything. Run it again after changing the Python version, uv
version, package list, target checksums, or paper toolchain wrapper scripts.

Expected layout:

- `darwin-arm64/bin/python3`
- `darwin-arm64/bin/uv` (optional)
- `darwin-x64/bin/...`
- `linux-x64/bin/...`
- `win32-x64/bin/python.exe`

The intent is to ship a pinned, relocatable scientific stack so AgentScience can
run high-quality data analysis out of the box without relying on host-level
Python, NumPy, pandas, matplotlib, Excel readers, or ad-hoc user installs.
