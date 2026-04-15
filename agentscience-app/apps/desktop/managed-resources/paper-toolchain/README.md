Bundled paper toolchains live here for packaged desktop builds.

Expected layout:

- `darwin-arm64/bin/latexmk`
- `darwin-arm64/bin/pdflatex`
- `darwin-arm64/bin/bibtex`
- `darwin-x64/bin/...`
- `linux-x64/bin/...`
- `win32-x64/bin/...`

The server prefers this managed runtime over system LaTeX when present so paper
review works without requiring scientists to install TeX manually.
