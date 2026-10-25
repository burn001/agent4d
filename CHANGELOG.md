# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/) (0.x until a stable 1.0).

## [0.1.0] - 2026-10-25

Initial public release.

### Added
- Local, read-only live viewer for Claude Code sessions: main agent, subagents, workflow agents, nested `claude -p` runs, background shells and monitors as one live tree, streamed over Server-Sent Events.
- Three views (Flow, Planet, Voxel Office), each in 3D and a lighter 2D mode; all-projects overview with an automatic camera tour; replay at 0.5×–32× with a read-only archive; plan board; context and usage-limit gauges; synthesized background music and sound effects; English and Korean UI; optional remote access through a Cloudflare tunnel and Worker.
- Work-target layer (files, outputs, repositories, databases, remotes, services) under each project, with per-verb interaction scenes.
- Planet view: agents drawn as watch tourbillons — the main agent as a multi-axis tourbillon (outer cage, tilted inner cage, oscillating balance wheel, hairspring, escape wheel and pallet ticking on each beat, ruby jewels, blue screws), subagents with a single cage drawn with one instanced mesh; the beat follows the agent state (fast while using tools, a slow tick when idle, stopped when done). 2D shows the movement from above.
- Human prompts fly from the viewer's position (bottom center of the screen) to the main agent as a soft homing beam with a fading trail, then land as a ripple; a short straight beam with reduced motion; matching soft "whoosh → tick" sound.
- Tool hologram panels are clickable: hover shows "tool · summary", click opens the node card at that tool call; far-away panels keep a small tool name tag.
- Version shown by `ccviz --version`, `ccviz status` and at the bottom of the ⚙ menu (read from `package.json`, exposed on `/healthz`).
- `docs/ADAPTERS.md`, `CONTRIBUTING.md` and an adapter request template for community adapters for other harnesses.

### Changed
- Planet view: the work-target layer sits on its own floor plane below the agent orbits, with faint plumb lines from each agent to the floor.

### Fixed
- Light theme: the work-target layer and its floor lettering were nearly invisible; they are now drawn as ink (multiply blending) with theme-specific alpha. The dark theme is unchanged.
