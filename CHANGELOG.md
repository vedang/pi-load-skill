# Changelog

## Unreleased

### Breaking configuration change

- Consolidate all loader configuration under user-level `load_specific_skills`
  in Pi's existing `settings.json`. Remove old top-level keys without fallback;
  report guidance and isolate independent source failures.

### Managed Hermes and multi-select

- Add optional managed Hermes checkout storage with pinned first-use cloning,
  read-only reuse of clones/worktrees, bounded noninteractive Git, exclusive
  no-overwrite publication, and ownership-limited failure cleanup.
- Publish metadata-only reviews for all 193 built-in/official-optional skills at
  full revision `c419cf7c864ac0ee511dbd9f7091a8bba0b567ee`, with evidence,
  prerequisites/platforms, dependency restrictions, and complete resource hashes.
  Never bundle upstream instructions/code or expose native `pi.skills` resources.
- Group personal and Hermes rows; retain inspectable gray unavailable entries.
  Tab toggles checks, Space searches, Enter loads only checked entries, and
  hidden checks persist. Native parsing remains authoritative.
- Prepare and revalidate every selected entry before one ordered context append,
  report all failures without partial delivery, and never trigger a model turn.
- Preserve Hermes policy across personal aliases and canonical deduplication;
  reject unknown, changed, unsupported, and blocked resources at confirmation.
- Add offline clone/failure/race/timeout fixtures, resource-drift tests, and real
  Pi startup smoke against both source and unpacked published contents.
- Document checkout cancellation effects, static-review limitations, manual
  catalog updates, and the regular/fullscreen terminal acceptance checklist.

### Original loader

- Add explicit `/load-skill` selection from invocation-local private catalogs.
- Combine `specific_skills` directories with skills from already installed
  `specific_packages`, using Pi-native package resources without fetching packages
  or activating their extensions.
- Document Git installation/update and allow isolated smoke checks against an
  installed package and Pi host.
- Reuse Pi's native skill discovery and validation, restricted to `SKILL.md`.
- Append selected instructions without starting a model turn, with a compact
  transcript entry and normal session-history semantics.
- Add seeded fuzzy search, configurable selection keys, IME focus propagation,
  responsive bounded results, and paged descriptions with source paths.
- Add pnpm development scaffolding, deterministic behavior tests, and an offline
  real-Pi package-loading smoke test.
