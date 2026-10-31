import { CURSOR_MARKER, visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarness } from "./support.js";

let h: ReturnType<typeof createHarness>;
beforeEach(() => { h = createHarness(); h.configure(); });
afterEach(() => { h.dispose(); });

describe("native search interaction", () => {
  it.each([
    ["strp", "stripe", "payments", "billing workflows"],
    ["rfnd", "billing", "billing", "refund handling"],
    ["unqdir", "billing", "unique-directory", "payments"],
  ])("finds fuzzy query %s across name, description, or directory", async (query, name, directory, description) => {
    h.writeSkill(directory, name, "Selected body", description);
    h.writeSkill("other", "other", "Not selected", "Unrelated");
    const { component, completion } = await h.open(query);
    expect(component.render(80).join("\n")).toContain(name);
    expect(h.sendMessage).not.toHaveBeenCalled();
    component.handleInput?.("\r");
    await completion;
    expect(h.sendMessage).toHaveBeenCalledOnce();
    expect(h.sendMessage.mock.calls[0][0].details.name).toBe(name);
  });

  it("keeps zero-result search editable, ignores Enter, and loads only after recovery and confirmation", async () => {
    h.writeSkill("stripe", "stripe");
    const { component, completion } = await h.open("zzzzzz");
    expect(component.render(80).join("\n")).toContain("No matches");
    component.handleInput?.("\r");
    expect(h.sendMessage).not.toHaveBeenCalled();
    component.handleInput?.("\x15"); // Native Input: delete to line start.
    component.handleInput?.("\x1b[200~stripe\x1b[201~");
    expect(component.render(80).join("\n")).toContain("stripe");
    expect(h.sendMessage).not.toHaveBeenCalled();
    component.handleInput?.("\r");
    await completion;
    expect(h.sendMessage).toHaveBeenCalledOnce();
  });

  it("uses injected navigation/confirmation keys and source paths to distinguish same-name skills", async () => {
    const first = h.writeSkill("a", "shared", "First body.");
    const second = h.writeSkill("b", "shared", "Second body.");
    h.keybindings.setUserBindings({ "tui.select.down": "ctrl+j", "tui.select.confirm": "ctrl+l", "tui.select.cancel": "ctrl+q" });
    const { component, completion } = await h.open("shared");
    expect(component.render(80).join("\n")).toContain(first);
    component.handleInput?.("\n"); // ctrl+j, deliberately different from global down.
    const rendered = component.render(80).join("\n");
    expect(rendered).toContain(second);
    expect(rendered).toContain("ctrl+l");
    component.handleInput?.("\x0c");
    await completion;
    expect(h.sendMessage.mock.calls[0][0].content).toContain("Second body.");
    expect(h.sendMessage.mock.calls[0][0].content).not.toContain("First body.");
  });

  it("keeps Unicode output within resized dimensions, exposes the full preview by paging, and propagates focus", async () => {
    h.writeSkill("unicode", "unicode", "Body", `${"日本語 é 👩🏽‍💻 instructions ".repeat(25)}END-OF-DESCRIPTION`);
    for (let index = 0; index < 12; index++) h.writeSkill(`other-${index}`, `other-${index}`);
    const { component, completion } = await h.open("unicode");
    expect(component.render(40).join("\n")).toContain(CURSOR_MARKER);
    component.focused = false;
    expect(component.render(40).join("\n")).not.toContain(CURSOR_MARKER);
    component.focused = true;
    for (const [width, rows] of [[80, 30], [24, 20], [8, 15], [1, 10], [40, 25]]) {
      h.terminal.rows = rows;
      component.invalidate();
      const lines = component.render(width);
      expect(lines.length).toBeLessThanOrEqual(Math.max(1, Math.min(24, rows - 5)));
      expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
    }
    h.terminal.rows = 25;
    let foundTail = false;
    for (let page = 0; page < 100; page++) {
      if (component.render(40).join("\n")).includes("END-OF-DESCRIPTION")) { foundTail = true; break; }
      component.handleInput?.("\x1b[6~");
    }
    expect(foundTail).toBe(true);
    component.handleInput?.("\x1b");
    await completion;
    expect(h.sendMessage).not.toHaveBeenCalled();
  });

  it("scrolls the bounded native results list without loading on navigation", async () => {
    for (let index = 0; index < 20; index++) h.writeSkill(`skill-${index.toString().padStart(2, "0")}`, `skill-${index.toString().padStart(2, "0")}`);
    const { component, completion } = await h.open();
    for (let index = 0; index < 19; index++) component.handleInput?.("\x1b[B");
    const rendered = component.render(80).join("\n");
    expect(rendered).toContain("skill-19");
    expect(rendered).not.toContain("skill-00");
    expect(h.sendMessage).not.toHaveBeenCalled();
    component.handleInput?.("\x1b");
    await completion;
  });
});
