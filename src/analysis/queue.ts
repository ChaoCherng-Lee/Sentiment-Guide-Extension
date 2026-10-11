// =============================================================================
// Priority request queue for model calls.
//
// Ollama handles one request at a time by default, so we run one job at a
// time and always pick high-priority work (outgoing checks) before
// low-priority work (incoming analysis). A job with a `key` supersedes any
// older job with the same key: a newer check from the same compose box
// cancels the older one, whether it is still waiting or already running.
// =============================================================================

export type Priority = "high" | "low"

export class CancelledError extends Error {
  constructor(message = "cancelled") {
    super(message)
    this.name = "CancelledError"
  }
}

interface Job {
  key?: string
  priority: Priority
  ctrl: AbortController
  run: (signal: AbortSignal) => Promise<unknown>
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
}

export class RequestQueue {
  private pending: Job[] = []
  private running = new Set<Job>()

  constructor(private readonly concurrency = 1) {}

  get size() {
    return this.pending.length + this.running.size
  }

  add<T>(run: (signal: AbortSignal) => Promise<T>, opts: { priority: Priority; key?: string }): Promise<T> {
    if (opts.key !== undefined) this.cancel(job => job.key === opts.key, "superseded")

    return new Promise<T>((resolve, reject) => {
      this.pending.push({
        key: opts.key,
        priority: opts.priority,
        ctrl: new AbortController(),
        run,
        resolve: resolve as (v: unknown) => void,
        reject,
      })
      this.pump()
    })
  }

  /** Cancel every job (e.g. when the extension is paused). */
  cancelAll(reason = "cancelled") {
    this.cancel(() => true, reason)
  }

  private cancel(match: (job: Job) => boolean, reason: string) {
    this.pending = this.pending.filter(job => {
      if (!match(job)) return true
      job.reject(new CancelledError(reason))
      return false
    })
    for (const job of this.running) {
      if (match(job)) job.ctrl.abort(new CancelledError(reason))
    }
  }

  private next(): Job | undefined {
    const idx = this.pending.findIndex(j => j.priority === "high")
    return this.pending.splice(idx === -1 ? 0 : idx, 1)[0]
  }

  private pump() {
    while (this.running.size < this.concurrency && this.pending.length) {
      const job = this.next()!
      this.running.add(job)
      job.run(job.ctrl.signal)
        .then(
          value => job.ctrl.signal.aborted ? job.reject(job.ctrl.signal.reason) : job.resolve(value),
          err   => job.reject(job.ctrl.signal.aborted ? job.ctrl.signal.reason : err),
        )
        .finally(() => {
          this.running.delete(job)
          this.pump()
        })
    }
  }
}
