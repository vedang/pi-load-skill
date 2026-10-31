import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readHermesMetadata } from "../src/hermes-catalog.js";
import { hermesFixture } from "./hermes-support.js";
import { createHarness } from "./support.js";

vi.mock("../src/hermes-catalog.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/hermes-catalog.js")>()),
  readHermesMetadata: vi.fn(),
}));
let h: ReturnType<typeof createHarness>;
beforeEach(() => {
  h = createHarness();
});
afterEach(() => {
  h.dispose();
  vi.resetAllMocks();
});

it("uses the physical reviewed resource directory when a personal file alias is the only native discovery route", async () => {
  const root = join(h.agentDir, "hermes");
  const fixture = hermesFixture(root);
  const path = fixture.add("eligible");
  writeFileSync(join(root, "skills/.gitignore"), "examples/\n");
  const alias = join(h.agentDir, "catalog/alias");
  mkdirSync(alias, { recursive: true });
  symlinkSync(path, join(alias, "SKILL.md"));
  vi.mocked(readHermesMetadata).mockReturnValue(fixture.metadata);
  h.configure({ specific_skills: ["catalog"], hermes_agent_skills: root });
  const { component, completion } = await h.open();
  component.handleInput?.("\t");
  component.handleInput?.("\r");
  await completion;
  expect(h.sendMessage).toHaveBeenCalledOnce();
  expect(h.sendMessage.mock.calls[0][0].content).toContain(
    `References are relative to ${realpathSync(dirname(path))}.`,
  );
});

it.each([false, true])(
  "inspects disabled rows, preserves section order while filtering, and rejects changed batch resources (%s)",
  async (changed) => {
    const root = join(h.agentDir, "hermes");
    const f = hermesFixture(root);
    f.add("blocked", {
      decision: "blocked",
      reason: "Requires Hermes-only tool",
    });
    const eligible = f.add("eligible");
    vi.mocked(readHermesMetadata).mockReturnValue(f.metadata);
    h.configure({ specific_skills: ["catalog"], hermes_agent_skills: root });
    h.writeSkill("z-personal", "z-personal");
    const { component, completion } = await h.open();
    let rendered = component.render(200).join("\n");
    expect(rendered.indexOf("Personal skills")).toBeLessThan(
      rendered.indexOf("Hermes skills"),
    );
    component.handleInput?.("\t");
    component.handleInput?.("\x1b[B"); // headings are not focusable
    component.handleInput?.("\t"); // disabled row cannot become checked
    rendered = component.render(200).join("\n");
    expect(rendered).toContain("Requires Hermes-only tool");
    expect(rendered).toContain("1 checked");
    component.handleInput?.("\x1b[B");
    component.handleInput?.("\t");
    component.handleInput?.("eligible");
    expect(component.render(200).join("\n")).toContain("2 checked (1 hidden)");
    if (changed)
      writeFileSync(
        join(dirname(eligible), "helper.py"),
        "# drift after checking\n",
      );
    component.handleInput?.("\r");
    await completion;
    if (changed) {
      expect(h.sendMessage).not.toHaveBeenCalled();
      expect(h.notify).toHaveBeenCalledWith(
        expect.stringContaining("Changed since portability review"),
        "error",
      );
    } else {
      expect(h.sendMessage).toHaveBeenCalledOnce();
      const [message, options] = h.sendMessage.mock.calls[0];
      expect(
        message.details.skills.map((entry: { name: string }) => entry.name),
      ).toEqual(["z-personal", "eligible"]);
      expect(message.content).not.toContain("Instructions blocked");
      expect(options).toEqual({ triggerTurn: false });
    }
  },
);
