// Small SVG charts. Every chart has a legend or a title naming its series,
// a hover tooltip, and a table view, so nothing relies on colour alone.

import { type ReactNode, useEffect, useRef, useState } from "react"
import type { Count, Week } from "../stats"

const fmtWeek = (d: Date) => d.toLocaleDateString(undefined, { day: "numeric", month: "short" })
const pct = (r: number) => `${Math.round(r * 100)}%`

/** Width of an element, kept up to date. */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(600)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(260, e.contentRect.width)))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}

/** A tidy upper bound and 3–5 ticks for counts. */
function countTicks(max: number): number[] {
  if (max <= 4) return [0, 1, 2, 3, 4].slice(0, Math.max(2, max + 1))
  const step = Math.ceil(max / 4)
  return [0, step, step * 2, step * 3, step * 4]
}

/** A bar with only its top (data end) corners rounded. */
function topRounded(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0) return ""
  const rr = Math.min(r, h, w / 2)
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`
}

function Tooltip({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return <div className="tooltip" style={{ left: x, top: y }} role="status">{children}</div>
}

const PAD = { top: 10, right: 8, bottom: 26, left: 30 }

// ── Weekly yellow / red counts: stacked bars ────────────────────────────────

export function WeeklyChart({ weeks }: { weeks: Week[] }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const height = 200
  const innerW = width - PAD.left - PAD.right
  const innerH = height - PAD.top - PAD.bottom
  const ticks  = countTicks(Math.max(...weeks.map(w => w.total), 1))
  const top    = ticks.at(-1)!
  const y      = (v: number) => PAD.top + innerH - (v / top) * innerH
  const band   = innerW / weeks.length
  const barW   = Math.min(28, band * 0.6)
  const labelEvery = band < 44 ? 2 : 1

  return (
    <div className="chart" ref={ref}>
      <div className="legend">
        <span><span className="swatch" style={{ background: "var(--tone-yellow)" }} />Yellow — could come across badly</span>
        <span><span className="swatch" style={{ background: "var(--tone-red)" }} />Red — unkind</span>
      </div>
      <svg width={width} height={height} role="img" aria-label="Flagged messages per week, yellow and red">
        {ticks.map(t => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--baseline)" : "var(--grid)"} strokeWidth={1} />
            <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end">{t}</text>
          </g>
        ))}
        {weeks.map((w, i) => {
          const cx = PAD.left + band * i + band / 2
          const x  = cx - barW / 2
          const yellowTop = y(w.yellow)
          // 2px of surface between the two segments
          const redBottom = w.yellow ? yellowTop - 2 : y(0)
          const redH = w.red ? (w.red / top) * innerH - (w.yellow ? 2 : 0) : 0
          return (
            <g key={i}>
              {hover === i && <rect x={cx - band / 2} y={PAD.top} width={band} height={innerH} fill="var(--wash)" />}
              {w.yellow > 0 && (w.red
                ? <rect x={x} y={yellowTop} width={barW} height={y(0) - yellowTop} fill="var(--tone-yellow)" />
                : <path d={topRounded(x, yellowTop, barW, y(0) - yellowTop, 4)} fill="var(--tone-yellow)" />)}
              {redH > 0 && <path d={topRounded(x, redBottom - redH, barW, redH, 4)} fill="var(--tone-red)" />}
              {i % labelEvery === (weeks.length - 1) % labelEvery && (
                <text x={cx} y={height - 8} textAnchor="middle">{fmtWeek(w.start)}</text>
              )}
              {/* Hit target: the whole week's column */}
              <rect x={cx - band / 2} y={PAD.top} width={band} height={innerH} fill="transparent"
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
            </g>
          )
        })}
      </svg>
      {hover !== null && (() => {
        const w = weeks[hover]
        return (
          <Tooltip x={PAD.left + band * hover + band / 2} y={y(w.total) }>
            <div className="t">Week of {fmtWeek(w.start)}</div>
            <div><span className="swatch" style={{ background: "var(--tone-yellow)" }} />{w.yellow} yellow</div>
            <div><span className="swatch" style={{ background: "var(--tone-red)" }} />{w.red} red</div>
            {w.total > 0 && <div className="secondary">Took {w.accepted} of {w.total} suggestions</div>}
          </Tooltip>
        )
      })()}
      <details className="table-view">
        <summary>Show as a table</summary>
        <table>
          <thead><tr><th>Week of</th><th className="num">Yellow</th><th className="num">Red</th><th className="num">Suggestions taken</th></tr></thead>
          <tbody>
            {weeks.map(w => (
              <tr key={w.start.toISOString()}>
                <td>{fmtWeek(w.start)}</td><td className="num">{w.yellow}</td><td className="num">{w.red}</td>
                <td className="num">{w.total ? `${w.accepted} of ${w.total}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}

