# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/) (0.x until a stable 1.0).

## [Unreleased]

## [0.4.1] - 2026-10-26

### Fixed
- Picking one project (top project picker or `agent4d ctl scope project:…`) no longer hides most of it. A launcher started with `nohup … &` has no parent, so it is drawn as its own root inside the island; the project fade only exempted session roots (`s:…`), so the launcher and everything under it (runs, their subagents and jobs) faded out with the other projects and only the main agent was left. Every root node now follows only the show/hide checkboxes, never the project pick. Flow and Planet in 3D and 2D share the same rule.
- Plan boards no longer sit on top of everything. The board layer now lives inside the scene stage, under node labels, speech bubbles and island tags and under all UI (top bar, live panel, timeline, popups, ⚙ menu). In 3D, nodes that are nearer to the camera than a board now cut through it (a soft-edged hole per node), so a node in front of a board shows in front.

### Changed
- Launcher devices (`relaunch.sh`, nohup loops) are 25% smaller (0.75×) in Flow, Planet and Voxel, 3D and 2D. Layout spacing, the docked finished runs, labels, the Voxel copier, its dashboard and its name tag follow the new size.

## [0.4.0] - 2026-10-26

### Added
- Detached processes: when an agent starts a program or script in the background from a normal shell call (`nohup … &`, `( … ) > log 2>&1 &`, `setsid`, `disown`, PowerShell `Start-Process`/`Start-Job`, `start /b`, `python -m …`, a venv `python.exe`), it now gets its own node under that agent instead of the agent just looking idle. Its log file (`> f`, `>> f`, `&> f`, `| tee f`, `-RedirectStandardOutput`, relative to any earlier `cd`) feeds the usual output panel. It ends on `EXIT n`/`rc=n` lines, a Python traceback, a kill command that names it, or long silence, and shows as stalled when the log stops growing for longer than its usual line gap. Short `sleep 1 &` calls and GUI launches (`start chrome`, `code .`) are ignored.
- Progress lanes: common progress lines (`[label] 12,345 units · 5546s · max 4.32s`, `n/total`, `n%`, `label: n`) are recognised without any rules once they rise twice in a row, and become a "Progress" job with one counter per label, rate, ETA (when there is a total) and a 0–1 "heat" that rises as the rate drops from its start or the per-unit time grows. Protocol lines and `jobs.json` rules still win.
- Watching: when another shell call or Monitor reads or waits on that log (or its output folder), a new `watch` event links the reader to the process (peek or wait), and progress lines in what it saw count too. Replays place log lines at the times they were seen. `?mock=1` and `--demo` include a two-lane job that slows down, is checked every few seconds and finishes, plus one that fails fast.
- Planet (3D and 2D) draws detached processes as a mining rig on a small asteroid beside the agent that started it: the auger spins with the rate, slows and stutters as heat rises while its bore glows amber to vermilion, ore chunks ride one conveyor orbit per progress lane into a cargo ring around the agent (a big chunk per progress line), a hologram meter shows rolling counters, rate, longest unit time, heat and ETA (just the big number from afar), and watching shows as a waiting orbit with a probe or a scan beam, with the agent's line reading "Supervising · script · count".
- Flow (3D and 2D) draws detached processes as a standing machine beside the agent that started it: a rotor spins on top (slowly when the log stalls, with a blinking warning dot, and spins down when it ends with a green, red or grey wave), the front panel rolls one odometer counter per progress lane with a rate sparkline, heat bar and ETA (one big number from afar), and the body warms from teal through amber to vermilion as heat rises (heat haze in dark, deeper ink in light). Each new progress line pops a small tick out along the dashed spawn line, watching shows as a scan sweep from the watcher, a waiting ring around the machine and a check on the panel, the watcher's line reads "Supervising · script · count", hovering shows a small card, and the click card (every view) gets a progress-lane table plus the log path, watch count and end reason.
- Voxel office (3D and 2D) draws detached processes as a production line in the office of the agent that started it: a machine with a spinning flywheel, chimney steam and a beacon (amber when warm or stalled, red when hot or failed, green when done), one conveyor per progress lane running at the rate, a crate for each progress line that rides to a pallet stacked as a compressed tally (bundles and singles), and a forklift that carries the pallet away on a new pass or when the job ends. The progress job becomes a scoreboard above the machine with rolling lane counters, rate, longest unit time and ETA. When the agent checks the log, its character walks to the machine with a clipboard, reads the board and ticks it, or waits with arms folded (too-frequent peeks, fast replay or other rooms show a dotted look line from the desk instead).
- Remote control from the PC running the server: `agent4d ctl <command>` changes every open viewer (or one picked with `--client`) — theme, view, 2D/3D, project or session scope, what is shown, sound and volumes, music, language, camera, focus, live pause, replay, layers, weather, grid, noise, panel, timeline, popups, reload and on-screen messages — exactly as if picked in the menus (saved, or `--temp` for this visit only). `ctl clients` lists open viewers; each viewer answers with the result, and the CLI reports how many applied and why others did not (including "click the page once" for sound). Sending works only locally (loopback, no relay/tunnel/proxy headers, admin secret); remote viewers only receive. ⚙ gets "Screen name" and "Remote control: Accept/Ignore".

