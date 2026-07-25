"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { format, parseISO } from "date-fns";
import { pl } from "date-fns/locale";
import { useChartTheme, chartEmptyStyle } from "./useChartTheme";

interface DayStat {
  date: string;
  completionRate: number | null;
}

interface CompletionChartProps {
  data: DayStat[];
}

export function CompletionChart({ data }: CompletionChartProps) {
  const c = useChartTheme();

  const chartData = data
    .filter((d) => d.completionRate != null)
    .map((d) => ({
      date: d.date,
      label: format(parseISO(d.date), "dd MMM", { locale: pl }),
      completion: Math.round(d.completionRate! * 100),
    }));

  if (chartData.length === 0) {
    return (
      <div style={chartEmptyStyle}>
        <span style={{ fontSize: 32 }}>&#9989;</span>
        <p style={{ margin: 0 }}>Brak danych o aktywnościach</p>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
        <defs>
          <linearGradient id="completionGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={c.success} stopOpacity={0.32} />
            <stop offset="100%" stopColor={c.success} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="label"
          tick={{ fontSize: 12, fill: c.axis }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          domain={[0, 100]}
          tick={{ fontSize: 12, fill: c.axis }}
          axisLine={false}
          tickLine={false}
          ticks={[0, 25, 50, 75, 100]}
          tickFormatter={(v: number) => `${v}%`}
        />
        <Tooltip
          cursor={{ stroke: c.grid, strokeWidth: 1 }}
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
          formatter={(value) => [`${value}%`, "Realizacja"]}
        />
        <ReferenceLine
          y={80}
          stroke={c.grid}
          strokeDasharray="4 4"
          label={{
            value: "Cel 80%",
            position: "right",
            fontSize: 12,
            fill: c.axis,
          }}
        />
        <Area
          type="monotone"
          dataKey="completion"
          stroke={c.success}
          strokeWidth={2.5}
          fill="url(#completionGrad)"
          dot={{ r: 3, fill: c.success, strokeWidth: 0 }}
          activeDot={{ r: 5, fill: c.success }}
          animationDuration={720}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
