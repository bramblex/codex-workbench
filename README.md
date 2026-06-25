# codex-workbench

> Terminal workbench for browsing, organizing, and resuming [Codex](https://github.com/openai/codex) sessions — locally and across SSH remotes.

[![npm version](https://img.shields.io/npm/v/@bramblex/codex-workbench)](https://www.npmjs.com/package/@bramblex/codex-workbench)
[![license](https://img.shields.io/npm/l/@bramblex/codex-workbench)](LICENSE)
[![node](https://img.shields.io/node/v/@bramblex/codex-workbench)](package.json)

---

## What is it?

codex-workbench gives you a fast, keyboard-driven terminal UI over your Codex sessions. It reads session JSONL files from the Codex sessions directory and lets you **inspect, rename, annotate, fork, archive, hide, and delete** sessions without digging through `~/.codex/sessions/` by hand.

It also aggregates sessions from **remote machines over SSH** — so you can manage Codex sessions across all your servers from one terminal.

Run it without arguments to open the interactive TUI, or use the CLI subcommands for scripting and automation.

---

## Features

- **Interactive TUI** — three-pane layout: sources/projects → sessions → details
- **Remote SSH sources** — browse and manage sessions on distant machines with zero remote dependencies beyond `codex-workbench` itself
- **Session metadata** — assign custom names and notes, hide stale sessions without deleting them
- **One-key actions** — resume, fork, archive, or delete sessions from the keyboard
- **Directory picker** — navigate the filesystem to start new sessions in any project
- **JSON output** — pipe `list --json` into `jq` or other tools
- **Short aliases** — installed as both `codex-workbench` and `cwb`

---

## Quick start

```bash
npm install -g @bramblex/codex-workbench
```

Make sure Codex is available in your shell `PATH`. Verify everything is wired up:

```bash
codex-workbench doctor
```

Then open the workbench:

```bash
codex-workbench
# or just:
cwb
```

---

## CLI commands

### Browse sessions

```bash
codex-workbench list                          # human-readable, grouped by source + project
codex-workbench list --json                   # machine-readable full output
codex-workbench list --json --compact         # omit message history (faster for scripting)
codex-workbench list --cwd ~/projects/foo     # filter to one working directory
codex-workbench list --all                    # include archived and hidden sessions
```

### Inspect a session

```bash
codex-workbench show <session>
```

`<session>` can be a full session id, a unique prefix, a saved custom name, or a session filename.

### Manage sessions

```bash
codex-workbench rename <session> "fix the auth bug"
codex-workbench note <session> "investigated JWT expiry, seems to be clock skew"
codex-workbench archive <session>
codex-workbench unarchive <session>
codex-workbench hide <session>         # remove from default list but keep on disk
codex-workbench unhide <session>
codex-workbench fork <session>
codex-workbench delete <session> --force
```

### Start and resume

```bash
codex-workbench new --cwd ~/projects/foo "Summarize this repo"
codex-workbench resume <session> "what was the conclusion about the rate limiter?"
```

When you run `new` or `resume`, Codex takes over the terminal. When it exits, codex-workbench returns.

### Directories

```bash
codex-workbench dirs --cwd ~/projects
codex-workbench dirs --json
codex-workbench mkdir ~/projects my-new-feature
```

### Diagnostics

```bash
codex-workbench doctor
```

### Force-delete a broken session file

```bash
codex-workbench delete <session> --file
```

Only use `--file` when Codex itself cannot remove the session. It deletes the JSONL file directly without going through the Codex CLI.

---

## Interactive TUI

Run `cwb` with no arguments to open the TUI:

```
┌─ Codex Workbench ───────────────────────────────────────────────────┐
│  12/57 visible  Local: ~/projects/api                              │
├──────────────┬──────────────────────────────────────────────────────┤
│ > Sources    │ > Sessions                                           │
│              │                                                      │
│ 0 All (57)   │ a1b2c3d4e5f6g  23t  2025-03-15 14:22  fix auth bug  │
│ = host-a (5) │ c8d9e0f1a2b3c  12t  2025-03-14 09:15  refactor db   │
│   api (3)    │ d4e5f6g7h8i9j   5t  2025-03-13 16:48  add tests      │
│   web (2)    │ ...                                                  │
│ = host-b (7) │                                                      │
│   data (4)   ├──────────────────────────────────────────────────────┤
│   infra (3)  │ > Details                                            │
│              │                                                      │
│              │ fix auth bug                                         │
│              │ id:       a1b2c3d4e5f6g7...                          │
│              │ source:   Local                                      │
│              │ cwd:      ~/projects/api                             │
│              │ ...                                                  │
├──────────────┴──────────────────────────────────────────────────────┤
│ Sessions: ↑/↓ select  Enter resume  r rename  n new  d delete  q quit│
└─────────────────────────────────────────────────────────────────────┘
```

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Enter` | Resume selected session in Codex |
| `Tab` / `S-Tab` | Switch focus between panes |
| `←` `→` / `h` `l` | Move between sources, sessions, and details |
| `↑` `↓` / `j` `k` | Move selection up/down |
| `0` | Show all sources |
| `1`–`9` | Jump to source |
| `[` `]` | Previous / next source |
| `n` | New session (picks directory from active project) |
| `f` | Fork selected session |
| `r` | Rename selected session |
| `o` | Add or edit note |
| `a` | Archive selected session |
| `d` | Delete selected session |
| `v` | Print session details to stdout and exit |
| `q` / `Esc` / `Ctrl+C` | Quit |

### Directory picker

When creating a new session, the directory picker opens:

| Key | Action |
|-----|--------|
| `↑` `↓` / `j` `k` | Move selection |
| `←` / `h` | Go to parent directory |
| `→` / `l` | Enter child directory |
| `n` | Create a new subdirectory |
| `Enter` | Choose selected directory |
| `q` / `Esc` | Cancel |

---

## Remote SSH sources

codex-workbench can show sessions from remote machines by running `cwb` over SSH.

### Requirements

The remote machine must have `codex-workbench` installed and the `cwb` command available in the **non-interactive SSH PATH** (not just your interactive shell). Test it:

```bash
ssh user@host 'cwb list --json'
```

### Configuration

Create `~/.codex/codex-workbench.config.json`:

```json
{
  "servers": [
    {
      "id": "devbox",
      "label": "Dev box",
      "target": "user@dev.example.com"
    },
    {
      "id": "gpu",
      "label": "GPU server",
      "target": "gpu-host",
      "command": "/usr/local/bin/cwb",
      "sshArgs": ["-p", "2222"]
    }
  ]
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `target` | Yes | SSH destination (`user@host` or hostname) |
| `id` | No | Short identifier (defaults to sanitized target) |
| `label` | No | Display name in the UI |
| `command` | No | Path to `cwb` on the remote (default: `cwb`) |
| `sshArgs` | No | Extra SSH flags, e.g. `["-p", "2222"]` |

Remote sources appear alongside `Local` in the TUI and load asynchronously in the background. Most operations (rename, note, hide, new, resume, fork, archive, delete) are forwarded to the remote `cwb`.

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CODEX_HOME` | `~/.codex` | Codex data directory |
| `CODEX_SESSIONS_DIR` | `$CODEX_HOME/sessions` | Session JSONL files |
| `CODEX_WORKBENCH_META` | `$CODEX_HOME/codex-workbench.json` | Workbench metadata (names, notes) |
| `CODEX_WORKBENCH_CONFIG` | `$CODEX_HOME/codex-workbench.config.json` | SSH remote sources config |
| `CODEX_BIN` | auto-detected | Force a specific Codex executable |

By default, codex-workbench discovers the `codex` binary through your login shell's `PATH`. Set `CODEX_BIN` to override.

---

## Troubleshooting

### "Could not find the codex executable"

Run `codex-workbench doctor` to see where codex-workbench is looking. Common fixes:

- Run `npm install -g @openai/codex` to install Codex globally
- Set `CODEX_BIN=/path/to/codex` to point directly at the executable
- Make sure your shell profile (`~/.zshrc`, `~/.bashrc`) adds Codex to `PATH`

### No sessions appear

Make sure you've run Codex at least once. Sessions are stored as `.jsonl` files under `$CODEX_SESSIONS_DIR`. Run `ls ~/.codex/sessions/` to verify.

### Remote source shows an error

Verify the remote is reachable and has `cwb` in its non-interactive PATH:

```bash
ssh user@host 'cwb list --json --compact'
```

If that fails, set the `command` field in your config to the full path:

```json
{ "command": "/home/user/.nvm/versions/node/v20/bin/cwb" }
```

### TUI rendering issues

codex-workbench uses [blessed](https://github.com/chjj/blessed) for terminal rendering. If you see garbled output, try a different terminal emulator (iTerm2, Kitty, WezTerm, and the built-in macOS Terminal all work well).

---

## Development

```bash
git clone https://github.com/bramblex/codex-workbench.git
cd codex-workbench
npm install
```

Run the CLI directly:

```bash
node bin/codex-workbench --help
```

Or link it locally:

```bash
npm link
cwb list
```

### Project layout

```
bin/codex-workbench          # executable entry point
src/
  cli.js                     # CLI argument parsing and command dispatch
  cli-output.js              # terminal output formatters
  codex-bin.js               # Codex binary discovery (PATH, shell, fallback)
  config.js                  # environment-derived path constants
  model/
    session-store.js         # session JSONL parsing and metadata persistence
    format.js                # id/time/text formatting helpers
    directories.js           # filesystem directory listing and creation
    workbench-config.js      # SSH remote source config loader
  services/
    codex-runner.js          # spawn Codex processes (new, resume, fork, etc.)
    session-sources.js       # aggregates local + remote session lists
    ssh-runner.js            # runs cwb commands over SSH (sync + async)
  ui/
    blessed-compat.js        # blessed terminfo compatibility patch
    workbench.js             # interactive TUI (blessed-based three-pane layout)
    directory-picker.js      # TUI filesystem directory picker
test/
  smoke.js                   # end-to-end CLI smoke test
  codex-bin.test.js          # binary discovery unit tests
  session-sources.test.js    # session source aggregation tests
  blessed-compat.test.js     # terminfo patch verification
scripts/
  pty-codex.js               # PTY-based Codex runner prototype
  tui-pty-codex.js           # PTY + blessed integration prototype
  blessed-xterm-codex.js     # xterm + blessed integration prototype
```

### Tests

```bash
npm test
```

This runs syntax checks on all source files and executes the test suite.

### Publishing

```bash
npm pack --dry-run
npm publish --access public
```
