# pi-load-skill

Explicit, on-demand loading of private local and reviewed Hermes skills in Pi.
`/load-skill` is a user command, **not** a model-callable tool. Startup only
registers the command and transcript renderer: no catalog/settings discovery,
checkout access, cloning, network activity, or skill advertisement.

## Install

Requires Node.js 22.19+ and Pi's extension, native skill-discovery, and custom TUI
APIs (developed against Pi 0.84.2). Development uses pnpm 12.16.1.

```sh
pi install git:github.com/vedang/pi-load-skill
# Start a new session or use /reload.
pi update git:github.com/vedang/pi-load-skill
# Try this checkout without installing it:
pi -e ./src/index.ts
```

The package exposes only the extension. It publishes a metadata catalog, **not**
Hermes instructions, scripts, assets, Python code, or native `pi.skills` entries.

## Configure

Merge this section into **user-level** `<getAgentDir()>/settings.json` (normally
`~/.pi/agent/settings.json`, honoring `PI_CODING_AGENT_DIR`). Do not replace
unrelated settings. The extension never edits settings or reads project-level
extension configuration.

```json
{
  "load_specific_skills": {
    "specific_skills": ["~/src/private-skills"],
    "specific_packages": ["~/src/private-skill-package"],
    "hermes_agent_skills": "~/src/hermes-agent"
  }
}
```

Every source is optional. Personal-only and Hermes-only configurations work.
Omit `hermes_agent_skills` to disable the integration. With no configured sources,
the command displays setup guidance.

**Breaking change:** top-level `specific_skills` and `specific_packages` are no
longer supported. Move them into `load_specific_skills`. Obsolete keys produce
actionable diagnostics; there is no fallback or automatic migration.

- `specific_skills`: array of nonempty local directory paths. Pi discovers
  `SKILL.md` entries beneath each root; URLs/package specifications are rejected.
- `specific_packages`: array of nonempty package-source strings. Existing local
  directories, installed `git:github.com/org/package@ref`, and installed
  `npm:@scope/package@version` sources work. Pi discovers declared `pi.skills`
  resources, or conventional `skills/` when there is no Pi manifest. Hidden
  roots work when declared; extension-only packages add no skills. This list
  **never installs, fetches, updates, imports, or activates packages/extensions**.
- `hermes_agent_skills`: one nonempty **local directory path**, not a URL, array,
  or boolean. This is the only source that can clone a missing repository.

Local paths may be absolute, use `~/`, or be relative to the agent directory.
Malformed JSON or a malformed settings/section object is an error. Independent
source failures produce precise warnings without discarding healthy sources.
Reopen the command to refresh settings and discovery.

Pi's normal `packages` and `skills` settings remain independent. Keep private
catalogs outside ordinary Pi discovery locations if you do not want Pi itself to
advertise them. Listing a package here does not change its normal activation.

## Select and load

```text
/load-skill
/load-skill stripe
```

The argument seeds fuzzy search; even an exact match waits for explicit checks
and confirmation.

| Key | Action |
| --- | --- |
| Up / Down | Highlight a row, including unavailable rows |
| **Tab** | Toggle an eligible highlighted row |
| **Space** | Insert searchable text, not a selection toggle |
| Enter | Load **only checked** entries; zero checks is a no-op |
| Escape | Discard pending checks without adding context |
| Page Up / Page Down | Page through the full preview and prerequisites |

Navigation, confirmation, cancellation, and preview paging use Pi's injected
selection keybindings; the help shows remapped keys. Tab is the new explicit
selection toggle. Each invocation starts unchecked.

Personal skills appear first, Hermes second. Section headings are not focusable.
Hermes rows show built-in/official-optional origin and category. Gray unavailable
rows remain focusable: the preview gives their textual reason, and Tab cannot
check them. Color is never the only indication of eligibility.

Checks persist while filtering and scrolling. The header shows the total checked
count and how many are hidden by the current query. Distinct same-name files
remain available; canonical file identities deduplicate overlapping roots and
symlinks. Batch order follows section/display order, not toggle order.

Confirmation freshly validates native metadata, rereads each body, and rechecks
Hermes containment, decision, platform, dependencies, and complete resource hash.
If any checked entry fails, **nothing is loaded**; diagnostics identify affected
entries. Reopen the command to refresh. This is all-or-nothing preparation, not
an atomic filesystem snapshot against concurrent writes.

