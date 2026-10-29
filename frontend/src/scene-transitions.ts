type Apply = () => Promise<void>;
export type RestoreCommit = (
  revision: number | undefined,
  apply: Apply,
) => Promise<void>;
interface Receipt {
  started: boolean;
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
}

/** One UI transition queue, distinct from the engine's command serialization.
 * A snapshot being read does not mean its scene has been applied to the UI.
 * Engine revisions are monotonic across document opens in this engine session.
 */
export class SceneTransitions {
  private tail: Promise<unknown> = Promise.resolve();
  private receipts = new Map<number, Receipt>();
  private appliedRevision = -1;
  private generation = 0;

  enqueue<T>(work: () => Promise<T>): Promise<T> {
    this.generation++;
    const result = this.tail.catch(() => {}).then(work);
    this.tail = result;
    // Retain rejection for the caller, without poisoning later transitions or
    // creating an unhandled rejection when an event has no direct waiter.
    void result.catch(() => {});
    return result;
  }

  /** Register before issuing the command, so mode clicks wait for its UI apply.
   * commit runs inside this queue turn. It can claim a queued echoed receipt;
   * awaiting that receipt's later queue turn here would deadlock.
   */
  command<T>(work: (commit: RestoreCommit) => Promise<T>): Promise<T> {
    return this.enqueue(() =>
      work((revision, apply) => this.apply(revision, apply)),
    );
  }

  hasApplied(revision: number): boolean {
    return revision <= this.appliedRevision;
  }

  restore(revision: number | undefined, apply: Apply): Promise<void> {
    if (revision === undefined) return this.enqueue(apply);
    if (this.hasApplied(revision)) return Promise.resolve();
    const previous = this.receipts.get(revision);
    if (previous) return previous.promise;
    const receipt = this.receipt(revision);
    void this.enqueue(() => this.apply(revision, apply));
    return receipt.promise;
  }

  private receipt(revision: number): Receipt {
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    void promise.catch(() => {});
    const receipt = { started: false, promise, resolve, reject };
    this.receipts.set(revision, receipt);
    return receipt;
  }

  private async apply(revision: number | undefined, apply: Apply) {
    if (revision === undefined) {
      await apply();
      return;
    }
    const receipt = this.receipts.get(revision) || this.receipt(revision);
    if (revision <= this.appliedRevision) {
      receipt.resolve();
      this.receipts.delete(revision);
      return;
    }
    if (receipt.started) return receipt.promise;
    receipt.started = true;
    try {
      await apply();
      this.appliedRevision = revision;
      receipt.resolve();
    } catch (error) {
      receipt.reject(error);
      throw error;
    } finally {
      // Successful revisions are represented by the watermark. Failed applies
      // can be retried and never suppress a genuinely newer restoration.
      if (this.receipts.get(revision) === receipt)
        this.receipts.delete(revision);
    }
  }

  /** Flush pending event batches, then drain work added while awaiting work.
   * The flush callback must not wait on this same coordinator from inside it.
   */
  async idle(flush: () => Promise<unknown> = async () => {}) {
    for (;;) {
      const generation = this.generation;
      await flush();
      const tail = this.tail;
      await tail.catch(() => {});
      await Promise.resolve();
      if (generation === this.generation && tail === this.tail) return;
    }
  }
}
