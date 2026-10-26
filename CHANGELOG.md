# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/) (0.x until a stable 1.0).

## [Unreleased]

### Added
- `agent4d update`: `update --check [--json] [--force]` asks GitHub for the latest release (one unauthenticated request, cached for 24 hours in `update-check.json`; offline or API errors never fail). `update [--yes]` updates a git clone with `git pull --ff-only` after checking that it is clean, on `main` and can fast-forward, refreshes a copied skill in `~/.claude/skills/agent4d` (a linked skill is left alone; replaced files are kept as `*.bak`) and restarts a running server with the same options. Clones whose `origin` is not this repository are left untouched.
- The server checks for a new release at start and once a day; the ⚙ menu then shows a small dot and "vX.Y.Z available" next to the version, linking to the release page. Turn the check off with `"updateCheck": false` in `config.json` or `AGENT4D_NO_UPDATE_CHECK=1` (no network request at all).
- The bundled skill checks for updates after finding the install, tells you about a new version and asks before updating (`AGENT4D_AUTO_UPDATE=1` updates without asking). New triggers: "update agent4d", "agent4d 업데이트".
- README: link the skill folder instead of copying it (`ln -s`, Windows `mklink /J`), new "Updating" section, and the update check is listed under security and privacy.

### Fixed
- Automatic camera in the overview: the "Overview" and project-island shots of "Framing: follow" (and clicking an island) no longer frame whole islands, their floor plates and the work-target layer. Like "Framing: all", they fit the active agents with their tool panels and labels, so agents appear much larger; the island box is used only when an island has no visible agents. "Framing: follow" also stops lingering on a project whose short turn has ended: idle agents score zero, and within about 3 seconds the camera moves to an island that is still working (for example a runner in another project). Same in 3D and 2D for Flow, Planet and Voxel Office.

## [0.3.1] - 2026-10-26

### Added
- Overview visibility checkboxes in the top-bar project selector: tick which projects, and which sessions inside a project (expand the row), are shown in the overview. Clicking a project name still selects that single project. "All" / "None" quick toggles; at least one project always stays visible ("None" keeps the selected or first project). Hidden projects and sessions fade out like single-project mode, then the remaining islands (or Voxel buildings) are packed together again with no empty gaps. Works in Flow, Planet and Voxel Office, 3D and 2D. The choice is remembered in the browser (`ccviz.visible`); projects that appear later are shown by default.

### Changed
- Automatic camera, "Framing: all": after fitting the projected box, the view centre moves to the visual centre of mass of the active agents and their tool panels, weighted by how much screen area each takes. Tool output that opens mostly on one side no longer leaves the composition looking lopsided. Everything stays on screen; if centring would push the camera more than 15% farther back, it moves only part of the way. Same rule in 3D and 2D for all views.

## [0.3.0] - 2026-10-26

### Added
- User console ("Me · user"), the object that stands for you next to each main agent, no longer looks like an empty monitor. It is there from the start for every running main agent (no need to wait for a message) in Flow (a terminal above the island), Planet (the ground station, now with a small screen outside the planet's rings and drawn more visibly) and Voxel Office (the client screen on the office wall). The screen shows text lines, and a small label shows the first words of your last message and where things stand: "Main working · 2m", "Answered 5m ago", "Question for you · 3 options", "No messages yet". With `privacy: minimal` only the state and time are shown.
- Hover the console for a tooltip; click it for a detail card: whose turn it is, a question waiting for you (text, number of options) or the last question and your answer, your 5 most recent messages (redacted text, time), the last final answer (time, turn length) and a link to the main agent. The camera moves to the main agent and stays while the card is open. Works in Flow, Planet and Voxel Office, 3D and 2D, live, replay and archive.

### Changed
- The user console dims less after an answer (it stays findable) and is drawn stronger in the light theme.
- The plain `user` sound effect (used only when the server sends no user interaction data) is now a short two-note bell.

### Removed
- The prompt beam: the light that gathered at the screen edge and flew into the main agent when you sent a prompt. The console's gold beam and ribbon now carry each message alone. The camera move to the receiving main agent ("Follow my prompts") stays.

### Fixed
- Voxel Office: a fallback "orb" effect reused the name of the fade helper and would have failed if triggered.

## [0.2.0] - 2026-10-25

### Added
- Job objects: work that a background command, monitor or loop runner *reports* in its output (a remote nightly run, a measurement chain, a detached wait) now gets its own small node under that stream's owner. Same job id = same node (a re-armed monitor keeps the node), states queued · running · waiting · done · failed, plus "stale" when the heartbeat stops for longer than the threshold (judged with the view clock, so replay matches live). Phase is shown as the subtitle, with progress n/total, re-check time and exit code as tags. Only the 3 most recent finished jobs per owner stay visible.
- Line protocol: any script can print `::agent4d {"id":"nightly","state":"running","phase":"tests","progress":"96/101"}` (a relay prefix before it is fine). Fields: id, title, state, phase, progress, host, heartbeat, until, rc, staleSec, stale, note.
- Fallback rules for output without the protocol: regular-expression rules in `<state folder>/jobs.json` or `<project>/.agent4d/jobs.json` (per project, per stream kind/label/command, or for an extra log file that is tailed read-only while live). Events start · phase · progress · wait · beat · stale · end · fail with named groups (time, phase, n, total, until, rc, …). Protocol lines win over rules on the same stream. Rules are re-read every 5 seconds.
- Drawn in every view: Flow 3D (small hex chip with progress arc, hourglass while waiting, broken pulse when stale), Planet 3D (tiny probe with a state ring and orbit trail), Voxel Office (kanban cards on a board next to the owner's machine), and the matching 2D views. The inspector shows state, phase, progress, host, last heartbeat, re-check time, exit code, source and the last line; an owner's card lists its jobs. The owner's hologram tail panel highlights the line that produced each job.

## [0.1.3] - 2026-10-25

### Fixed
- Flow 3D: the leftmost cell of a launcher's recent-run band flickered with noisy streaks. The shader read the per-instance band code and cell count through interpolated varyings and used them with exact comparisons, so tiny interpolation errors (a count of 4.9999, a code of 936.9998) changed the cell's colour pixel by pixel and frame by frame. Integer values are now rounded before decoding and the "no run in progress" check has a margin. The same rounding is applied to the voxel hologram panel line pattern.

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
