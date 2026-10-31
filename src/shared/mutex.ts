// Lets callers in this process run one at a time, in the order they asked. It orders work inside one process only: the
// worker is alone on its Redis database, so a lock here is enough for anything only the worker does.
export class Mutex {
  private tail: Promise<void> = Promise.resolve();

  acquire(): Promise<() => void> {
    const previous = this.tail;
    let resolveTurn: () => void = () => undefined;
    const turnDone = new Promise<void>((resolve) => {
      resolveTurn = resolve;
    });
    this.tail = previous.then(() => turnDone);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      resolveTurn();
    };
    return previous.then(() => release);
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await work();
    } finally {
      release();
    }
  }
}

// One mutex per key, dropped once nobody holds or waits for it.
export class KeyedMutex {
  private readonly entries = new Map<string, { mutex: Mutex; users: number }>();

  async run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const entry = this.entries.get(key) ?? { mutex: new Mutex(), users: 0 };
    entry.users += 1;
    this.entries.set(key, entry);
    try {
      return await entry.mutex.run(work);
    } finally {
      entry.users -= 1;
      if (entry.users === 0) this.entries.delete(key);
    }
  }
}
