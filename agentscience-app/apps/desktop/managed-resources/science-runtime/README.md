Bundled scientific Python runtimes live here for packaged desktop builds.

Expected layout:

- `darwin-arm64/bin/python3`
- `darwin-arm64/bin/uv` (optional)
- `darwin-x64/bin/...`
- `linux-x64/bin/...`
- `win32-x64/bin/python.exe`

The intent is to ship a pinned, relocatable scientific stack so AgentScience can
run high-quality data analysis out of the box without relying on host-level
Python, NumPy, pandas, matplotlib, or ad-hoc user installs.
