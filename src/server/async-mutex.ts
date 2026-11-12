/**
 * A-07: Keyed Asynchronous Mutex for Serialized Read-Modify-Write Operations.
 * Prevents interleaved async `await` handlers from losing concurrent state updates
 * while allowing independent domains (e.g. 'approvals' vs 'swarm' vs 'memories') to proceed in parallel.
 */
export class KeyedAsyncMutex {
  private readonly queues = new Map<string, Promise<void>>();

  public async withLock<T>(key: string, task: () => Promise<T> | T): Promise<T> {
    const normalizedKey = key || 'global';
    const previous = this.queues.get(normalizedKey) ?? Promise.resolve();

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const tail = previous.then(() => gate);
    this.queues.set(normalizedKey, tail);

    await previous;
    try {
      return await task();
    } finally {
      release();
      if (this.queues.get(normalizedKey) === tail) {
        this.queues.delete(normalizedKey);
      }
    }
  }

  public activeKeyCount(): number {
    return this.queues.size;
  }
}

export const domainMutex = new KeyedAsyncMutex();
