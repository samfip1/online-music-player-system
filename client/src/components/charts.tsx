import { useState, type ReactNode } from 'react'
import { Card } from './ui'

// Shared charts for the admin and host-insights pages. Colors validated (dataviz skill) against the
// dark card surface #0f0f17: lightness band, chroma, colour-blind separation and contrast all pass.
export const CHART_COLOR = '#a855f7'
export const CHART_COLOR_2 = '#0d9488' // second series (downvotes), paired with CHART_COLOR

/** Clean axis maximum: 1, 2 or 5 × a power of ten, at or above the data's max. */
export function niceMax(max: number) {
  if (max <= 0) return 1
  const step = 10 ** Math.floor(Math.log10(max))
  return [1, 2, 5, 10].map((m) => m * step).find((v) => v >= max)!
}

/** Single-series column chart: one hue, no legend (the title names it), hover tooltip per day, table view. */
export function BarChart<D extends { day: string }>({ title, days, value, format }: { title: string; days: D[]; value: (d: D) => number; format: (n: number) => string }) {
  const [hover, setHover] = useState<number | null>(null)
  const [showTable, setShowTable] = useState(false)
  const values = days.map(value)
  const top = niceMax(Math.max(0, ...values))
  // Net revenue can go below zero on a refund day: bars then hang down from the zero line.
  const minValue = Math.min(0, ...values)
  const bottom = minValue < 0 ? -niceMax(-minValue) : 0
  const W = 300
  const H = 140
  const pad = { left: 2, right: 30, top: 10, bottom: 18 } // right gutter holds the axis labels, clear of today's bar
  const plotH = H - pad.top - pad.bottom
  const slot = (W - pad.left - pad.right) / days.length
  const barW = Math.min(24, slot - 2) // 2px surface gap between touching bars
  const y = (v: number) => pad.top + ((top - v) / (top - bottom)) * plotH
  const zeroY = y(0)
  const empty = values.every((v) => v === 0)
  const total = values.reduce((a, b) => a + b, 0)
  const peak = values.indexOf(Math.max(...values))
  const dayLabel = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

  return (
    <Card className="p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold">{title}</h2>
        <button onClick={() => setShowTable((t) => !t)} className="text-xs text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline">
          {showTable ? 'Chart' : 'Table'}
        </button>
      </div>
      <p className="text-2xl font-semibold tabular-nums">{format(total)}</p>
      <p className="text-xs text-zinc-500">last 30 days</p>

      {showTable ? (
        <div className="scrollbar-thin mt-3 max-h-40 overflow-y-auto">
          <table className="w-full text-sm">
            <tbody>
              {days.map((d, i) => (
                <tr key={d.day} className="border-b border-line last:border-0">
                  <td className="py-1 text-zinc-400">{dayLabel(d.day)}</td>
                  <td className="py-1 text-right tabular-nums">{format(values[i])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative mt-3">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full overflow-visible" role="img" aria-label={`${title}, last 30 days, total ${format(total)}`} onMouseLeave={() => setHover(null)}>
            {/* Recessive hairline grid at 0, half and the axis max */}
            {/* No data yet: just the zero line, no made-up scale */}
            {(empty ? [0] : [...new Set([bottom, 0, top / 2, top])]).map((tick) => (
              <g key={tick}>
                <line x1={pad.left} x2={W - pad.right} y1={y(tick)} y2={y(tick)} stroke={tick === 0 ? 'rgb(255 255 255 / 0.16)' : 'rgb(255 255 255 / 0.08)'} strokeWidth={1} />
                <text x={W - 2} y={y(tick) + 3} textAnchor="end" className="fill-zinc-500 text-[9px]">
                  {format(tick)}
                </text>
              </g>
            ))}
            {values.map((v, i) => {
              const x = pad.left + i * slot + (slot - barW) / 2
              const h = Math.abs(y(v) - zeroY)
              const r = Math.min(4, barW / 2, h) // 4px rounded data-end, square at the zero line
              const dir = v < 0 ? -1 : 1 // grows up for positive values, down for negative ones
              const end = zeroY - dir * h
              return (
                <g key={days[i].day} onMouseEnter={() => setHover(i)}>
                  {/* Hit target: the whole column, bigger than the bar */}
                  <rect x={pad.left + i * slot} y={pad.top} width={slot} height={plotH} fill="transparent" />
                  {h > 0 ? (
                    <path
                      d={`M${x},${zeroY} V${end + dir * r} Q${x},${end} ${x + r},${end} H${x + barW - r} Q${x + barW},${end} ${x + barW},${end + dir * r} V${zeroY} Z`}
                      fill={CHART_COLOR}
                      opacity={hover === null || hover === i ? (v < 0 ? 0.55 : 1) : 0.3}
                    />
                  ) : null}
                </g>
              )
            })}
            {/* Label only the peak, never every bar */}
            {values[peak] > 0 && hover === null ? (
              <text x={pad.left + peak * slot + slot / 2} y={y(values[peak]) - 4} textAnchor="middle" className="fill-zinc-300 text-[9px] font-semibold">
                {format(values[peak])}
              </text>
            ) : null}
            {empty ? (
              <text x={(W - pad.right) / 2} y={pad.top + plotH / 2} textAnchor="middle" className="fill-zinc-500 text-[10px]">
                Nothing yet
              </text>
            ) : null}
            <text x={pad.left} y={H - 4} className="fill-zinc-500 text-[9px]">
              {dayLabel(days[0].day)}
            </text>
            <text x={W - pad.right} y={H - 4} textAnchor="end" className="fill-zinc-500 text-[9px]">
              Today
            </text>
            <line x1={pad.left} x2={W - pad.right} y1={zeroY} y2={zeroY} stroke="rgb(255 255 255 / 0.16)" strokeWidth={1} />
          </svg>
          {hover !== null ? (
            <div
              className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-lg bg-zinc-800 px-2.5 py-1.5 text-xs whitespace-nowrap shadow-xl ring-1 ring-white/10"
              style={{ left: `${((pad.left + hover * slot + slot / 2) / W) * 100}%` }}
            >
              <span className="text-zinc-400">{dayLabel(days[hover].day)}</span> <span className="font-semibold tabular-nums">{format(values[hover])}</span>
            </div>
          ) : null}
        </div>
      )}
    </Card>
  )
}


const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

function ChartCard({ title, subtitle, children, legend }: { title: string; subtitle: string; children: ReactNode; legend?: ReactNode }) {
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        {legend}
      </div>
      <p className="text-xs text-zinc-500">{subtitle}</p>
      <div className="relative mt-3">{children}</div>
    </Card>
  )
}

function Tooltip({ leftPct, children }: { leftPct: number; children: ReactNode }) {
  return (
    <div
      className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-lg bg-zinc-800 px-2.5 py-1.5 text-xs whitespace-nowrap shadow-xl ring-1 ring-white/10"
      style={{ left: `${Math.min(92, Math.max(8, leftPct))}%` }}
    >
      {children}
    </div>
  )
}

/** One series over time (crowd size): 2px line, a light wash under it, crosshair + tooltip on hover. */
export function LineChart({ title, subtitle, points }: { title: string; subtitle: string; points: { at: string; value: number }[] }) {
  const [hover, setHover] = useState<number | null>(null)
  // Drawn wider than the admin bar charts: these sit in a two-column layout, and a 300-wide canvas
  // would scale the 9px labels up to ~14px.
  const W = 480
  const H = 170
  const pad = { left: 2, right: 26, top: 10, bottom: 18 }
  const plotW = W - pad.left - pad.right
  const plotH = H - pad.top - pad.bottom
  const top = niceMax(Math.max(0, ...points.map((p) => p.value)))
  const x = (i: number) => pad.left + (points.length < 2 ? plotW / 2 : (i / (points.length - 1)) * plotW)
  const y = (v: number) => pad.top + plotH - (v / top) * plotH
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.value)}`).join(' ')

  return (
    <ChartCard title={title} subtitle={subtitle}>
      {points.length === 0 ? (
        <p className="grid h-32 place-items-center text-xs text-zinc-500">Nothing recorded yet</p>
      ) : (
        <>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full overflow-visible"
            role="img"
            aria-label={`${title}: peak ${Math.max(...points.map((p) => p.value))}`}
            onMouseLeave={() => setHover(null)}
            onMouseMove={(e) => {
              const box = e.currentTarget.getBoundingClientRect()
              const rel = ((e.clientX - box.left) / box.width) * W
              setHover(Math.max(0, Math.min(points.length - 1, Math.round(((rel - pad.left) / plotW) * (points.length - 1)))))
            }}
          >
            {[0, top / 2, top].map((tick) => (
              <g key={tick}>
                <line x1={pad.left} x2={W - pad.right} y1={y(tick)} y2={y(tick)} stroke="rgb(255 255 255 / 0.08)" strokeWidth={1} />
                <text x={W - 2} y={y(tick) + 3} textAnchor="end" className="fill-zinc-500 text-[9px]">
                  {Math.round(tick * 10) / 10}
                </text>
              </g>
            ))}
            <path d={`${line} L${x(points.length - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill={CHART_COLOR} opacity={0.1} />
            <path d={line} fill="none" stroke={CHART_COLOR} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {hover !== null ? (
              <>
                <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + plotH} stroke="rgb(255 255 255 / 0.25)" strokeWidth={1} />
                <circle cx={x(hover)} cy={y(points[hover].value)} r={4} fill={CHART_COLOR} stroke="#0f0f17" strokeWidth={2} />
              </>
            ) : (
              <circle cx={x(points.length - 1)} cy={y(points.at(-1)!.value)} r={4} fill={CHART_COLOR} stroke="#0f0f17" strokeWidth={2} />
            )}
            <text x={pad.left} y={H - 4} className="fill-zinc-500 text-[9px]">
              {time(points[0].at)}
            </text>
            <text x={W - pad.right} y={H - 4} textAnchor="end" className="fill-zinc-500 text-[9px]">
              {time(points.at(-1)!.at)}
            </text>
          </svg>
          {hover !== null ? (
            <Tooltip leftPct={(x(hover) / W) * 100}>
              <span className="text-zinc-400">{time(points[hover].at)}</span> <span className="font-semibold tabular-nums">{points[hover].value} people</span>
            </Tooltip>
          ) : null}
        </>
      )}
    </ChartCard>
  )
}

