// =============================================================================
// Priority request queue for model calls.
//
// Ollama handles one request at a time by default, so we run one job at a
// time and always pick high-priority work (outgoing checks) before
// low-priority work (incoming analysis). When every slot is busy with
// low-priority work, a new high-priority job interrupts it: the low job is
// aborted and put back at the front of the low-priority line, so an outgoing
// check never waits for an incoming one. A job with a `key` supersedes any
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
  /** Bumped when the job is interrupted, so results from the old run are ignored */
  attempt: number
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
    if (opts.priority === "high") this.interruptLow()

    return new Promise<T>((resolve, reject) => {
      this.pending.push({
        key: opts.key,
        priority: opts.priority,
        ctrl: new AbortController(),
        attempt: 0,
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

  /** Free a slot for high-priority work by putting a running low job back in line. */
  private interruptLow() {
    if (this.running.size < this.concurrency) return
    const job = [...this.running].find(j => j.priority === "low")
    if (!job) return
    job.attempt++
    job.ctrl.abort(new CancelledError("interrupted"))
    job.ctrl = new AbortController()
    this.running.delete(job)
    this.pending.unshift(job)
  }

  private next(): Job | undefined {
    const idx = this.pending.findIndex(j => j.priority === "high")
    return this.pending.splice(idx === -1 ? 0 : idx, 1)[0]
  }

  private pump() {
    while (this.running.size < this.concurrency && this.pending.length) {
      const job = this.next()!
      const { attempt, ctrl } = job
      this.running.add(job)
      job.run(ctrl.signal)
        .then(
          value => {
            if (job.attempt !== attempt) return   // interrupted; it runs again later
            ctrl.signal.aborted ? job.reject(ctrl.signal.reason) : job.resolve(value)
          },
          err => {
            if (job.attempt !== attempt) return
            job.reject(ctrl.signal.aborted ? ctrl.signal.reason : err)
          },
        )
        .finally(() => {
          if (job.attempt !== attempt) return
          this.running.delete(job)
          this.pump()
        })
    }
  }
}