One custom context message contains all prepared instruction blocks. A bounded
`Loaded N skills: …` summary appears in the transcript; expanded details show
each origin and path. The extension sends with `triggerTurn: false`: **no model
response, execution, or dependency installation starts automatically**. Write
your next prompt to apply the instructions. Referenced skills are not autoloaded.

The agent must remain idle. Only interactive TUI mode with UI is supported. RPC
gets an unsupported-mode notification; print/JSON mode receives a host command
error rather than arbitrary stdout or a context message. Temporary custom UI
preserves the editor draft present when it opens, focus/IME propagation, regular
and fullscreen modes, Unicode column widths, resizing, and bounded layout.

## Managed Hermes checkout

Upstream is fixed to `https://github.com/NousResearch/hermes-agent.git`.

- **Existing checkout:** verify that the configured location is the actual Git
  root and contains `skills/` and `optional-skills/`. Ordinary clones and Git
  worktrees (`.git` files) are supported. No exact origin URL is required because
  reviewed resource identity is independently checked. Never pull, reset, clean,
  switch revision, install dependencies, or repair an existing tree.
- **Missing location:** on explicit invocation, clone into an owned temporary
  sibling, check out the exact catalog revision, validate it, then publish using
  exclusive destination creation. Neither a preexisting file/partial directory
  nor a concurrently created destination is replaced. Publication is not an
  atomic snapshot; another invocation may briefly see an incomplete publication
  and report a diagnostic. Failure cleanup removes only owned resources, not
  unrelated concurrent additions.
- Git uses argument-vector subprocesses, ignored stdin, noninteractive auth,
  isolated Git configuration (no configured credential helpers/hooks/filters),
  and a 120-second shared Git deadline. Progress and errors are notified. Proxy
  and TLS environment settings remain available. Authentication-requiring
  custom remotes are not supported: the remote is the public official URL.
- No submodule recursion, repository-code imports, dependency execution,
  credential probing, or Hermes profile configuration is performed. Missing Git,
  offline access, permissions, timeouts, and invalid destinations are isolated
  Hermes-source diagnostics; healthy personal skills remain usable.

**The first invocation may access the network and write checkout files even if
you subsequently cancel selection.** Cancellation is conversation-context-neutral,
not a filesystem transaction. Updates and checkout maintenance remain manual.
New clones use the audited revision; existing checkouts are never switched.

## Portability catalog and boundaries

`resources/hermes-catalog.json` contains schema/version metadata, full upstream
revision, review date, paths, names/descriptions, origins/categories, concrete
decisions/evidence, OS scope, standalone prerequisites, and deterministic full
resource-tree hashes. The initial revision is
`c419cf7c864ac0ee511dbd9f7091a8bba0b567ee`: **44 built-in + 149 official optional
skills**, excluding plugin-local skills. Initial decisions: **104 portable,
89 blocked**. Supported OS and native Pi validity can further reduce selectable
rows on any particular host. All bundled resource files have static-read review
coverage, including tests; upstream code was not executed as part of that review.

Eligibility requires **portable decision + identical reviewed resources +
supported OS + native Pi validity**. Blocked entries show their reason; new paths
show `Not reviewed`; changed resources show `Changed since portability review`;
unsupported systems show their platform reason. Missing or natively rejected
resources produce diagnostics, never loadable ghost rows. Ordinary native
warnings remain warnings; Pi owns parsing, validation, ignore rules, and traversal.

The fingerprint covers sorted relative paths, byte lengths, and exact bytes of
**every file**, including scripts, references, templates, assets, and tests—not
just `SKILL.md`. Schema 1 rejects symlinks and special file types inside reviewed
resource trees. No such resource symlinks occur in the initial baseline.

Required Hermes runtime/modules, dedicated capabilities, preprocessing,
provisioning, hard-coded installation paths, and unresolved required external
resources are blocked. Generic file/terminal/image-inspection vocabulary can map
to Pi's actual capabilities; standalone CLI/library prerequisites are recorded,
not installed or credential-probed. Image workflows require an image-capable
model. Office document helpers are reviewed for macOS/Linux only: their Windows
setup and recalculation paths retain unsupported Hermes/POSIX assumptions.
Optional integrations and explicit standalone fallbacks are distinguished from
mandatory execution paths. Required blocked/unavailable skill dependencies block
the caller. The metadata records review limitations and known content caveats.

