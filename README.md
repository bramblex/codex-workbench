# codex-workbench

A small terminal workbench for browsing and managing local Codex sessions.

It reads Codex session JSONL files, groups sessions by project directory, and lets you inspect, rename, annotate, resume, fork, archive, unarchive, or delete sessions from either a command-line interface or an interactive terminal UI.

## Install

```sh
npm install -g @bramblex/codex-workbench
```

codex-workbench expects the Codex CLI to be available from your shell. You can check what executable will be used with:

```sh
codex-workbench doctor
```

For local development:

```sh
npm install
```

Then run the CLI through Node:

```sh
node bin/codex-workbench --help
```

To expose the `codex-workbench` command locally:

```sh
npm link
codex-workbench list
```

## Usage

```sh
codex-workbench [ui]
codex-workbench doctor
codex-workbench list [--json] [--cwd <dir>] [--all]
codex-workbench show <session>
codex-workbench rename <session> <name>
codex-workbench note <session> <note>
codex-workbench new [--cwd <dir>] [prompt...]
codex-workbench resume <session> [prompt...]
codex-workbench fork <session>
codex-workbench archive <session>
codex-workbench unarchive <session>
codex-workbench hide <session>
codex-workbench unhide <session>
codex-workbench delete <session> [--force] [--file]
```

Run without arguments to open the interactive UI:

```sh
codex-workbench
```

The package also installs the short alias:

```sh
cwb
```

Use `list` to find sessions:

```sh
codex-workbench list
codex-workbench list --json
codex-workbench list --cwd /path/to/project
codex-workbench list --all
```

Use `new` to start a fresh Codex session in a project directory:

```sh
codex-workbench new --cwd /path/to/project
codex-workbench new --cwd /path/to/project "Summarize this repo"
```

Use `hide` for sessions that Codex itself can no longer resume, archive, or delete. Hidden sessions are removed from the default list but remain visible with `--all`:

```sh
codex-workbench hide <session>
codex-workbench unhide <session>
codex-workbench list --all
```

Use `delete --file` only for broken sessions that Codex can no longer remove. It deletes the local session JSONL file directly:

```sh
codex-workbench delete <session> --file
```

Use `doctor` to check which Codex executable the CLI will launch:

```sh
codex-workbench doctor
```

Most commands accept a full session id, a unique prefix, a saved name, or a session filename.

## Interactive UI

The UI groups sessions by working directory, with projects on the left, sessions on the upper right, and details below. When you start or resume a session, Codex temporarily takes over the terminal; when Codex exits, codex-workbench redraws the UI.

Common keys:

- `Enter`: resume the selected session in Codex
- `n`: create a new project/session from Projects, or a new session from Sessions/Details
- `f`: fork the selected session
- `v`: print session details and exit
- `r`: rename the selected session
- `o`: add or edit a note
- `a`: archive the selected session
- `d`: delete the selected session
- `Tab`: switch focus between projects, sessions, and details
- `Left`/`Right` or `h`/`l`: move between panes
- `q`, `Esc`, or `Ctrl+C`: quit

In the directory picker, use `Up`/`Down` or `j`/`k` to move, `Left`/`h` for the parent directory, `Right`/`l` for the selected child directory, `n` to create a child directory, and `Enter` to choose the selected directory.

## Environment

```sh
CODEX_HOME            # default: ~/.codex
CODEX_SESSIONS_DIR    # default: $CODEX_HOME/sessions
CODEX_WORKBENCH_META  # default: $CODEX_HOME/codex-workbench.json
CODEX_BIN             # default: codex from shell PATH
```

`CODEX_WORKBENCH_META` stores local workbench metadata such as custom names and notes. Session content remains in the Codex sessions directory.

By default, codex-workbench launches `codex` through your shell so your normal shell `PATH` applies. Set `CODEX_BIN` if you want to force a specific executable path.

## Development

```sh
npm test
npm pack --dry-run
```

Project layout:

```text
bin/codex-workbench  # executable entrypoint
src/cli.js           # main CLI and UI implementation
src/codex-bin.js     # Codex executable discovery
test/smoke.js        # smoke tests
```
