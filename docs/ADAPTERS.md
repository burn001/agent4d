# Writing an adapter for another agent harness

Agent4D currently reads **Claude Code** sessions only. The browser never touches transcripts. It renders a small, harness-neutral stream of **nodes** and **events** that the server builds. A new harness (Codex CLI, Gemini CLI, OpenClaw, Hermes, …) therefore needs a server-side adapter that turns that harness's session files into the same nodes and events. The web views (Flow, Planet, Voxel Office, 3D and 2D) should not need to change.

This document describes how the Claude Code path works today and what an adapter has to provide. It is written from the code in `server/`. When this document and the code disagree, the code wins. Please open an issue in that case.

> Status: no adapter interface has been extracted yet. The Claude Code reader lives directly in `server/session.mjs` and `server/discovery.mjs`. A first adapter PR is welcome to introduce a thin interface (see [Suggested shape](#suggested-shape)). Please keep it small and avoid a big refactor in the same PR.

## 1. How the Claude Code path works

| Step | File / symbol | What it does |
|---|---|---|
| Session discovery | `server/discovery.mjs` → `SessionIndex`, `claudeHome()`, `claudeTmpRoots()` | Scans `~/.claude/projects/*/<sessionId>.jsonl` (or `$CLAUDE_CONFIG_DIR/projects`), reads `~/.claude/sessions/<pid>.json` to tell live from finished sessions, and reads the head and tail of each transcript for title, cwd, entrypoint and last timestamp. Background task output files are looked up under the OS temp folder (`findTaskOutput`). Everything is opened read-only. |
| Incremental tail | `server/tail.mjs` → `FileTail` | Byte-offset polling (about 500 ms `stat`, 1 MB chunks), keeps an unfinished last line in a buffer, resets to 0 on truncation, skips very large `api-request` lines before `JSON.parse`. There is no `fs.watch` dependency (Windows-friendly). |
| Record handling | `server/session.mjs` → `RootRuntime.handleRecord()` and `onAssistant`, `onToolUse`, `onUser`, `onToolResult`, `onSystem`, `onNotification`, `onJournal`, `onAgentMeta`, `onOutput` | One `RootRuntime` per session root (a main session plus everything below it). It maps each JSONL record to node and event changes, keeps a `toolUseId → owner node` index across files, and recursively attaches subagents, workflow runs, nested `claude -p` sessions, background shells and monitors. |
| Graph and events | `server/graph.mjs` → `Graph` | Holds the node tree and a ring buffer of events with a global `seq`. `emit()` truncates and redacts every text field (`server/redact.mjs`) before anything leaves the process. |
| Summaries | `server/parse.mjs` (`toolCategory`, `summarizeToolInput`, `summarizeToolResult`, `parseTaskNotification`), `server/brief.mjs` | Tool → icon category (`cat`) and the short one-line summaries shown in the UI. |
| Optional layers | `server/panel.mjs` (hologram panel lines), `server/interactions.mjs` (git/db/ssh/test highlights, field `ix`), `server/artifacts.mjs` (files/repos/DBs touched, field `art`), `server/plans.mjs` (plan board, `meta.plans`), `server/ctx.mjs` (context gauge), `server/usage.mjs`/`limits.mjs` (usage-limit gauge) | All optional. The views simply skip what is missing. |
| Multi-project view | `server/overview.mjs`, `server/projects.mjs` | Holds several roots at once and merges them into one stream with project grouping. |
| Replay | `server/replay.mjs` | Rebuilds a session offline with the same `RootRuntime` (`offline: true`) and pages the events. An adapter that works live usually works in replay for free. |
| HTTP / SSE | `server/index.mjs`, `server/sse.mjs` | `/sessions`, `/state` (snapshot), `/events` (SSE), `/timeline`, `/replay/*`, `/projects`, `/artifacts`, `/limits`, `/healthz`. |

## 2. What the browser consumes

### Node (minimum fields)

```json
{
  "id": "s:<sessionId>",
  "parentId": null,
  "kind": "main",
  "label": "short human title",
  "status": "active",
  "startedAt": "2026-01-01T00:00:00.000Z",
  "endedAt": null,
  "lastActivityAt": "2026-01-01T00:00:05.000Z",
  "depth": 0,
  "sessionId": "<sessionId>",
  "meta": { "cwd": "/path/to/project" },
  "counts": { "tools": 0, "errors": 0, "texts": 0 },
  "openTools": []
}
```

- `kind`: `main` | `subagent` | `workflow` | `workflow-agent` | `claude-p` (a nested headless run of the same harness) | `bash-bg` (background shell) | `monitor`. Use `main` and `subagent` if your harness has nothing else.
- `status`: `active` | `idle` | `done` | `error` | `stopped`.
- IDs are prefixed strings: `s:` session, `a:` agent, `w:` workflow run, `b:` background shell, `m:` monitor. They must be stable for the life of the session.
- `meta.cwd` is used to group sessions into projects. `meta.title` (optional) is the session title.

### Events (common fields: `seq`, `ts` ISO time from the transcript, `type`, `nodeId`)

| `type` | Extra fields | Notes |
|---|---|---|
| `node-add` | `node` | |
| `node-update` | `patch` (changed fields only) | e.g. `{ "status": "done", "endedAt": "…" }` |
| `tool-start` | `toolUseId`, `tool`, `cat`, `text` (≤160 chars) | `cat` comes from `toolCategory()`: `shell`, `read`, `write`, `edit`, `search`, `agent`, `workflow`, `skill`, `web`, `monitor`, `mcp`, `artifact`, `notify`, `other` |
| `tool-end` | `toolUseId`, `tool`, `cat`, `ok`, `durationMs`, `text` | |
| `text` | `role` (`assistant` / `system`), `text` (≤400) | |
| `thinking` | `chars` | content is never sent |
| `user` | `origin` (`human` / `task-notification` / `system`), `text` | `human` is a message from you; with an `ix` field of category `user` it also drives the user console (last words, state, detail card) |
| `result` | `ok`, `text` | final answer of a subagent / nested run |
| `output` | `text` (≤600) | background shell or monitor output |

Optional fields on these events (`panel`, `ix`, `art`, `meta.plans`, context usage) light up extra features. You can leave them out.

## 3. What a new adapter has to implement

1. **Session discovery.** Find session files and tell live sessions from finished ones. Return the same session meta as `/sessions` (`sessionId`, `cwd`, `title`, `mtime`, `sizeBytes`, `live`).
2. **Incremental tail.** Read appended data only. Reuse `FileTail` for JSONL. Never write, move or lock the harness's files.
3. **Event conversion.** Map the harness's records to `node-add` / `node-update` / `tool-start` / `tool-end` / `text` / `user` / `result`. Keep a `toolUseId → owner node` index so results land on the right node.
4. **Subagents and background work.** If the harness can spawn subagents, nested runs or background processes, add them as child nodes with `parentId` pointing at the node whose tool call started them, and end them with `node-update { status }`.
5. **Privacy.** Send summaries only, through `Graph.emit()` so truncation and `redact.mjs` apply. Never send raw tool input, thinking text, credentials or API request bodies.

You may skip anything the harness does not have: the usage-limit gauge, context gauge, plan board, artifacts layer, special interactions, workflows and monitors are all optional.

### Suggested shape

```js
// server/adapters/<name>.mjs (suggested, not existing yet)
export default {
  id: 'codex',                       // used in config and the UI
  discover(opts) { /* → [{ sessionId, file, cwd, title, mtime, sizeBytes, live }] */ },
  createRuntime({ sessionId, privacy, offline }) { /* → object with start(), close(), graph (a Graph) */ },
};
```

A first version can copy `RootRuntime`'s structure and keep only `handleRecord` plus what the harness needs.

## 4. Known (unverified) session locations

These are guesses from public documentation and user reports. Please verify them in your PR.

| Harness | Likely location | Status |
|---|---|---|
| Codex CLI | `~/.codex/sessions/**/*.jsonl` | unverified |
| Gemini CLI | `~/.gemini/tmp/<project-hash>/` (chat logs and checkpoints) | unverified |
| OpenClaw | session JSONL files (path unknown) | unverified |
| Hermes | unknown | unverified |

## 5. Test fixtures

Tests run with `npm test` (Node's built-in test runner, no dependencies). The Claude Code fixtures are generated by `server/test/fixtures/build.mjs`, so tests do not depend on anyone's real home folder.

For a new adapter, please add:

- A **short real session** (a few dozen records) recorded with the harness, with personal data removed: replace usernames, home paths, project names, emails, hostnames, tokens and any file contents with neutral placeholders (`/home/user/my-app`, `alice@example.com`). Keep record types, field names, ordering and timing intact. Or add a builder script like `build.mjs` that writes such a file.
- A test under `server/test/` that runs the adapter offline on the fixture and checks the resulting nodes (kinds, parents, statuses) and a few events (`tool-start`/`tool-end` pairs, `user` with `origin: "human"`).

Please do not attach raw transcripts to issues. They can contain secrets even when they look harmless.
