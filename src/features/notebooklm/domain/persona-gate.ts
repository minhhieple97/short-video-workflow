interface Waiter {
  persona: string;
  grant: () => void;
}

interface NotebookState {
  persona: string;
  active: number;
  waiting: Waiter[];
}

// A notebook holds one chat persona at a time and keeps it for every question until it is set again, so two kinds of work on
// the same notebook must not interleave: a catalogue question that ran under the draft persona would answer differently.
// Questions of the same persona run side by side; one that needs another persona waits until those in front of it are
// done, and questions that arrive behind it wait for it, so neither kind can starve the other. Notebooks do not wait on
// each other. This orders work inside one process, and the worker is the only process that asks NotebookLM.
export class PersonaGate {
  private readonly notebooks = new Map<string, NotebookState>();

  async run<T>(notebookId: string, persona: string, work: () => Promise<T>): Promise<T> {
    const release = await this.enter(notebookId, persona);
    try {
      return await work();
    } finally {
      release();
    }
  }

  private enter(notebookId: string, persona: string): Promise<() => void> {
    const state = this.notebooks.get(notebookId);
    if (!state) {
      this.notebooks.set(notebookId, { persona, active: 1, waiting: [] });
      return Promise.resolve(this.releaser(notebookId));
    }
    if (state.persona === persona && state.waiting.length === 0) {
      state.active += 1;
      return Promise.resolve(this.releaser(notebookId));
    }
    return new Promise((resolve) => {
      state.waiting.push({ persona, grant: () => resolve(this.releaser(notebookId)) });
    });
  }

  private releaser(notebookId: string): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.leave(notebookId);
    };
  }

  private leave(notebookId: string): void {
    const state = this.notebooks.get(notebookId);
    if (!state) return;
    state.active -= 1;
    if (state.active > 0) return;
    const next = state.waiting[0];
    if (!next) {
      this.notebooks.delete(notebookId);
      return;
    }
    // The waiters at the head that want the same persona go in together.
    state.persona = next.persona;
    while (state.waiting[0]?.persona === state.persona) {
      state.waiting.shift()?.grant();
      state.active += 1;
    }
  }
}