/** Upvotes above the line, downvotes below, per time bucket. Two series, so a legend is always shown. */
export function UpDownChart({ title, subtitle, buckets }: { title: string; subtitle: string; buckets: { at: string; up: number; down: number }[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 480 // see LineChart
  const H = 190
  const pad = { left: 2, right: 26, top: 8, bottom: 18 }
  const plotH = H - pad.top - pad.bottom
  const max = niceMax(Math.max(1, ...buckets.map((b) => Math.max(b.up, b.down))))
  const slot = (W - pad.left - pad.right) / Math.max(1, buckets.length)
  const barW = Math.min(24, slot - 2)
  const zero = pad.top + plotH / 2
  const scale = (v: number) => (v / max) * (plotH / 2)
  const legend = (
    <span className="flex items-center gap-3 text-xs text-zinc-400">
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-sm" style={{ background: CHART_COLOR }} /> Upvotes
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-sm" style={{ background: CHART_COLOR_2 }} /> Downvotes
      </span>
    </span>
  )
  // A bar with a 4px rounded end away from the zero line.
  const bar = (x: number, h: number, dir: 1 | -1) => {
    const r = Math.min(4, barW / 2, h)
    const end = zero - dir * h
    return `M${x},${zero} V${end + dir * r} Q${x},${end} ${x + r},${end} H${x + barW - r} Q${x + barW},${end} ${x + barW},${end + dir * r} V${zero} Z`
  }

  return (
    <ChartCard title={title} subtitle={subtitle} legend={legend}>
      {buckets.length === 0 ? (
        <p className="grid h-32 place-items-center text-xs text-zinc-500">No votes yet</p>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full overflow-visible" role="img" aria-label={title} onMouseLeave={() => setHover(null)}>
            {[max, 0, -max].map((tick) => (
              <g key={tick}>
                <line
                  x1={pad.left}
                  x2={W - pad.right}
                  y1={zero - scale(tick)}
                  y2={zero - scale(tick)}
                  stroke={tick === 0 ? 'rgb(255 255 255 / 0.16)' : 'rgb(255 255 255 / 0.08)'}
                  strokeWidth={1}
                />
                <text x={W - 2} y={zero - scale(tick) + 3} textAnchor="end" className="fill-zinc-500 text-[9px]">
                  {Math.abs(tick)}
                </text>
              </g>
            ))}
            {buckets.map((b, i) => {
              const x = pad.left + i * slot + (slot - barW) / 2
              const dim = hover !== null && hover !== i ? 0.35 : 1
              return (
                <g key={b.at} onMouseEnter={() => setHover(i)}>
                  <rect x={pad.left + i * slot} y={pad.top} width={slot} height={plotH} fill="transparent" />
                  {b.up ? <path d={bar(x, scale(b.up), 1)} fill={CHART_COLOR} opacity={dim} /> : null}
                  {/* 2px surface gap between the two bars at the zero line */}
                  {b.down ? <path d={bar(x, scale(b.down), -1)} fill={CHART_COLOR_2} opacity={dim} transform="translate(0,2)" /> : null}
                </g>
              )
            })}
            <text x={pad.left} y={H - 4} className="fill-zinc-500 text-[9px]">
              {time(buckets[0].at)}
            </text>
            <text x={W - pad.right} y={H - 4} textAnchor="end" className="fill-zinc-500 text-[9px]">
              {time(buckets.at(-1)!.at)}
            </text>
          </svg>
          {hover !== null ? (
            <Tooltip leftPct={((pad.left + hover * slot + slot / 2) / W) * 100}>
              <span className="text-zinc-400">{time(buckets[hover].at)}</span> <span className="font-semibold">▲ {buckets[hover].up}</span>{' '}
              <span className="font-semibold">▼ {buckets[hover].down}</span>
            </Tooltip>
          ) : null}
        </>
      )}
    </ChartCard>
  )
}
