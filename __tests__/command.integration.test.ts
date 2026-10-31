import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHarness } from "./support.js";

let h: ReturnType<typeof createHarness>;
beforeEach(() => {
  h = createHarness();
});
afterEach(() => {
  h.dispose();
});

describe("manual command boundary", () => {
  it("registers without reading missing settings, exposing a tool, or sending context", () => {
    expect(h.registerCommand).toHaveBeenCalledOnce();
    expect(h.registerMessageRenderer).toHaveBeenCalledOnce();
    expect(h.sendMessage).not.toHaveBeenCalled();
    expect(h.sendUserMessage).not.toHaveBeenCalled();
    expect(h.ui.custom).not.toHaveBeenCalled();
    expect(h.notify).not.toHaveBeenCalled();
  });

  it.each(["rpc", "print", "json"] as const)(
    "rejects %s before settings discovery",
    async (mode) => {
      h.ctx.mode = mode;
      h.ctx.hasUI = mode === "rpc";
      if (h.ctx.hasUI) {
        await h.run();
        expect(h.notify).toHaveBeenCalledWith(
          expect.stringContaining("requires interactive TUI"),
          "error",
        );
      } else {
        await expect(h.run()).rejects.toThrow(/requires interactive TUI/);
      }
      expect(h.ui.custom).not.toHaveBeenCalled();
      expect(h.sendMessage).not.toHaveBeenCalled();
    },
  );

  it("rejects a busy run before reading even missing settings", async () => {
    vi.mocked(h.ctx.isIdle).mockReturnValue(false);
    await h.run();
    expect(h.notify).toHaveBeenCalledWith(
      expect.stringContaining("current run"),
      "warning",
    );
    expect(h.ui.custom).not.toHaveBeenCalled();
    expect(h.sendMessage).not.toHaveBeenCalled();
  });

  it.each([{}, { specific_skills: 42 }])(
    "reports configuration problems without opening UI or changing context: %j",
    async (config) => {
      h.configure(config);
      await h.run();
      expect(h.notify).toHaveBeenCalledWith(
        expect.stringContaining("specific_skills"),
        "error",
      );
      expect(h.ui.custom).not.toHaveBeenCalled();
      expect(h.sendMessage).not.toHaveBeenCalled();
    },
  );

  it("requires confirmation for an exact query and leaves cancellation context-neutral", async () => {
    h.configure();
    h.writeSkill("stripe", "stripe");
    const { component, completion } = await h.open("stripe");
    component.render(80);
    expect(h.sendMessage).not.toHaveBeenCalled();
    component.handleInput?.("\x1b");
    await completion;
    expect(h.sendMessage).not.toHaveBeenCalled();
    expect(h.sendUserMessage).not.toHaveBeenCalled();
    expect(h.setEditorText).not.toHaveBeenCalled();
  });

  it.each(["specific_skills", "specific_packages"])(
    "revalidates and rereads only the confirmed %s instruction block without triggering a response",
    async (key) => {
      h.configure({ [key]: ["catalog"] });
      const path = h.writeSkill("stripe", "stripe", "Old body.");
      h.writeSkill("other", "other", "SECRET UNSELECTED BODY");
      if (key === "specific_packages") {
        writeFileSync(
          join(h.agentDir, "catalog/package.json"),
          JSON.stringify({ pi: { skills: ["./stripe", "./other"] } }),
        );
      }
      const { component, completion } = await h.open("stripe");
      writeFileSync(
        path,
        "---\nname: stripe-updated\ndescription: Updated metadata\n---\nUse references/guide.md and scripts/run.sh.",
      );
      component.handleInput?.("\r");
      await completion;
      expect(h.sendMessage).toHaveBeenCalledExactlyOnceWith(
        {
          customType: "pi-load-skill",
          content: `<skill name="stripe-updated" location="${path}">\nReferences are relative to ${path.slice(0, -"/SKILL.md".length)}.\n\nUse references/guide.md and scripts/run.sh.\n</skill>`,
          display: true,
          details: { name: "stripe-updated", filePath: path },
        },
        { triggerTurn: false },
      );
      expect(h.renderMessage()).toContain("Loaded skill: stripe-updated");
      expect(h.renderMessage()).not.toContain("Use references");
      expect(h.sendUserMessage).not.toHaveBeenCalled();
      expect(h.setEditorText).not.toHaveBeenCalled();
    },
  );

  it.each(["deleted", "missing-description", "malformed-yaml"])(
    "does not append a partial message after selected file becomes %s",
    async (failure) => {
      h.configure();
      const path = h.writeSkill("stripe", "stripe");
      const { component, completion } = await h.open("stripe");
      if (failure === "deleted") rmSync(path);
      else if (failure === "missing-description")
        writeFileSync(path, "---\nname: stripe\n---\nMust not load.");
      else writeFileSync(path, "---\nname: [broken\n---\nMust not load.");
      component.handleInput?.("\r");
      await completion;
      expect(h.sendMessage).not.toHaveBeenCalled();
      expect(h.notify).toHaveBeenCalledWith(
        expect.stringContaining("Could not load skill"),
        "error",
      );
    },
  );

  it("does not open the picker when the agent becomes busy during asynchronous discovery", async () => {
    h.configure();
    h.writeSkill("stripe", "stripe");
    vi.mocked(h.ctx.isIdle).mockReturnValueOnce(true).mockReturnValue(false);
    await h.run();
    expect(h.ui.custom).not.toHaveBeenCalled();
    expect(h.sendMessage).not.toHaveBeenCalled();
    expect(h.notify).toHaveBeenCalledWith(
      expect.stringContaining("busy during discovery"),
      "warning",
    );
  });

  it("rechecks idle after the picker interaction", async () => {
    h.configure();
    h.writeSkill("stripe", "stripe");
    const { component, completion } = await h.open("stripe");
    vi.mocked(h.ctx.isIdle).mockReturnValue(false);
    component.handleInput?.("\r");
    await completion;
    expect(h.sendMessage).not.toHaveBeenCalled();
    expect(h.notify).toHaveBeenCalledWith(
      expect.stringContaining("became busy"),
      "warning",
    );
  });
});
