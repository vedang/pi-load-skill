# Changelog

## Unreleased

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
