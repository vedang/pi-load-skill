# pi-load-skill

Explicit, on-demand loading of occasional-use local skills in Pi. The extension
registers `/load-skill`, not a model-callable tool. It does not discover or
advertise your catalog at startup.

## Install

Requires Pi with the extension, skill-discovery, and TUI APIs used by this package
(developed against Pi 0.84.2), Node.js 22.19 or newer, and pnpm 12.16.1 for development.

Install the extension as a normal Pi package:

```sh
pi install git:github.com/vedang/pi-load-skill
```

Start a new Pi session, or run `/reload` in an existing session. The package
manifest exposes only the extension. To update an installed copy:

```sh
pi update git:github.com/vedang/pi-load-skill
```

For development, try this checkout without installing it:

```sh
pi -e ./src/index.ts
```

## Configure the private catalog

Merge the following section (all sources are optional) into the user-level `settings.json`
inside Pi's agent directory (normally `~/.pi/agent`; respects Pi's
`PI_CODING_AGENT_DIR` override). Do not replace unrelated settings:

```json
{
  "load_specific_skills": {
    "specific_skills": ["~/src/private-skills"],
    "specific_packages": ["~/src/another-local-package"],
    "hermes_agent_skills": "~/src/hermes-agent"
  }
}
```

**Breaking configuration change:** top-level `specific_skills` and
`specific_packages` are no longer read. Move them inside `load_specific_skills`;
obsolete keys produce diagnostics, not migration or fallback.

- `specific_skills`: local directory paths. Pi discovers skills under each root.
  Remote/package source strings are not accepted in this list.
- `specific_packages`: package-source strings. Pi locates **already installed**
  Git/npm packages or existing local package directories, then discovers only
  their native skill resources: `pi.skills` in `package.json`, or the conventional
  `skills/` directory when there is no Pi manifest. Hidden/nonstandard directories
  work when declared in the manifest. Extension-only packages add no skills.

Local paths may be absolute, start with `~/`, or be relative to the agent directory.
Either list may be omitted or empty if the other has entries. Project-level
catalog settings are not supported. The extension does not edit settings, install,
fetch, update, or repair package versions; it uses the local copy as-is. Missing
packages produce diagnostics. Make the package available separately, or point to
its existing local directory.

`/load-skill` never imports or activates extensions from `specific_packages`.
Pi's normal `packages` setting still controls startup activation independently;
listing a package there can load its extensions and advertise its skills regardless
of this loader.

## Use

```text
/load-skill
/load-skill stripe
```

The argument seeds search; it never bypasses confirmation. **Tab** toggles the
highlighted skill; **Space** remains search text. Enter loads only checked skills;
with zero checked entries it does nothing. Checks persist across filtering and
scrolling; the header reports total and hidden checks. Each invocation starts
unchecked. Escape cancels without changing model context. Search is
live and fuzzy over skill name, description, and directory name. Up/down moves
through a bounded results list; the selected source path and description appear
below it. Page Up/Page Down scroll long previews. Pi's configured selection
keybindings are respected and shown in the picker help. The picker
uses Pi's temporary custom UI, preserving the editor draft present when it opens.
Only interactive TUI mode with UI available is supported, and the agent must be
idle. RPC receives an unsupported-mode notification; without UI, Pi receives a
command error through the host (stderr in Pi 0.84.2 print/JSON modes), not arbitrary
stdout or a conversation message.

Loading adds one batch context message and a compact `Loaded N skills: …` transcript
entry. It does **not** start a model turn. Write your next prompt to apply it.
Only the checked instructions, names, file locations, and reference directories are
included. Native revalidation and a fresh body read happen at confirmation, so a
deleted or natively rejected skill is not partially loaded. Refreshed native
metadata is used if it changed. This is best-effort edit detection, not an atomic
filesystem snapshot. Native warnings remain warnings.

## Discovery and boundaries

- Settings and local catalogs are read only on invocation. Reopen to refresh.
- Only entries named exactly `SKILL.md` are shown, not standalone Markdown files.
- Pi owns parsing, frontmatter validation, ignore rules, and recursive discovery.
  Pi also owns package-source lookup and manifest/resource interpretation. This
  extension adds root preflight checks and canonical-path deduplication across both
  lists; package discovery receives only existing absolute local paths.
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
  `skills`/autoloaded `packages` configuration if you do not want Pi itself to
  advertise them. Merely listing a source in `specific_packages` does not activate it.

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

The unit suite covers catalog configuration/native discovery and picker
interaction. The integration suite drives the real command and picker against
local files, and starts a real isolated Pi process to smoke-test package loading,
absence of catalog reads/advertisement, and absence of model-callable tools.
The suites are deterministic and need no model credentials or network requests.
Catalog tests cover both settings, native installed Git/npm/local package lookup,
manifest/conventional skill roots, cross-source deduplication, missing packages,
and nonactivation of bundled extensions. The real-Pi smoke also accepts
`PI_LOAD_SKILL_TEST_PACKAGE` (an absolute package directory) and
`PI_LOAD_SKILL_TEST_CLI` (an absolute Pi CLI JavaScript entry) to check an installed
copy/host without touching active settings or conversation history.
The project explicitly denies the inspected `@google/genai` no-op preinstall
and `protobufjs` version-warning postinstall scripts in `pnpm-workspace.yaml`;
neither builds runtime artifacts needed here. If pnpm asks about new dependency
build scripts, review them explicitly; this extension does not approve scripts
on your behalf. Never bypass a harness block
with a different package manager or lower-level executable.

### Manual terminal acceptance

Run these checks in both modes, with a trusted acyclic catalog configured:

```sh
pi -e ./src/index.ts --tui-mode regular
pi -e ./src/index.ts --tui-mode fullscreen
```

- Open `/load-skill stripe`; verify even an exact match waits for confirmation.
- Search, navigate, and cancel. Confirm that no transcript message or model
  response was produced. The editor draft present when the custom UI opens must
  be restored on both cancellation and confirmation; command submission itself
  still follows Pi's normal editor behavior.
- Confirm a skill: one compact transcript entry appears, with no model response.
  Send a separate prompt to apply it.
- Check same-name skills, no matches, Unicode/IME input, long-description paging,
  terminal resizing, and narrow widths. At very short terminal heights, the
  picker reduces to input, selected name/path, and available help; enlarge it for
  the full description preview.
- Check dark/light themes and remapped selection keys. The displayed help must
  agree with the keys that actually navigate, load, cancel, and page details.
- Edit or delete a selected file while the picker is open, then confirm. A valid
  edit uses refreshed native metadata/body; deletion or native rejection adds no
  context entry. Reopen to refresh discovery.
- Verify a new session has no selected skill context. Resume retains only normal
  conversation history, without a fresh skill read.
