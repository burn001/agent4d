# Contributing

Thanks for your interest in cc-agent-viz.

- **Bugs:** open an issue with your OS, Node version, browser and the view (Flow, Planet or Voxel Office, 3D or 2D). Never paste a link that contains `?t=` (it carries your viewer token), and never attach raw transcripts.
- **Adapters for other harnesses** (Codex CLI, Gemini CLI, OpenClaw, Hermes, …) are very welcome. Start with [docs/ADAPTERS.md](docs/ADAPTERS.md) and the "Adapter: …" issues.
- **Pull requests:** keep them focused. Run `npm test` before you push. There are no runtime dependencies (Node built-ins only on the server, three.js from a pinned CDN in the browser), so please do not add packages without discussing it first.
- **Privacy:** the server must stay read-only towards harness files and must send summaries only (see "Security and privacy" in the README).
- Most code comments are in Korean. English comments are fine in new code.

Versions follow [Semantic Versioning](https://semver.org/) (0.x until a stable 1.0). Changes are listed in [CHANGELOG.md](CHANGELOG.md).
