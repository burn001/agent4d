# Agent4D

**Agent4D — your coding agents in 3D space + time**

[![version](https://img.shields.io/github/v/release/burn001/agent4d?label=version)](CHANGELOG.md) [![license](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

**English** (canonical) · [한국어](README.ko.md)

See what your Claude Code agents are doing, live, in 3D — and play it back later. Agent4D is a local, read-only viewer that turns the main agent, its subagents, workflow agents, nested `claude -p` runs, background shells and monitors into one live tree in your browser: three dimensions of space, plus time through live streaming and replay. The command-line tool is `agent4d` (`ccviz` still works).

[![Planet view: your prompt gathers at the screen edge and flies into the main agent's tourbillon](docs/media/planet.gif)](https://github.com/burn001/agent4d/releases/download/v0.1.0/agent4d-intro-v0.1.0.mp4)

▶ **[Watch the 24-second intro video (MP4)](https://github.com/burn001/agent4d/releases/download/v0.1.0/agent4d-intro-v0.1.0.mp4)**

> **Unofficial project.** Agent4D is an independent tool. Anthropic did not make it, does not endorse it and does not support it. "Claude" and "Claude Code" are trademarks of Anthropic, PBC, used here only to say what this tool works with.

## Views

### Flow

The default view: hexagon nodes, tapered curved beams and packets moving along them.

| Live | Dark | Light |
|---|---|---|
| ![Flow view, live loop: a prompt flies in, then edits and a push on the work-target layer](docs/media/flow.gif) | ![All projects, Flow, dark](docs/screenshots/flow-dark.png) | ![One session, Flow, light, with the work-target layer](docs/screenshots/flow-light.png) |

### Planet

The main agent is a gyro tourbillon — a steel cage with chamfered bridges turning over a fixed gold fourth wheel, its escape pinion rolling on the wheel and ticking on each beat, a balance wheel swinging inside a tilted inner cage. Subagents are planets with a simpler cage. Each project is a round orbital system.

| Live | Dark | Light |
|---|---|---|
| ![Planet view, live loop: the camera moves to the main agent, the prompt beam is absorbed, work scenes follow](docs/media/planet.gif) | ![One session, Planet, dark — the main agent as a tourbillon](docs/screenshots/planet-dark.png) | ![All projects, Planet, light — round orbital islands](docs/screenshots/planet-light.png) |

### Voxel Office

Agents as office workers at desks, shelves and terminals.

| Live | Dark | Light |
|---|---|---|
| ![Voxel Office, live loop: a prompt flies to the team lead's desk](docs/media/voxel.gif) | ![All projects, Voxel Office, dark](docs/screenshots/voxel-dark.png) | ![One session, Voxel Office, light](docs/screenshots/voxel-light.png) |

| Your prompt, gathered from the screen edge | Work targets under the Planet view | 2D mode for slow machines |
|---|---|---|
| ![A prompt beam curving into the main agent](docs/screenshots/prompt-beam-dark.png) | ![Edits, a new file and a push on the work-target floor](docs/screenshots/work-targets-planet-dark.png) | ![Flow view in 2D](docs/screenshots/flow-2d-dark.png) |

_All screenshots and loops use the built-in mock data (`?mock=1&lang=en`). Project names and labels are made up._

## Contents

- [Views](#views)
- [Features](#features)
- [Supported harnesses](#supported-harnesses)
- [Requirements](#requirements)
- [Install](#install)
- [Run](#run)
- [Use with Claude Code (skill)](#use-with-claude-code-skill)
- [Background music](#background-music)
- [Remote access (optional)](#remote-access-optional)
- [Usage-limit gauge (opt-in)](#usage-limit-gauge-opt-in)
- [Security and privacy](#security-and-privacy)
- [Configuration](#configuration)
- [FAQ and troubleshooting](#faq-and-troubleshooting)
- [Development](#development)
- [Credits](#credits)
- [License](#license)

## Features

The server tails the transcripts that Claude Code already writes under `~/.claude/projects/` (and background task output files) and streams a summarized event feed to the browser over Server-Sent Events. It never writes to those files.

- **Three views.** **Flow** (default: hexagon nodes, curved beams, packets moving along them), **Planet** (the main agent as a mechanical planet, subagents as eight kinds of worlds such as gas giants, lava, ice, ringed, binary and comet planets, every node circled by its own orbits and moons that speed up while it works, tool holograms projected from the orbit ring, and each project drawn as a round orbital system), and **Voxel Office** (agents as office workers at desks, shelves and terminals). Each view has a **3D** mode and a lighter **2D** mode for slow machines. 2D is picked automatically when WebGL is missing.
- **All projects, or just one.** The start screen shows every active Claude Code session on this machine, one island (or building) per project, with an automatic camera tour. Narrow it to one project or one session from the side panel.
- **Your prompts, followed.** When you send a prompt, the camera moves to the main agent that receives it, energy gathers at a random point on the screen edge and flies in as a soft homing beam, then lands with a ripple (⚙ **Follow my prompts**, on by default; skipped while you steer the camera).
- **Live tool activity.** Panels next to each node show the current tool (shell, read, edit, search, web, agent, skill…) and a one-line summary. A collapsible side panel shows a live text feed.
- **Replay.** Play past or running sessions from the start at 0.5×–32×, with idle gaps compressed, a scrubbable timeline, highlight markers and continuous playback. An optional read-only **archive** folder keeps transcripts around for replay after the originals are gone (`agent4d archive add`).
- **Plan board** (off by default). TodoWrite and task lists, plan-mode text and Markdown checklists appear as one small board pinned in the world next to the runner when there is one, otherwise next to the main agent. The board is as wide as a tool hologram and 1.5 times as tall, with a single line back to its anchor.
- **Gauges.** A per-session **context usage** gauge, with an optional "signal degradation" effect (grain, scanlines, glitches) as the context fills up, and an opt-in **usage-limit** gauge for the 5-hour and 7-day windows.
- **Sound** (off until you turn it on). 12 background tracks synthesized from code, plus sound effects synthesized live in the browser.
- **Languages.** The web UI and the CLI are in English by default and switch to Korean on a Korean locale. Both can be forced (see [FAQ](#faq-and-troubleshooting)).
- **Remote access** (optional). A Cloudflare quick tunnel plus a small Cloudflare Worker give you a stable, token-protected link that survives restarts.

## Supported harnesses

Agent4D reads **Claude Code** today. Adapters for other agent harnesses are welcome as community pull requests — see [docs/ADAPTERS.md](docs/ADAPTERS.md) for how the reader works and what an adapter has to provide.

| Harness | Status | Session files (to verify) | Tracking issue |
|---|---|---|---|
| Claude Code | ✅ Supported | `~/.claude/projects/<project>/<session>.jsonl` | — |
| Codex CLI | Help wanted — PRs welcome | `~/.codex/sessions/**/*.jsonl` (unverified) | [#1](https://github.com/burn001/agent4d/issues/1) |
| Gemini CLI | Help wanted — PRs welcome | `~/.gemini/tmp/<project-hash>/` chats and checkpoints (unverified) | [#2](https://github.com/burn001/agent4d/issues/2) |
| OpenClaw | Help wanted — PRs welcome | session JSONL files (unverified) | [#3](https://github.com/burn001/agent4d/issues/3) |
| Hermes | Help wanted — PRs welcome | unknown | [#4](https://github.com/burn001/agent4d/issues/4) |

## Requirements

- **Node.js 22.18 or newer.** The server and CLI use only Node built-in modules, so there is nothing to `npm install` for local use.
- A desktop browser. 3D needs WebGL; 2D works without it.
- **Tested on Windows only.** The code has POSIX branches (process handling, the `bin/agent4d` shell wrapper), but macOS and Linux have not been tested yet. `autostart` is Windows-only (Task Scheduler).
- For remote access only: [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/), and for the stable link a Cloudflare account with the `cf` CLI.
- To regenerate the music only: Python 3 with `numpy` and `lameenc` (`music/requirements.txt`).

## Install

```bash
git clone https://github.com/burn001/agent4d.git
cd agent4d
# optional: background music (see below)
gh release download v0.1.0 --pattern "*.mp3" --dir web/assets
```

That is all. `bin/agent4d` (sh) and `bin/agent4d.cmd` (Windows) are thin wrappers around `node bin/agent4d.mjs`; put `bin/` on your `PATH` if you want to type `agent4d`. The old name still works: `ccviz` (`bin/ccviz`, `bin/ccviz.cmd`, `bin/ccviz.mjs`) is an alias.

## Run

```bash
node bin/agent4d.mjs start      # start the server on 127.0.0.1:7788 and print the local link
node bin/agent4d.mjs url        # print the link again (it contains your view token)
node bin/agent4d.mjs status     # server / tunnel / Worker status
node bin/agent4d.mjs stop       # stop everything `start` launched
node bin/agent4d.mjs help       # all commands and options
```

The first run creates a config file with random tokens (see [Configuration](#configuration)). The link from `url` ends in `?t=<token>`. After the first visit the browser keeps a cookie and the token is removed from the address bar.

`start` stays local unless you ask otherwise. It opens a public Cloudflare tunnel only with `--tunnel`, or when the config has `"remote": true` or a deployed `workerUrl`. `--no-tunnel` always forces local-only. Add `--watch` to keep a small watchdog that restarts the server if it dies.

**Try it without your own data:**

```bash
npm run demo        # synthetic session tree: reads no transcripts, makes no network calls
```

Then open `http://127.0.0.1:7788/?t=<viewToken>` (the token is `viewToken` in the config file). On a running server you can also add `&mock=1` (one session) or `&mock=1&scope=all` (all projects) to the link to drive the UI from built-in mock data, and `&view=planet` or `&view=voxel` to pick a view.

## Use with Claude Code (skill)

The repository ships a Claude Code skill in `skills/agent4d/`. Copy it into your personal skills folder and you can ask Claude Code things like "open agent4d", "show my agents in 3D" or "stop agent4d". The skill finds your install (`AGENT4D_HOME`, then `~/agent4d`, then `agent4d` on `PATH`), starts the local server if needed and shows you the link. It never starts a public tunnel unless you ask for one.

```bash
# inside the clone (macOS / Linux / Git Bash)
mkdir -p ~/.claude/skills && cp -r skills/agent4d ~/.claude/skills/
```

```powershell
# Windows PowerShell, inside the clone
New-Item -ItemType Directory -Force "$HOME\.claude\skills" | Out-Null
Copy-Item -Recurse -Force skills\agent4d "$HOME\.claude\skills\"
```

If your clone is not at `~/agent4d`, set `AGENT4D_HOME` to its folder. Start a new Claude Code session after copying so the skill is picked up.

## Background music

The 12 tracks (`bgm.mp3`, `bgm-lofi.mp3`, `bgm-jazz.mp3`, `bgm-city.mp3`, `bgm-chillhop.mp3`, `bgm-dawn.mp3`, `bgm-deephouse.mp3`, `bgm-drive.mp3`, `bgm-funk.mp3`, `bgm-liquid.mp3`, `bgm-orbit.mp3`, `bgm-uplift.mp3`; about 4.6 MB each) are attached to the [v0.1.0 release](https://github.com/burn001/agent4d/releases/tag/v0.1.0) rather than stored in the repository. Put them in `web/assets/`. Without them the viewer works fine, just without music (sound effects still play).

```bash
# with the GitHub CLI, inside the clone
gh release download v0.1.0 --pattern "*.mp3" --dir web/assets

# or with curl, one file at a time
curl -L -o web/assets/bgm-lofi.mp3 https://github.com/burn001/agent4d/releases/download/v0.1.0/bgm-lofi.mp3
```

You can also generate them yourself. Output is deterministic; each track takes about 2–4 minutes and up to 1.5 GB of RAM.

```bash
python -m pip install -r music/requirements.txt
python music/compose.py                                   # web/assets/bgm.mp3
python music/compose_lofi.py --out <tmp>/bgm-lofi.mp3     # likewise jazz, city, chillhop, dawn, …
python music/tracks.py copy lofi --from <tmp>             # copy mp3 + json into web/assets/
```

`music/README.md` (in Korean) has the details.

## Remote access (optional)

Everything here runs on **your own Cloudflare account**. Nothing in this repository points at a shared deployment.

```
browser ─▶ https://cc-agent-viz.<your-subdomain>.workers.dev/?t=<token>   (stable link)
             Worker: check token → cookie → look up the current origin in KV → proxy (SSE streaming)
               ─▶ https://<random>.trycloudflare.com                     (quick tunnel, changes on restart)
                    ─▶ relay :7789 ─▶ server :7788 (127.0.0.1)
```

1. Install `cloudflared`. On Windows the default path is `C:/Program Files (x86)/cloudflared/cloudflared.exe`; elsewhere it is looked up on `PATH`. You can set `cloudflaredPath` in the config.
2. Install the Cloudflare `cf` CLI and sign in (`cf auth login`). The Worker is configured in `cloudflare/cloudflare.config.ts`; no Wrangler file is used.
3. `node bin/agent4d.mjs deploy` creates or reuses a KV namespace, deploys the Worker (named `cc-agent-viz` unless you change `workerName`), sets the `VIEW_TOKEN` and `ADMIN_SECRET` secrets, and saves your `workers.dev` URL in the config. The KV namespace ID is passed at deploy time and never written to the repository.
4. `node bin/agent4d.mjs start --tunnel --watch` starts the server, relay and tunnel, registers the tunnel address with the Worker, and keeps a watchdog that restarts and re-registers on failure. Once `deploy` has saved a `workerUrl`, a plain `start` also goes remote; set `"remote": false` in the config (or pass `--no-tunnel`) to stay local.
5. `node bin/agent4d.mjs rotate-token` issues a new view token and updates the Worker secret. Old links stop working.

Useful options: `start --project <encoded-project-dir>` limits what the link can see to one project; `start --session <id>` pins the link to one session.

## Usage-limit gauge (opt-in)

The 5-hour / 7-day gauge is filled by a small collector that reads the Claude Code OAuth access token from `~/.claude/.credentials.json` and calls `https://api.anthropic.com/api/oauth/usage`. **This endpoint is undocumented and unofficial** and may change or stop working at any time.

- The collector polls every 180 s (60 s above 80 % usage), caches results for 60 s and never refreshes tokens.
- Only percentages and reset times reach the browser. The token is never logged or forwarded.
- It identifies itself with the User-Agent `agent4d/<version>`.

It is **off by default**. To turn it on, run `node bin/agent4d.mjs start --limits` once; this saves `"limits": { "source": "oauth" }` in the config (restart a running server with `stop`, then `start`). `start --no-limits` turns it off again. `node bin/agent4d.mjs limits --once` queries it once from the command line. Use it at your own discretion.

## Security and privacy

Read this before you share any link.

- **The viewer shows your session content.** Prompts, assistant messages, file paths, shell commands and their output appear on screen. They are summarized and truncated, but they are real. Anyone with a valid link can see them.
- **The token is the only lock.** Every request needs the view token (query `t`, cookie, or `X-CCVIZ-Token` header). There is no localhost exemption. Treat a link with `?t=` like a password: keep it out of chats, tickets and screenshots. If it leaks, run `rotate-token`.
- **All projects are visible by default.** Unless `project` is set (or `start --project`), a token holder can browse every Claude Code session on the machine. Limit it to one project before giving a link to anyone else.
- **Local only by default.** The server binds to `127.0.0.1`. It is reachable from the internet only through the optional tunnel and Worker, which you turn on yourself (`--tunnel`, `"remote": true`, or a deployed Worker).
- **Read-only.** The server only reads transcripts and task output. The archive feature writes only to the archive folder you choose, and only when you run `agent4d archive add`.
- **Redaction is best-effort.** All text passes through `server/redact.mjs`, which masks API keys, bearer tokens, JWTs, PEM blocks, credentials in URLs, `password=`-style pairs, emails, phone and ID numbers, and long opaque strings. Thinking content and full tool inputs are never sent. `"privacy": "minimal"` sends even less. Redaction cannot catch everything, so don't rely on it for sensitive work.
- **Tokens stay out of log files.** The CLI prints the tokenized link to the console only.

## Configuration

State and secrets live outside the repository, in `~/.cc-agent-viz/` (the folder keeps the project's earlier name for now). If you used an earlier version and `~/.cc-session-viz/` exists, that folder keeps being used. Set `CCVIZ_HOME` to use any other folder. Files are created with owner-only permissions where the OS allows it.

| File | Contents |
|---|---|
| `config.json` | `viewToken`, `adminSecret`, `port` (7788), `privacy` (`summary` / `minimal`), `project`, `linkSession`, `remote` (`true` / `false`; unset = remote only if `workerUrl` is set), `cloudflaredPath`, `tunnelProtocol` (`http2`), `workerName` (`cc-agent-viz`), `workerUrl`, `kvNamespaceId`, `limits { source: off (default) / oauth / auto / statusline, … }`, `overviewMaxRoots`, `archiveDir`, `serviceScripts` |
| `usage-cache.json` | last usage-limit values (percentages and reset times only) |
| `state.json` | process IDs of the server, relay, tunnel and watchdog; current tunnel URL |
| `logs/` | `server.log`, `relay.log`, `cloudflared.log`, `watch.log` |

Claude Code data is read from `~/.claude` (or `CLAUDE_CONFIG_DIR`). The archive folder is set with `archiveDir`, `CCVIZ_ARCHIVE` or `--dir`; there is no default.

`serviceScripts` lets the "work targets" layer label your own helper scripts as external services, for example `[{ "pattern": "my-mail-cli\\.mjs", "name": "Mail" }]` (a case-insensitive regex matched against the arguments of `node`, `python` or `bash`). Well-known CLIs (`gws`, `aws`, `gcloud`, `cf`, `docker`, …) are recognized without it.

## FAQ and troubleshooting

**The page is empty or says it is waiting for sessions.**
The viewer only shows sessions that Claude Code has written to `~/.claude/projects/`. Start or continue a Claude Code session and it appears within a few seconds. If your Claude Code data lives elsewhere, set `CLAUDE_CONFIG_DIR` before `start`.

**I get "401" or "unauthorized".**
The link needs the view token. Run `node bin/agent4d.mjs url` and open that link once; the browser then keeps a cookie. After `rotate-token`, old links and cookies stop working.

**Port 7788 is already in use.**
Use `start --port 7790` (or set `port` in the config). `status` shows what `agent4d` itself is running; `stop` stops it.

**3D is blank, black or very slow.**
Switch to 2D with the 3D/2D button in the top bar (or add `&dim=2d` to the link). three.js is loaded from the jsDelivr CDN; on networks that block it, only 2D works.

**No music.**
The MP3 files are not in the repository; see [Background music](#background-music). Browsers also block audio until you interact with the page, so click once after turning sound on.

**The usage-limit gauge shows nothing.**
It is off by default. Turn it on with `start --limits`, and make sure you are signed in to Claude Code with a subscription account (the collector reads `~/.claude/.credentials.json`). The endpoint is unofficial and may stop working.

**How do I change the language?**
Web UI: the language row in the ⚙ settings menu, or `?lang=en` / `?lang=ko` in the link. CLI: `--lang en|ko` or the `CCVIZ_LANG` environment variable; otherwise `LC_ALL`, `LC_MESSAGES`, `LANG` and then the system locale decide, with English as the fallback.

**Does it send my data anywhere?**
Not in the default local mode. Only the optional remote mode sends the viewer stream through your own Cloudflare tunnel and Worker, and only the opt-in usage-limit collector talks to Anthropic's API (to read your own usage).

**Is it safe to run next to Claude Code?**
Yes. It only reads files that Claude Code writes, never modifies them, and does not talk to the Claude Code process.

## Development

```bash
npm test            # node --test for server/ and web/
agent4d --version   # also shown by `agent4d status` and at the bottom of the ⚙ menu
```

Releases follow [Semantic Versioning](https://semver.org/) (0.x until 1.0); see [CHANGELOG.md](CHANGELOG.md). Contributions: [CONTRIBUTING.md](CONTRIBUTING.md).

Most code comments are in Korean. Bug reports and pull requests are welcome; please include your OS, Node version and browser, and never paste a link that contains `?t=`.

## Credits

- The **Flow** view's visual language (deep navy space, hexagon nodes, tapered curved beams, comet-like packets, speech bubbles) is inspired by [patoles/agent-flow](https://github.com/patoles/agent-flow) (Apache-2.0). This project is not affiliated with it.
- [three.js](https://threejs.org/) r170 (MIT), loaded at runtime from the jsDelivr CDN with Subresource Integrity hashes. The 2D mode does not load it.
- Background music is generated by the scripts in `music/` with [numpy](https://numpy.org/) and encoded with [lameenc](https://github.com/chrisstaite/lameenc). Three tracks (lofi, jazz, city) are arrangements derived from the author's earlier project; the rest are original.
- Remote access uses [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) (`cloudflared`) and [Cloudflare Workers](https://workers.cloudflare.com/) with KV.

## License

[Apache License 2.0](LICENSE) © 2026 burn001 (Dr. Cho, Sangkyu). See [NOTICE](NOTICE). Uses [three.js](https://threejs.org) (MIT).
