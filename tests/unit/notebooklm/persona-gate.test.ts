import { describe, expect, it } from "vitest";

import { PersonaGate } from "@/features/notebooklm/domain/persona-gate";

// A piece of work the test finishes by hand, noting when it starts and ends.
function work(log: string[], name: string) {
  let finish: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return {
    start: async () => {
      log.push(`start ${name}`);
      await done;
      log.push(`end ${name}`);
      return name;
    },
    finish,
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

describe("PersonaGate", () => {
  it("lets questions of the same persona run together", async () => {
    const gate = new PersonaGate();
    const log: string[] = [];
    const a = work(log, "a");
    const b = work(log, "b");

    const runs = [gate.run("n1", "analysis", a.start), gate.run("n1", "analysis", b.start)];
    await tick();

    expect(log).toEqual(["start a", "start b"]);
    a.finish();
    b.finish();
    expect(await Promise.all(runs)).toEqual(["a", "b"]);
  });

  it("holds a question of another persona until the running ones end", async () => {
    const gate = new PersonaGate();
    const log: string[] = [];
    const catalogue = work(log, "catalogue");
    const draft = work(log, "draft");

    const first = gate.run("n1", "analysis", catalogue.start);
    const second = gate.run("n1", "draft", draft.start);
    await tick();
    expect(log).toEqual(["start catalogue"]);

    catalogue.finish();
    await first;
    await tick();
    expect(log).toEqual(["start catalogue", "end catalogue", "start draft"]);
    draft.finish();
    await second;
  });

  it("does not let a stream of one persona starve a waiting one", async () => {
    const gate = new PersonaGate();
    const log: string[] = [];
    const a1 = work(log, "analysis-1");
    const d1 = work(log, "draft-1");
    const a2 = work(log, "analysis-2");

    const runs = [
      gate.run("n1", "analysis", a1.start),
      gate.run("n1", "draft", d1.start),
      // Same persona as the one running, but a draft is already waiting: it queues behind it.
      gate.run("n1", "analysis", a2.start),
    ];
    await tick();
    expect(log).toEqual(["start analysis-1"]);

    a1.finish();
    await tick();
    expect(log).toEqual(["start analysis-1", "end analysis-1", "start draft-1"]);
    d1.finish();
    await tick();
    expect(log.at(-1)).toBe("start analysis-2");
    a2.finish();
    await Promise.all(runs);
  });

  it("does not make one notebook wait for another", async () => {
    const gate = new PersonaGate();
    const log: string[] = [];
    const a = work(log, "a");
    const b = work(log, "b");

    const runs = [gate.run("n1", "analysis", a.start), gate.run("n2", "draft", b.start)];
    await tick();

    expect(log).toEqual(["start a", "start b"]);
    a.finish();
    b.finish();
    await Promise.all(runs);
  });

  it("lets the next persona in when the work fails", async () => {
    const gate = new PersonaGate();
    const failing = gate.run("n1", "analysis", async () => {
      throw new Error("refused");
    });
    const after = gate.run("n1", "draft", async () => "drafted");

    await expect(failing).rejects.toThrow("refused");
    expect(await after).toBe("drafted");
  });

  it("starts the waiters of one persona together once it is their turn", async () => {
    const gate = new PersonaGate();
    const log: string[] = [];
    const first = work(log, "analysis");
    const d1 = work(log, "draft-1");
    const d2 = work(log, "draft-2");

    const runs = [
      gate.run("n1", "analysis", first.start),
      gate.run("n1", "draft", d1.start),
      gate.run("n1", "draft", d2.start),
    ];
    await tick();
    first.finish();
    await tick();

    expect(log).toEqual(["start analysis", "end analysis", "start draft-1", "start draft-2"]);
    d1.finish();
    d2.finish();
    await Promise.all(runs);
  });
});
