Bundled paper toolchains live here for packaged desktop builds.

For local desktop development, populate this directory with:

```sh
bun run dev:desktop:resources
```

That command uses the same bundling logic as the desktop release artifact build
and writes `../.manifest.json`. If the manifest hash still matches the release
toolchain recipe and the expected binaries are present, the command exits
without downloading anything. Run it again after changing the Tectonic version,
wrapper scripts, target checksums, or managed science runtime package list.

Expected layout:

- `darwin-arm64/bin/tectonic`
- `darwin-arm64/bin/tectonic-real`
- `darwin-arm64/bin/latexmk`
- `darwin-arm64/bin/pdflatex`
- `darwin-arm64/bin/bibtex`
- `darwin-arm64/cache/...`
- `darwin-x64/bin/tectonic`
- `darwin-x64/bin/...`
- `linux-x64/bin/...`
- `win32-x64/bin/...`

The server prefers the bundled `tectonic` wrapper over system LaTeX when present
so paper review works without requiring scientists to install TeX manually. The
wrapper seeds a bundled Tectonic cache into the workspace cache before invoking
`tectonic-real`, so first-run PDF builds do not depend on automatic TeX resource
downloads. The managed desktop build also stages lightweight compatibility shims
for `latexmk`, `pdflatex`, and `bibtex` so older LaTeX-first flows continue to
work without shipping a full user-managed TeX distribution.
