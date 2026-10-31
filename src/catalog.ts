import {
  accessSync,
  constants,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import {
  DefaultPackageManager,
  loadSkillsFromDir,
  SettingsManager,
  type Skill,
} from "@earendil-works/pi-coding-agent";

interface Catalog {
  skills: Skill[];
  diagnostics: string[];
}

/** Invocation-local only. Pi owns all skill parsing, validation, and traversal. */
export async function readCatalog(agentDir: string): Promise<Catalog> {
  const settingsPath = join(agentDir, "settings.json");
  const setup = `Add a nonempty specific_skills array of local directories or specific_packages array of installed package sources to ${settingsPath}.`;
  let settings: unknown;
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(setup);
    }
    throw new Error(
      `Cannot read settings at ${settingsPath}: ${String(error)}`,
    );
  }
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error(`Settings at ${settingsPath} must be a JSON object.`);
  }
  const readSources = (
    key: "specific_skills" | "specific_packages",
  ): string[] => {
    const value = (settings as Record<string, unknown>)[key];
    if (value === undefined) return [];
    if (
      !Array.isArray(value) ||
      value.some((entry) => typeof entry !== "string" || !entry.trim())
    ) {
      throw new Error(
        `${key} in ${settingsPath} must be an array of nonempty strings.`,
      );
    }
    return (value as string[]).map((entry) => entry.trim());
  };
  const paths = readSources("specific_skills");
  const packages = readSources("specific_packages");
  if (paths.length === 0 && packages.length === 0) throw new Error(setup);
  const roots = paths.map((entry) => {
    const path = entry.trim();
    if (
      (!isAbsolute(path) && /^[a-z][a-z\d+.-]*:/i.test(path)) ||
      (path.startsWith("~") && path !== "~" && !path.startsWith("~/"))
    ) {
      throw new Error(
        `Not a local directory path: ${path}. Use an absolute path, ~/path, or a path relative to the agent directory.`,
      );
    }
    return resolve(
      agentDir,
      path === "~"
        ? homedir()
        : path.startsWith("~/")
          ? join(homedir(), path.slice(2))
          : path,
    );
  });

  const catalog: Catalog = { skills: [], diagnostics: [] };
  const seen = new Set<string>();
  const discover = (dir: string, selectedFile?: string) => {
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
          if (seen.has(identity)) continue;
          seen.add(identity);
          catalog.skills.push(skill);
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
  return catalog;
}
