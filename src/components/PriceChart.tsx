// One item's unit price over time, with your cost per unit as a dashed line.
// Recharts draws SVG; colors come from the wrapper's text color
// (currentColor), so light and dark mode each get their own ink.

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatMoney } from '../../lib/ledger/money.ts'

const AXIS = '#71717a' // zinc-500: readable on both card backgrounds, recessive

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
/** Whole dollars on the axis; exact cents live in the tooltip and table. */
const axisMoney = (cents: number) =>
  `$${Math.round(cents / 100).toLocaleString()}`

export function PriceChart({
  history,
  costPerUnitCents,
  costLabel,
}: {
  history: { asOf: string; priceCents: number }[]
  costPerUnitCents: number
  costLabel: string
}) {
  // Keep the cost line in view even when prices sit far above or below it.
  const values = [...history.map((h) => h.priceCents), costPerUnitCents]
  const min = Math.min(...values)
  const max = Math.max(...values)
  const pad = Math.max((max - min) * 0.1, 100)
  const fewPoints = history.length <= 3

  return (
    <div className="space-y-2">
      <div
        // --chart-surface: the card color, used to ring the hovered point.
        className="h-56 text-zinc-800 [--chart-surface:#fff] dark:text-zinc-200 dark:[--chart-surface:#18181b]"
        role="img"
        aria-label={`Price per unit over time, ${history.length} data points. A table follows.`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={history}
            margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
          >
            <CartesianGrid vertical={false} stroke={AXIS} strokeOpacity={0.2} />
            <XAxis
              dataKey="asOf"
              tickFormatter={shortDate}
              tick={{ fill: AXIS, fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              minTickGap={24}
            />
            <YAxis
              domain={[Math.max(0, min - pad), max + pad]}
              tickFormatter={axisMoney}
              tick={{ fill: AXIS, fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              width={56}
            />
            <ReferenceLine
              y={costPerUnitCents}
              stroke={AXIS}
              strokeDasharray="4 4"
              label={{
                value: costLabel,
                position: 'insideBottomRight',
                fill: AXIS,
                fontSize: 12,
              }}
            />
            <Tooltip
              cursor={{ stroke: AXIS, strokeOpacity: 0.5 }}
              content={({ active, payload }) => {
                const point = payload?.[0]?.payload as
                  { asOf: string; priceCents: number } | undefined
                if (!active || !point) return null
                return (
                  <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm shadow dark:border-zinc-700 dark:bg-zinc-900">
                    <div className="text-zinc-500">{longDate(point.asOf)}</div>
                    <div className="font-medium tabular-nums">
                      {formatMoney(point.priceCents)}
                    </div>
                  </div>
                )
              }}
            />
            <Line
              type="monotone"
              dataKey="priceCents"
              stroke="currentColor"
              strokeWidth={2}
              // With only a few points a bare line is hard to see; show them.
              dot={
                fewPoints
                  ? { r: 4, fill: 'currentColor', strokeWidth: 0 }
                  : false
              }
              activeDot={{
                r: 5,
                strokeWidth: 2,
                stroke: 'var(--chart-surface)',
              }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-zinc-500">
          Show as table
        </summary>
        <table className="mt-2 w-full text-left">
          <thead className="text-zinc-500">
            <tr>
              <th className="py-1 font-normal">Date</th>
              <th className="py-1 text-right font-normal">Price, each</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {[...history].reverse().map((h) => (
              <tr
                key={h.asOf}
                className="border-t border-zinc-200 dark:border-zinc-800"
              >
                <td className="py-1">{longDate(h.asOf)}</td>
                <td className="py-1 text-right">{formatMoney(h.priceCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}