### Changed
- Flow 3D: the "me · user" console is now a solid terminal instead of a flat outline — a hexagonal base with a glowing ring, a neck, a screen panel tilted back with a bezel and a back cover, dark glass that lights up by state (no messages, main working, answered, asking me, interrupted) and a status light on the bezel, with the same floor shadow and dashed stem line as the hexagonal nodes. The text lines and the name tag stay as before; the gold beam and ribbon of a user message now leave from the screen. Hover, click card, light theme, reduced motion and far-away simplification keep working. 2D, Planet and Voxel are unchanged.
- Signal degradation starts later: film grain from 30% of the context window (was 20%), scanlines 50% (40), chromatic aberration, glitches and muffled music 70% (58), datamosh, hum and "Consider wrapping up" 90% (75). 3D shader, 2D overlay, text glitches and the hint text all read the same stage constants.
- Flow 3D: the launcher device (e.g. `relaunch.sh`) now stands upright instead of lying flat. Its front (recent run bands, progress bar and light) faces the camera and turns only when you rotate the view a lot; beams to its runs leave from its bottom edge.

## [0.3.7] - 2026-10-26

### Fixed
- `agent4d start` no longer keeps an old server running after the install was updated without `agent4d update` (for example with `git pull`). It compares the running server's version (`/healthz`) with the installed `package.json`; if they differ, it restarts the server, the relay and the watcher on the new code (the tunnel is reused). Before, the viewer kept showing the old version and server-side fixes did not take effect until a manual `stop`.

## [0.3.6] - 2026-10-26

### Fixed
- Narrow screens (under 720px): the top bar now uses two rows — logo, connection dot, project picker, Replay and ⚙ on the first, the context pill, usage-limit gauge and sound buttons on the second. On a 360px phone the usage-limit gauge used to be pushed off the right edge, and on phones the project picker was squeezed under the Replay button where it could not be tapped. Wider screens keep the single row.

### Changed
- README: GitHub stars badge, a Quick start right under the intro loop and a short "Why" list (English and Korean).

## [0.3.5] - 2026-10-26

### Fixed
- On phones (Safari and other WebKit browsers), the view picker (⚙ → "View: … ▾") seemed not to open: its window opened behind the still-open ⚙ menu. It now always appears above the ⚙ menu and stays inside the screen (it moves above the button or scrolls inside when the screen is short, e.g. a phone in landscape). The ⚙ menu's "Background" card had the same layering problem on all browsers and is fixed too.

## [0.3.4] - 2026-10-26

### Changed
- Signal decay now always follows the percentage of the context window (20% grain, 40% scanlines, 58% chroma/glitch, 75% datamosh and "Consider wrapping up"). The "absolute" basis (tokens added since the first response), which made decay show up too early, and the basis selector in the context card are removed; the card and tooltip still show "Start 63k · added +152k" for information. The `?ctxk=` mock preview is gone (`?ctx=` still works).

## [0.3.3] - 2026-10-26

### Added
- Live output of foreground shell commands. Claude Code writes the output of a running foreground Bash/PowerShell call to `tasks/<random id>.output` in the session temp folder and deletes it when the call ends, and that id never appears in the transcript, so long commands (for example a 10-minute test driver that prints a line per step) used to look frozen until they finished. The server now picks up unknown `.output` files in the session's task folders, attaches each one to the open (no result yet) Bash/PowerShell call of that session or its subagents whose start time is closest, and streams new lines to that call's tool panel as they arrive. The link ends when the result arrives, the file disappears or the turn ends. Live only; replay and archive are unchanged. Also works for sessions after `/clear`, whose temp folder carries a different session id. The first line may appear up to about 2 seconds late.

### Changed
- Work-target layer: temporary files no longer crowd out real work. Files under folders such as `tmp`, `temp`, `scratch`, `scratchpad`, `.cache` or `__pycache__` (and `*.tmp`) are marked temporary and are dropped first when a project reaches the 500-target limit. When four or more temporary files share a folder, they are folded into one group (count, five most recent files and the combined activity log in its card). Projects driven by autonomous loops that write many scratch files per round now show mostly their real code and documents. Same rule in Flow, Planet and Voxel Office.

## [0.3.2] - 2026-10-26

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
