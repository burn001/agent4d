---
name: agent4d
description: Open Agent4D, a local read-only viewer that shows your Claude Code agents (main agent, subagents, workflows, nested claude -p runs, background shells) live in 3D space and lets you replay past sessions. Finds the Agent4D install (or explains how to get it), starts the local server if it is not running, and prints the viewer link. Use when the user says "open agent4d", "agent4d", "Agent4D", "show my agents in 3D", "visualize my Claude Code session", "show subagents", "replay my session", "stop agent4d", "agent4d 열어줘", "에이전트 3D로 보여줘".
allowed-tools: Bash
---

# Agent4D — your coding agents in 3D space + time

Agent4D is a local, read-only viewer for Claude Code sessions. It reads transcripts under `~/.claude/projects`, never writes to them, and serves a browser view on `127.0.0.1` only. Project: https://github.com/burn001/agent4d

## 1. Find the install

Check in this order and use the first one that works:

1. Environment variable `AGENT4D_HOME` — a clone folder that contains `bin/agent4d.mjs`.
2. `~/agent4d` — a clone in the home folder.
3. `agent4d` on `PATH` (the `bin/` wrappers) — run `agent4d <command>` directly instead of `node bin/agent4d.mjs <command>`.

```bash
if [ -n "$AGENT4D_HOME" ] && [ -f "$AGENT4D_HOME/bin/agent4d.mjs" ]; then A4D="node $AGENT4D_HOME/bin/agent4d.mjs"
elif [ -f "$HOME/agent4d/bin/agent4d.mjs" ]; then A4D="node $HOME/agent4d/bin/agent4d.mjs"
elif command -v agent4d >/dev/null 2>&1; then A4D="agent4d"
else echo "Agent4D not found"; fi
```

If none is found, do not install anything on your own. Tell the user how to get it (Node.js 22.18 or newer, no `npm install` needed) and ask before cloning:

```bash
git clone https://github.com/burn001/agent4d.git ~/agent4d
```

(Optional background music: `gh release download v0.1.0 --pattern "*.mp3" --dir web/assets` inside the clone.) If the user keeps the clone somewhere else, suggest setting `AGENT4D_HOME` to that folder.

## 2. Start and get the link

```bash
$A4D status     # is the server running?
$A4D start      # only if it is not running; local-only (127.0.0.1:7788) by default
$A4D url        # print the viewer link (contains the view token)
```

Show the link from `url` (or from `start`) to the user and suggest opening it in a desktop browser. The first run creates a config file with random tokens; that is expected.

## 3. Other things the user may ask for

- **Stop:** `$A4D stop` stops everything `start` launched.
- **All commands and options:** `$A4D help`.
- **2D mode** for slow machines or browsers without WebGL: the 3D/2D button in the top bar, or add `&dim=2d` to the link.
- **Views:** Flow (default), Planet and Voxel Office, chosen from the view menu in the top bar (or `&view=planet`, `&view=voxel`).
- **Replay:** pick a past or running session in the viewer and play it from the start at 0.5×–32×, with a scrubbable timeline.
- **Try without real data:** `npm run demo` inside the clone shows a synthetic session tree.

## Rules

- The link contains a view token and anyone with it can see session content (prompts, file paths, commands). Show it to the user in this conversation only. Do not write it to files, commits, issues, logs or other tools, and do not send it anywhere.
- Keep the server local. Use `start --tunnel` (a public Cloudflare tunnel) only when the user explicitly asks for access from another device, and remind them that the link then works from the internet. `--no-tunnel` always forces local-only.
- Agent4D only reads transcripts. Do not edit files under `~/.claude/projects` or the Agent4D config to make it work; report errors from `status` or `start` to the user instead.
