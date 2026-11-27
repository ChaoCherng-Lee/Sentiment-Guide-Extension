import { describe, expect, it } from "vitest"
import { CancelledError, RequestQueue } from "../../src/analysis/queue"

function deferred<T = void>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}

/** A job that only finishes when aborted. */
const untilAborted = (signal: AbortSignal) =>
  new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)))

describe("RequestQueue", () => {
  it("runs one job at a time", async () => {
    const q = new RequestQueue(1)
    const order: string[] = []
    const gate = deferred()
    const a = q.add(async () => { order.push("a start"); await gate.promise; order.push("a end") }, { priority: "high" })
    const b = q.add(async () => { order.push("b") }, { priority: "high" })
    await Promise.resolve()
    expect(order).toEqual(["a start"])
    gate.resolve()
    await Promise.all([a, b])
    expect(order).toEqual(["a start", "a end", "b"])
  })

  it("runs high priority before low priority", async () => {
    const q = new RequestQueue(1)
    const order: string[] = []
    const gate = deferred()
    const first = q.add(() => gate.promise, { priority: "low" })
    const low   = q.add(async () => { order.push("low") }, { priority: "low" })
    const high  = q.add(async () => { order.push("high") }, { priority: "high" })
    gate.resolve()
    await Promise.all([first, low, high])
    expect(order).toEqual(["high", "low"])
  })

  it("a high-priority job interrupts a running low one, which then runs again", async () => {
    const q = new RequestQueue(1)
    const runs: string[] = []
    const low = q.add(async (signal) => {
      runs.push("low")
      if (runs.length === 1) await untilAborted(signal)
      return "low done"
    }, { priority: "low" })
    await Promise.resolve()
    const high = q.add(async () => { runs.push("high"); return "high done" }, { priority: "high" })
    await expect(high).resolves.toBe("high done")
    await expect(low).resolves.toBe("low done")
    expect(runs).toEqual(["low", "high", "low"])
  })

  it("an interrupted low job goes back before other low jobs", async () => {
    const q = new RequestQueue(1)
    const runs: string[] = []
    const first = q.add(async (signal) => {
      runs.push("first")
      if (runs.length === 1) await untilAborted(signal)
    }, { priority: "low" })
    const second = q.add(async () => { runs.push("second") }, { priority: "low" })
    await Promise.resolve()
    const high = q.add(async () => { runs.push("high") }, { priority: "high" })
    await Promise.all([first, second, high])
    expect(runs).toEqual(["first", "high", "first", "second"])
  })

  it("a newer job with the same key cancels a pending one", async () => {
    const q = new RequestQueue(1)
    const gate = deferred()
    const blocker = q.add(() => gate.promise, { priority: "high" })
    const old = q.add(async () => "old", { priority: "high", key: "box1" })
    const nu  = q.add(async () => "new", { priority: "high", key: "box1" })
    gate.resolve()
    await blocker
    await expect(old).rejects.toBeInstanceOf(CancelledError)
    await expect(nu).resolves.toBe("new")
  })

  it("a newer job with the same key aborts a running one", async () => {
    const q = new RequestQueue(1)
    const old = q.add(untilAborted, { priority: "high", key: "box1" })
    await Promise.resolve()
    const nu = q.add(async () => "new", { priority: "high", key: "box1" })
    await expect(old).rejects.toBeInstanceOf(CancelledError)
    await expect(nu).resolves.toBe("new")
  })

  it("leaves jobs with other keys alone", async () => {
    const q = new RequestQueue(1)
    const a = q.add(async () => "a", { priority: "high", key: "box1" })
    const b = q.add(async () => "b", { priority: "high", key: "box2" })
    await expect(Promise.all([a, b])).resolves.toEqual(["a", "b"])
  })

  it("cancelAll rejects running and pending jobs", async () => {
    const q = new RequestQueue(1)
    const a = q.add(untilAborted, { priority: "high" })
    const b = q.add(async () => "b", { priority: "low" })
    await Promise.resolve()
    q.cancelAll()
    await expect(a).rejects.toBeInstanceOf(CancelledError)
    await expect(b).rejects.toBeInstanceOf(CancelledError)
    expect(q.size).toBe(0)
  })
})
