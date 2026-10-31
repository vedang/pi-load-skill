# pi-load-skill

Explicit, on-demand loading of occasional-use local skills in Pi. The extension
registers `/load-skill`, not a model-callable tool. It does not discover or
advertise your catalog at startup.

## Setup

Requires Pi with the extension, skill-discovery, and TUI APIs used by this package
(developed against Pi 0.84.2), Node.js 22.19 or newer, and pnpm 12.16.1 for development.

Try the extension from this checkout:

```sh
pi -e ./src/index.ts
```

For persistent loading, add this package directory to your normal Pi `packages`
configuration. The package manifest exposes only the extension.

Separately, **you** must add `specific_skills` to the user-level `settings.json`
inside Pi's agent directory (normally `~/.pi/agent`; respects Pi's
`PI_CODING_AGENT_DIR` override):

```json
{
  "specific_skills": [
    "~/src/vedang/agents/agents.root/specific_skills"
  ]
}
```

Merge this key into your existing settings; do not replace unrelated settings.
The extension does not edit this file or interpret `specific_packages`.
Paths may be absolute, start with `~/`, or be relative to the agent directory.
Project-level `specific_skills` is not supported. Remote/package sources are not
accepted.

## Use

```text
/load-skill
/load-skill stripe
```

The argument seeds search; it never bypasses confirmation. Choose a skill and
press Enter to load it. Escape cancels without changing model context. The picker
uses Pi's temporary custom UI, preserving the editor draft present when it opens.
Only interactive TUI mode with UI available is supported, and the agent must be
idle. RPC receives an unsupported-mode notification; without UI, Pi receives a
command error, not arbitrary stdout or a conversation message.

Loading adds one custom context message and a compact `Loaded skill: …` transcript
entry. It does **not** start a model turn. Write your next prompt to apply it.
Only the selected instructions, name, file location, and reference directory are
included. Native revalidation and a fresh body read happen at confirmation, so a
deleted or natively rejected skill is not partially loaded. Refreshed native
metadata is used if it changed. This is best-effort edit detection, not an atomic
filesystem snapshot. Native warnings remain warnings.

## Discovery and boundaries

- Settings and local catalogs are read only on invocation. Reopen to refresh.
- Only entries named exactly `SKILL.md` are shown, not standalone Markdown files.
- Pi owns parsing, frontmatter validation, ignore rules, and recursive discovery.
  This extension adds root preflight checks and canonical-path deduplication.
- Distinct same-name skills remain available, with source paths for disambiguation.
- Missing/unreadable roots and malformed skills produce UI diagnostics; other
  valid roots and skills remain usable. Native traversal can silently skip some
  unreadable descendants; root preflight does not make it a complete audit.
- **Catalog trees must be acyclic, including directory symlinks.** Cyclic trees
  are unsupported. Native traversal follows symlinks without cycle detection;
  deduplicating results does not prevent repeated traversal. No replacement
  traversal, background index, watcher, network fetching, or persistent cache is
  provided.
- Keep private catalogs outside Pi's ordinary skill-discovery locations and
  `skills` configuration if you do not want Pi itself to advertise them.

This is an invocation boundary, **not a filesystem sandbox**. An agent with file
or shell access can independently discover and read catalog files. A separate
permission policy is required to prevent that. Review skills and bundled scripts
before loading them.

## Session semantics

Loaded instructions are ordinary session history: branching, resume, and
compaction follow Pi's normal rules. A resumed session may retain earlier loaded
context, but the extension never rereads it on resume or reload. Compaction may
summarize instructions; verbatim retention is not guaranteed. A fresh session
starts without loaded selections. Repeated explicit loads add repeated messages.
There is no unload operation because it cannot reverse instructions already seen
by a model.

## Development

```sh
pnpm install
make format
make check
make test
```

The suites are deterministic and need no model credentials or network requests.
If pnpm asks about dependency build scripts, review them explicitly; this
extension does not approve scripts on your behalf. Never bypass a harness block
with a different package manager or lower-level executable.