// ── Suggestions taken over time: one line ───────────────────────────────────

export function TrendChart({ weeks }: { weeks: Week[] }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const height = 180
  const innerW = width - PAD.left - PAD.right - 8
  const innerH = height - PAD.top - PAD.bottom
  const x = (i: number) => PAD.left + 8 + (weeks.length === 1 ? innerW / 2 : (i / (weeks.length - 1)) * innerW)
  const y = (r: number) => PAD.top + innerH - r * innerH

  // Line segments, broken where a week had nothing flagged
  const segments: string[] = []
  let current = ""
  weeks.forEach((w, i) => {
    if (w.acceptRate === null) { if (current) segments.push(current); current = ""; return }
    current += `${current ? "L" : "M"}${x(i)},${y(w.acceptRate)} `
  })
  if (current) segments.push(current)

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const i = Math.round(((e.clientX - box.left) / box.width) * (weeks.length - 1))
    setHover(Math.max(0, Math.min(weeks.length - 1, i)))
  }

  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={height} role="img" aria-label="Share of suggestions taken per week">
        {[0, 0.5, 1].map(t => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--baseline)" : "var(--grid)"} />
            <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end">{pct(t)}</text>
          </g>
        ))}
        {weeks.map((w, i) => (i % 2 === (weeks.length - 1) % 2) && (
          <text key={i} x={x(i)} y={height - 8} textAnchor="middle">{fmtWeek(w.start)}</text>
        ))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--baseline)" />}
        {segments.map((d, i) => <path key={i} d={d} fill="none" stroke="var(--series)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />)}
        {weeks.map((w, i) => w.acceptRate !== null && (
          <circle key={i} cx={x(i)} cy={y(w.acceptRate)} r={hover === i ? 5 : 4} fill="var(--series)" stroke="var(--surface)" strokeWidth={2} />
        ))}
        <rect x={PAD.left} y={PAD.top} width={innerW + 8} height={innerH} fill="transparent"
          onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
      </svg>
      {hover !== null && (() => {
        const w = weeks[hover]
        return (
          <Tooltip x={x(hover)} y={y(w.acceptRate ?? 0)}>
            <div className="t">Week of {fmtWeek(w.start)}</div>
            <div>{w.total ? `Took ${w.accepted} of ${w.total} suggestions (${pct(w.acceptRate!)})` : "Nothing flagged"}</div>
          </Tooltip>
        )
      })()}
      <details className="table-view">
        <summary>Show as a table</summary>
        <table>
          <thead><tr><th>Week of</th><th className="num">Suggestions taken</th><th className="num">Share</th></tr></thead>
          <tbody>
            {weeks.map(w => (
              <tr key={w.start.toISOString()}>
                <td>{fmtWeek(w.start)}</td>
                <td className="num">{w.total ? `${w.accepted} of ${w.total}` : "—"}</td>
                <td className="num">{w.acceptRate === null ? "—" : pct(w.acceptRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}

// ── Counts per app or category: horizontal bars ─────────────────────────────

export function BarList<K extends string>({ items, noun }: { items: Count<K>[]; noun: string }) {
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null)
  const max   = Math.max(...items.map(i => i.count), 1)
  const total = items.reduce((s, i) => s + i.count, 0)
  if (!items.length) return <p className="muted">Nothing flagged in this period.</p>
  return (
    <div className="bars">
      {items.map((item, i) => (
        <div className="bar-row" key={item.key}
          onMouseMove={e => {
            const box = e.currentTarget.parentElement!.getBoundingClientRect()
            setHover({ i, x: e.clientX - box.left, y: e.currentTarget.getBoundingClientRect().top - box.top })
          }}
          onMouseLeave={() => setHover(null)}>
          <span className="name" title={item.label}>{item.label}</span>
          <span className="track"><span className="fill" style={{ display: "block", width: `${(item.count / max) * 100}%` }} /></span>
          <span className="count">{item.count}</span>
        </div>
      ))}
      {hover && (
        <Tooltip x={hover.x} y={hover.y}>
          <div className="t">{items[hover.i].label}</div>
          <div>{items[hover.i].count} {noun} ({pct(items[hover.i].count / total)})</div>
        </Tooltip>
      )}
    </div>
  )
}