The same Hermes policy applies when a file is reached through a personal source
or symlink into the configured checkout; canonical deduplication cannot restore
eligibility. This is an **integration policy, not a filesystem security sandbox**.
Users/agents can independently read or copy files. Static portability review is
not a security audit or a guarantee of correct examples, working APIs, installed
prerequisites, credentials, transitive environment support, or successful execution.

Catalog trees must remain **acyclic, including directory symlinks**. Pi's native
personal traversal does not detect cycles; result deduplication is not traversal
cycle protection. There is no watcher, background index, persistent cache,
scheduled review, runtime classifier, or automatic upstream/catalog update.

## Session semantics

Loaded instructions are ordinary session history. Branching, resume, and
compaction follow Pi's rules; compaction may summarize them. Resume/reload does
not reread files. New sessions start without loaded context. Explicit repeated
loads append repeated messages. There is no unload operation.

## Development and manual catalog maintenance

```sh
pnpm install
make format
make check
make test

# Offline metadata inventory and complete resource fingerprints:
node scripts/hermes-catalog.mjs inventory /path/to/hermes-checkout
# Compare actual resources with the bundled review (nonzero on drift):
node scripts/hermes-catalog.mjs verify /path/to/hermes-checkout
# After manual review, generate from one review entry per inventory skill:
node scripts/hermes-catalog.mjs generate /path/to/hermes-checkout /tmp/review.json resources/hermes-catalog.json
```

`review.json` is an array of metadata objects containing `path`, `decision`,
`reason`, `evidence`, `platforms`, `prerequisites`, `dependencies`, `reviewedFiles`,
and `limitations` (optional `reviewCoverage` records bounded read ranges).
Generation requires complete body-review evidence for every inventory path;
it computes hashes itself, never infers portability. Use the existing catalog's
entries as a review starting point, not as proof for changed content.

For a manual update: inspect checkout revision and local changes; read complete
bodies and all relevant scripts/references/templates/assets; trace imports,
subprocesses, required tools, paths, linked skills, and external resources;
reconcile required dependencies and platform scope; block unresolved closure;
record exact evidence and limitations. Commit reviewed upstream changes before
publishing a revision meant for fresh clones. Generate, verify, review the diff,
and run all gates. Do not replace this review with regex hits. No Hermes code
should enter this repository or `pi.skills`.

Tests use temporary local Git repositories and controlled subprocess failures,
not live GitHub. They cover discovery/policy, alias restrictions, checked-state
interaction, all-or-nothing delivery, pinned clone/reuse/worktrees, timeout/race
cleanup, and source/unpacked-package startup in real offline Pi. No active user
settings are edited. The host smoke accepts `PI_LOAD_SKILL_TEST_PACKAGE` and
`PI_LOAD_SKILL_TEST_CLI` overrides for isolated installed-host checks.

The inspected `@google/genai` no-op preinstall and `protobufjs` version-warning
postinstall remain denied in `pnpm-workspace.yaml`. Review new dependency scripts;
never bypass a harness block with another package manager or executable.

### Manual terminal acceptance

Run both:

```sh
pi -e ./src/index.ts --tui-mode regular
pi -e ./src/index.ts --tui-mode fullscreen
```

- Check two personal entries, filter one away, check an eligible Hermes entry,
  and confirm: one ordered batch, no automatic model turn, bounded summary and
  expanded origins/paths. Verify hidden counts, same-name files, and fresh checks
  on reopening. Enter without checks must do nothing; Escape discards checks.
- Confirm Tab toggles and Space searches; remap selection keys and compare help
  with behavior. Navigate across headings and gray rows; inspect reasons and
  prerequisites. Disabled Tab must not check a row.
- Verify editor restoration on cancel/confirm; Unicode/IME, long preview paging,
  dark/light themes, narrow/short terminals, resize, scrolling, and zero matches.
  Very short terminals prioritize input and compact status; enlarge for details.
- Edit/delete a checked personal file, or change a Hermes supporting script
  while open: any invalid member aborts the entire batch. Check busy guards.
- With temporary configured checkout storage, verify first-use progress and
  cancellation's filesystem caveat, reuse without network, dirty/worktree
  preservation, unrelated destinations left untouched, and personal-source
  usability after a Git/network failure. Never use active user settings for this.
- Verify new-session/resume semantics and no startup skill advertisement.

Automated host smoke is not a substitute for these human terminal checks or a
live first-use GitHub clone; disclose checks not actually performed.
