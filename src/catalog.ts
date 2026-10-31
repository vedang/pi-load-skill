import {
  accessSync,
  constants,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { loadSkillsFromDir, type Skill } from "@earendil-works/pi-coding-agent";

interface Catalog {
  skills: Skill[];
  diagnostics: string[];
}

/** Invocation-local only. Pi owns all skill parsing, validation, and traversal. */
export function readCatalog(agentDir: string): Catalog {
  const settingsPath = join(agentDir, "settings.json");
  const setup = `Add a nonempty specific_skills array of local directory paths to ${settingsPath}.`;
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
  const paths = (settings as Record<string, unknown>).specific_skills;
  if (paths === undefined || (Array.isArray(paths) && paths.length === 0)) {
    throw new Error(setup);
  }
  if (
    !Array.isArray(paths) ||
    paths.some((path) => typeof path !== "string" || !path.trim())
  ) {
    throw new Error(
      `specific_skills in ${settingsPath} must be an array of nonempty local directory paths.`,
    );
  }
  const roots = (paths as string[]).map((entry) => {
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
  for (const dir of roots) {
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
  }
  return catalog;
}
