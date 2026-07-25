"use client";

import {
  LineChart,
  Line,
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
  energy: number | null;
}

interface EnergyChartProps {
  data: DayStat[];
  avgEnergy: number | null;
}

export function EnergyChart({ data, avgEnergy }: EnergyChartProps) {
  const c = useChartTheme();

  const chartData = data
    .filter((d) => d.energy != null)
    .map((d) => ({
      date: d.date,
      label: format(parseISO(d.date), "dd MMM", { locale: pl }),
      energy: d.energy,
    }));

  if (chartData.length === 0) {
    return (
      <div style={chartEmptyStyle}>
        <span style={{ fontSize: 32 }}>&#9889;</span>
        <p style={{ margin: 0 }}>Brak danych o energii</p>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
        <defs>
          <linearGradient id="energyGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={c.accent} stopOpacity={0.2} />
            <stop offset="100%" stopColor={c.accent} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="label"
          tick={{ fontSize: 12, fill: c.axis }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          domain={[0, 10]}
          tick={{ fontSize: 12, fill: c.axis }}
          axisLine={false}
          tickLine={false}
          ticks={[0, 2, 4, 6, 8, 10]}
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
          formatter={(value) => [`${value}/10`, "Energia"]}
        />
        {avgEnergy != null && (
          <ReferenceLine
            y={avgEnergy}
            stroke={c.grid}
            strokeDasharray="4 4"
            label={{
              value: `Śr. ${avgEnergy}`,
              position: "right",
              fontSize: 12,
              fill: c.axis,
            }}
          />
        )}
        <Line
          type="monotone"
          dataKey="energy"
          stroke={c.accent}
          strokeWidth={2.5}
          dot={{ r: 3, fill: c.accent, strokeWidth: 0 }}
          activeDot={{ r: 5, fill: c.accent }}
          animationDuration={720}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
