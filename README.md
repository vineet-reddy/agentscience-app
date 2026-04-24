# AgentScience App

This repository owns the standalone AgentScience desktop app and its release pipeline.

## Repo layout

- `agentscience-app/`: the desktop app workspace
- `.github/workflows/release.yml`: tag-driven desktop release workflow

## Releases

Production releases are cut from this repository by pushing a version tag like `v0.0.27`.

The workflow publishes GitHub Releases for the desktop installers and updater metadata that the app consumes in packaged builds.

## Notes

This repository is a fork of the MIT-licensed T3 Code project (https://github.com/pingdotgg/t3code) and now carries its own product identity and release process.
