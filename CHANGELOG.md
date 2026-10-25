# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/) (0.x until a stable 1.0).

## [0.1.2] - 2026-10-25

### Changed
- Automatic camera, "Framing: all" (default): frames the active agents (working or with an open tool; all visible nodes when none is active) together with their tool hologram panels and labels as large as possible, instead of the whole island floors. Islands, the work-target layer and voxel room corners are no longer part of the fit. The fit projects the targets along the current camera direction and fills the free screen area (minus the bottom timeline and replay bar) to a 6% margin on one axis, centred on the projected box; screen-sized labels and 2D cards are handled in screen space. A single node is framed closer. It still ignores small changes, backs off at once only when something would be cut, and moves in 2 s after the target gets 10% smaller (0.8 s when the active set shrinks a lot). Same rules in 3D and 2D for Flow, Planet and Voxel.

### Fixed
- The fitted framing sat too high in 3D (empty band at the bottom) because the bottom-overlay offset was applied after fitting; the camera direction used for fitting could also differ from the real one.

## [0.1.1] - 2026-10-25

### Added
- Claude Code skill `skills/agent4d`: copy it to `~/.claude/skills/agent4d/` and ask Claude Code to "open agent4d" or "show my agents in 3D". It finds the install (`AGENT4D_HOME`, `~/agent4d`, or `agent4d` on `PATH`), starts the local server if needed and shows the link; it opens a public tunnel only when you ask. README section "Use with Claude Code (skill)" (also in the Korean README).

## [0.1.0] - 2026-10-25

Initial public release, published as **Agent4D** — your coding agents in 3D space + time. The project was developed as cc-agent-viz; the command is now `agent4d`, and `ccviz` keeps working as an alias. The state folder stays `~/.cc-agent-viz/` (with the older `~/.cc-session-viz/` fallback). Licensed under the Apache License 2.0 (an earlier snapshot of this release was briefly published under MIT).

### Added
- Local, read-only live viewer for Claude Code sessions: main agent, subagents, workflow agents, nested `claude -p` runs, background shells and monitors as one live tree, streamed over Server-Sent Events.
- Three views (Flow, Planet, Voxel Office), each in 3D and a lighter 2D mode; all-projects overview with an automatic camera tour; replay at 0.5×–32× with a read-only archive; plan board; context and usage-limit gauges; synthesized background music and sound effects; English and Korean UI; optional remote access through a Cloudflare tunnel and Worker.
- Work-target layer (files, outputs, repositories, databases, remotes, services) under each project, with per-verb interaction scenes.
- Planet view: agents drawn as watch tourbillons. The main agent is a gyro tourbillon whose frame and gears read first: a polished steel cage with chamfered (anglage) bridges over a fixed gold fourth wheel with 60 teeth and five cut-out spokes; the steel escape pinion rolls on that wheel at the true gear ratio and turns the hooked 15-tooth escape wheel, which ticks once per beat with a small recoil; the pallet lever flips with ruby stones; a tilted inner cage turns faster the other way around a gold balance wheel with timing screws and a blue Breguet-overcoil hairspring. Metals use a small environment map with a soft rim light in the dark theme and an ink outline in the light theme; the planet body shrinks to a core so the movement leads. Subagents wear a simpler cage from the same family (one instanced mesh for the whole scene). The beat follows the agent state (fast while using tools, a slow tick when idle, stopped when done) and eases between states. Level of detail keeps the ring and teeth silhouette at a distance. 2D draws the same movement from above.
- Human prompts: the camera first moves to the main agent that receives the prompt (⚙ "Follow my prompts", on by default; skipped while you steer the camera, when paused, or at high replay speed), then energy gathers at a random point on the screen edge and flies in as one smooth comet-like beam that curves out and homes in, with a trail of constant on-screen width; it lands with a ripple. If the main agent is off screen, the beam heads for that edge. Drawn as a screen-space overlay shared by all views and 2D; reduced motion shows a short straight beam. Matching soft "sss → whoosh → tick" sound.
- Tool hologram panels are clickable: hover shows "tool · summary", click opens the node card at that tool call; far-away panels keep a small tool name tag.
- Version shown by `ccviz --version`, `ccviz status` and at the bottom of the ⚙ menu (read from `package.json`, exposed on `/healthz`).
- `docs/ADAPTERS.md`, `CONTRIBUTING.md` and an adapter request template for community adapters for other harnesses.
- README loops for each view (`docs/media/*.gif`) next to the screenshots, and an English canonical README with a Korean translation.

### Changed
- Planet view: the work-target layer sits on its own floor plane below the agent orbits, with faint plumb lines from each agent to the floor.

### Fixed
- Light theme: the work-target layer and its floor lettering were nearly invisible; they are now drawn as ink (multiply blending) with theme-specific alpha. The dark theme is unchanged.
