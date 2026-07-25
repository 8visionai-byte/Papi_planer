"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from "recharts";
import { format, parseISO } from "date-fns";
import { pl } from "date-fns/locale";
import { useChartTheme, chartEmptyStyle, type ChartTheme } from "./useChartTheme";

interface DayStat {
  date: string;
  sleepHours: number | null;
  sleepQuality: number | null;
}

interface SleepChartProps {
  data: DayStat[];
}

/** Quality -> semantic colour. Same thresholds as before, tokens instead of hex. */
function qualityColor(quality: number | null, c: ChartTheme): string {
  if (quality == null) return c.axis;
  if (quality >= 4) return c.success; // good
  if (quality >= 3) return c.warning; // ok
  return c.danger; // poor
}

export function SleepChart({ data }: SleepChartProps) {
  const c = useChartTheme();

  const chartData = data
    .filter((d) => d.sleepHours != null)
    .map((d) => ({
      date: d.date,
      label: format(parseISO(d.date), "dd MMM", { locale: pl }),
      sleepHours: d.sleepHours,
      sleepQuality: d.sleepQuality,
    }));

  if (chartData.length === 0) {
    return (
      <div style={chartEmptyStyle}>
        <span style={{ fontSize: 32 }}>&#127769;</span>
        <p style={{ margin: 0 }}>Brak danych o śnie</p>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
        <XAxis
          dataKey="label"
          tick={{ fontSize: 12, fill: c.axis }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          domain={[0, 12]}
          tick={{ fontSize: 12, fill: c.axis }}
          axisLine={false}
          tickLine={false}
          ticks={[0, 4, 8, 12]}
        />
        <Tooltip
          cursor={{ fill: c.surface2, fillOpacity: 0.5 }}
          contentStyle={{
            background: c.surface,
            border: `1px solid ${c.border}`,
            borderRadius: 14,
            fontSize: 13,
            color: c.text,
            boxShadow: "0 14px 34px -12px rgba(0,0,0,0.7)",
          }}
          labelStyle={{ color: c.text2 }}
          itemStyle={{ color: c.text }}
          formatter={(value, _name, props) => {
            const q = (props as { payload?: { sleepQuality?: number | null } }).payload?.sleepQuality;
            const qLabel = q != null ? ` (jakość: ${q}/5)` : "";
            return [`${value}h${qLabel}`, "Sen"];
          }}
        />
        <ReferenceLine y={7} stroke={c.success} strokeDasharray="4 4" strokeOpacity={0.5} />
        <ReferenceLine y={8} stroke={c.success} strokeDasharray="4 4" strokeOpacity={0.5} />
        <Bar dataKey="sleepHours" radius={[4, 4, 0, 0]} maxBarSize={28} animationDuration={720}>
          {chartData.map((entry, idx) => (
            <Cell key={idx} fill={qualityColor(entry.sleepQuality, c)} fillOpacity={0.9} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
