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

interface DayStat {
  date: string;
  sleepHours: number | null;
  sleepQuality: number | null;
}

interface SleepChartProps {
  data: DayStat[];
}

function qualityColor(quality: number | null): string {
  if (quality == null) return "#94a3b8";
  if (quality >= 4) return "#22c55e"; // good
  if (quality >= 3) return "#eab308"; // ok
  return "#ef4444"; // poor
}

export function SleepChart({ data }: SleepChartProps) {
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
      <div style={emptyStyle}>
        <span style={{ fontSize: 28 }}>&#127769;</span>
        <p>Brak danych o snie</p>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: "#94a3b8" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          domain={[0, 12]}
          tick={{ fontSize: 11, fill: "#94a3b8" }}
          axisLine={false}
          tickLine={false}
          ticks={[0, 4, 8, 12]}
        />
        <Tooltip
          contentStyle={{
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: 10,
            fontSize: 13,
          }}
          formatter={(value, _name, props) => {
            const q = (props as { payload?: { sleepQuality?: number | null } }).payload?.sleepQuality;
            const qLabel = q != null ? ` (jakosc: ${q}/5)` : "";
            return [`${value}h${qLabel}`, "Sen"];
          }}
        />
        <ReferenceLine
          y={7}
          stroke="#22c55e"
          strokeDasharray="4 4"
          strokeOpacity={0.5}
        />
        <ReferenceLine
          y={8}
          stroke="#22c55e"
          strokeDasharray="4 4"
          strokeOpacity={0.5}
        />
        <Bar dataKey="sleepHours" radius={[4, 4, 0, 0]} maxBarSize={28}>
          {chartData.map((entry, idx) => (
            <Cell key={idx} fill={qualityColor(entry.sleepQuality)} fillOpacity={0.85} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

const emptyStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  height: 200,
  color: "#94a3b8",
  fontSize: 14,
  gap: 4,
};
