import {
  type ExtensionAPI,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import {
  stripTerminalSequences,
  Text,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import { readCatalog } from "./catalog.js";
import { prepareSkillMessage } from "./load-skill.js";
import { showSkillPicker } from "./picker.js";

export default function loadSkillExtension(pi: ExtensionAPI): void {
  // No settings reads, discovery, lifecycle hooks, or model-callable surface.
  pi.registerMessageRenderer<{
    skills: { name: string; filePath: string; origin: string }[];
  }>("pi-load-skill", (message, options, theme) => {
    const skills = message.details?.skills ?? [];
    const clean = (text: string) =>
      stripTerminalSequences(text).replaceAll("\r", "");
    const name = truncateToWidth(
      clean(
        `Loaded ${skills.length} skills: ${skills.map((skill) => skill.name).join(", ")}`,
      ),
      120,
    );
    const path = options.expanded
      ? skills
          .map(
            (skill) =>
              `\n${theme.fg("dim", clean(`${skill.origin}: ${skill.filePath}`))}`,
          )
          .join("")
      : "";
    return new Text(
      `${theme.fg("success", name)}${path}`,
      options.outputPad,
      0,
    );
  });
  pi.registerCommand("load-skill", {
    description:
      "Search skills and explicitly load checked instructions for the next prompt",
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui" || !ctx.hasUI) {
        const message =
          "/load-skill requires interactive TUI mode with UI available.";
        if (ctx.hasUI) {
          ctx.ui.notify(message, "error");
          return;
        }
        // Let the host report the command error; never contaminate JSON stdout
        // or create a conversation message just to report an unsupported mode.
        throw new Error(message);
      }
      if (!ctx.isIdle()) {
        ctx.ui.notify(
          "Wait for the current run to finish, then retry /load-skill.",
          "warning",
        );
        return;
      }
      try {
        const catalog = await readCatalog(getAgentDir());
        for (const diagnostic of catalog.diagnostics)
          ctx.ui.notify(diagnostic, "warning");
        if (catalog.skills.length === 0) {
          ctx.ui.notify(
            "No SKILL.md skills found. Check specific_skills directories, installed specific_packages, and native skill diagnostics, then retry /load-skill.",
            "warning",
          );
          return;
        }
        if (!ctx.isIdle()) {
          ctx.ui.notify(
            "The agent became busy during discovery. Retry /load-skill once the current run finishes.",
            "warning",
          );
          return;
        }
        const selected = await showSkillPicker(
          ctx,
          catalog.skills,
          args.trim(),
        );
        if (!selected) return;
        const prepared = prepareSkillMessage(selected);
        for (const diagnostic of prepared.diagnostics)
          ctx.ui.notify(diagnostic, "warning");
        if (!ctx.isIdle()) {
          ctx.ui.notify(
            "The agent became busy. Retry /load-skill once the current run finishes.",
            "warning",
          );
          return;
        }
        pi.sendMessage(prepared.message, { triggerTurn: false });
      } catch (error) {
        ctx.ui.notify(`Could not load skill: ${String(error)}`, "error");
      }
    },
  });
}
