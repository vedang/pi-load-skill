import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

function localPath(value: string, agentDir: string): string {
  const path = value.trim();
  if (
    !path ||
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
}

export function readConfig(agentDir: string) {
  const path = join(agentDir, "settings.json");
  const setup = `Add load_specific_skills with specific_skills, specific_packages, or hermes_agent_skills to ${path}.`;
  let settings: unknown;
  try {
    settings = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new Error(setup);
    throw new Error(`Cannot read settings at ${path}: ${String(error)}`);
  }
  if (!settings || typeof settings !== "object" || Array.isArray(settings))
    throw new Error(`Settings at ${path} must be a JSON object.`);
  const document = settings as Record<string, unknown>;
  const diagnostics: string[] = [];
  for (const key of ["specific_skills", "specific_packages"]) {
    if (key in document)
      diagnostics.push(
        `Obsolete top-level ${key} in ${path}: move it into load_specific_skills.${key}; the old key is not used.`,
      );
  }
  const section = document.load_specific_skills;
  if (
    section !== undefined &&
    (!section || typeof section !== "object" || Array.isArray(section))
  )
    throw new Error(`load_specific_skills in ${path} must be an object.`);
  const config = (section ?? {}) as Record<string, unknown>;
  const sources = (key: string, normalize: boolean): string[] => {
    const value = config[key];
    if (value === undefined) return [];
    if (
      !Array.isArray(value) ||
      value.some((entry) => typeof entry !== "string" || !entry.trim())
    ) {
      diagnostics.push(
        `load_specific_skills.${key} in ${path} must be an array of nonempty strings.`,
      );
      return [];
    }
    return value.flatMap((entry: string) => {
      try {
        return [normalize ? localPath(entry, agentDir) : entry.trim()];
      } catch (error) {
        diagnostics.push(`${key}: ${String(error)}`);
        return [];
      }
    });
  };
  const roots = sources("specific_skills", true);
  const packages = sources("specific_packages", false);
  let hermes: string | undefined;
  if (config.hermes_agent_skills !== undefined) {
    try {
      if (typeof config.hermes_agent_skills !== "string")
        throw new Error("must be a nonempty local directory path");
      hermes = localPath(config.hermes_agent_skills, agentDir);
    } catch (error) {
      diagnostics.push(
        `load_specific_skills.hermes_agent_skills in ${path}: ${String(error)}`,
      );
    }
  }
  if (!roots.length && !packages.length && !hermes) {
    if (!diagnostics.length) throw new Error(setup);
    diagnostics.push(setup);
  }
  return { roots, packages, hermes, diagnostics };
}
