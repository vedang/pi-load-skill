import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import {
  DefaultPackageManager,
  loadSkillsFromDir,
  SettingsManager,
  type Skill,
} from "@earendil-works/pi-coding-agent";
import { readConfig } from "./config.js";
import { HermesPolicy, readHermesMetadata } from "./hermes-catalog.js";
import { ensureHermesCheckout } from "./hermes-checkout.js";

export interface CatalogEntry extends Skill {
  identity: string;
  origin: "personal" | "hermes";
  reason?: string;
  category?: string;
  label: string;
  prerequisites: string[];
  policy?: HermesPolicy;
}

interface Catalog {
  skills: CatalogEntry[];
  diagnostics: string[];
}

/** Invocation-local only. Pi owns all skill parsing, validation, and traversal. */
export async function readCatalog(
  agentDir: string,
  progress: (message: string) => void = () => {},
): Promise<Catalog> {
  const { roots, packages, hermes, diagnostics } = readConfig(agentDir);
  const catalog: Catalog = { skills: [], diagnostics };
  const seen = new Map<string, CatalogEntry>();
  let policy: HermesPolicy | undefined;
  let hermesRoot: string | undefined;
  if (hermes) {
    try {
      const metadata = readHermesMetadata();
      hermesRoot = await ensureHermesCheckout(
        hermes,
        metadata.revision,
        progress,
      );
      policy = new HermesPolicy(hermes, metadata);
    } catch (error) {
      const reason = `Hermes source ${hermes}: ${String(error)}`;
      diagnostics.push(reason);
      policy = new HermesPolicy(hermes, undefined, reason);
    }
  }
  const discover = (
    dir: string,
    selectedFile?: string,
    hermesSource = false,
  ) => {
    try {
      if (!statSync(dir).isDirectory()) throw new Error("not a directory");
      accessSync(dir, constants.R_OK | constants.X_OK);
      // Catalog trees, including directory symlinks, must be acyclic. Native
      // traversal is intentionally not replaced with our own recursive scanner.
      const result = loadSkillsFromDir({ dir, source: "path" });
      catalog.diagnostics.push(
        ...result.diagnostics.map((item) => `${item.path}: ${item.message}`),
      );
      for (const skill of result.skills) {
        if (basename(skill.filePath) !== "SKILL.md") continue;
        if (selectedFile && resolve(skill.filePath) !== resolve(selectedFile))
          continue;
        try {
          const identity = realpathSync(skill.filePath);
          const restricted =
            policy && (hermesSource || policy.owns(skill.filePath));
          const eligibility = restricted
            ? policy?.evaluate(skill.filePath)
            : undefined;
          const entry: CatalogEntry = {
            ...skill,
            identity,
            origin: restricted ? "hermes" : "personal",
            reason: eligibility?.reason,
            category: eligibility?.review?.category,
            label: restricted
              ? `Hermes ${eligibility?.review?.origin ?? "not reviewed"}`
              : "Personal",
            prerequisites: eligibility?.review?.prerequisites ?? [],
            policy: restricted ? policy : undefined,
          };
          const previous = seen.get(identity);
          if (previous) {
            if (restricted) Object.assign(previous, entry);
            continue;
          }
          seen.set(identity, entry);
          catalog.skills.push(entry);
        } catch (error) {
          catalog.diagnostics.push(`${skill.filePath}: ${String(error)}`);
        }
      }
    } catch (error) {
      catalog.diagnostics.push(
        `Cannot read catalog root ${dir}: ${String(error)}`,
      );
    }
  };
  for (const dir of roots) discover(dir);

  if (packages.length > 0) {
    // In-memory settings exclude normal/project resources and cannot rewrite the
    // user's configuration. Remote sources are only used for installed-path
    // lookup; resource discovery receives an existing absolute local path.
    const manager = new DefaultPackageManager({
      cwd: agentDir,
      agentDir,
      settingsManager: SettingsManager.inMemory(),
    });
    for (const source of packages) {
      try {
        const installedPath = manager.getInstalledPath(source, "user");
        if (!installedPath) {
          catalog.diagnostics.push(
            `Package is not installed locally: ${source}. Make it available separately or use its local directory; /load-skill never installs packages.`,
          );
          continue;
        }
        if (!statSync(installedPath).isDirectory()) {
          catalog.diagnostics.push(
            `Package source is not a directory: ${source}. Use a package directory to discover bundled skills.`,
          );
          continue;
        }
        accessSync(installedPath, constants.R_OK | constants.X_OK);
        const resources = await manager.resolveExtensionSources(
          [resolve(installedPath)],
          { temporary: false },
        );
        // Resolving resources does not import extension entry points. Discard all
        // extension/prompt/theme resources: this command only loads skill text.
        for (const resource of resources.skills) {
          if (resource.enabled && basename(resource.path) === "SKILL.md") {
            discover(dirname(resource.path), resource.path);
          }
        }
      } catch (error) {
        catalog.diagnostics.push(
          `Cannot discover skills in package ${source}: ${String(error)}`,
        );
      }
    }
  }
  if (hermesRoot) {
    for (const tree of ["skills", "optional-skills"])
      discover(resolve(hermesRoot, tree), undefined, true);
    for (const entry of policy?.metadata?.entries ?? []) {
      if (
        !catalog.skills.some(
          (skill) =>
            skill.identity === resolve(hermesRoot, entry.path, "SKILL.md"),
        )
      ) {
        catalog.diagnostics.push(
          `Missing or natively invalid Hermes catalog resource: ${entry.path}/SKILL.md`,
        );
      }
    }
  }
  catalog.skills.sort(
    (a, b) =>
      Number(a.origin === "hermes") - Number(b.origin === "hermes") ||
      a.name.localeCompare(b.name) ||
      a.identity.localeCompare(b.identity),
  );
  return catalog;
}
