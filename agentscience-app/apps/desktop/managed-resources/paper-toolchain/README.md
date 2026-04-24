Bundled paper toolchains live here for packaged desktop builds.

For local desktop development, populate this directory with:

```sh
bun run dev:desktop:resources
```

That command uses the same bundling logic as the desktop release artifact build
and writes `../.manifest.json`. If the manifest hash still matches the release
toolchain recipe and the expected binaries are present, the command exits
without downloading anything. Run it again after changing the TinyTeX version,
wrapper scripts, target checksums, or managed science runtime package list.

Expected macOS layout:

- `darwin-universal/TinyTeX/...`
- `darwin-universal/bin/latexmk`
- `darwin-universal/bin/pdflatex`
- `darwin-universal/bin/bibtex`
- `darwin-universal/bin/biber`

The server prefers the bundled TinyTeX `latexmk`/`pdflatex` wrappers over
system LaTeX when present, so paper review works without requiring scientists to
install TeX manually. The wrappers invoke the pinned TinyTeX runtime under this
directory and keep workspace-specific TeX caches/configuration inside each paper
workspace.
