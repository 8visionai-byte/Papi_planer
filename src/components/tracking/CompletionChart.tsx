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

interface DayStat {
  date: string;
  completionRate: number | null;
}

interface CompletionChartProps {
  data: DayStat[];
}

export function CompletionChart({ data }: CompletionChartProps) {
  const chartData = data
    .filter((d) => d.completionRate != null)
    .map((d) => ({
      date: d.date,
      label: format(parseISO(d.date), "dd MMM", { locale: pl }),
      completion: Math.round(d.completionRate! * 100),
    }));

  if (chartData.length === 0) {
    return (
      <div style={emptyStyle}>
        <span style={{ fontSize: 28 }}>&#9989;</span>
        <p>Brak danych o aktywnosciach</p>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
        <defs>
          <linearGradient id="completionGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22c55e" stopOpacity={0.3} />
            <stop offset="100%" stopColor="#22c55e" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: "#94a3b8" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          domain={[0, 100]}
          tick={{ fontSize: 11, fill: "#94a3b8" }}
          axisLine={false}
          tickLine={false}
          ticks={[0, 25, 50, 75, 100]}
          tickFormatter={(v: number) => `${v}%`}
        />
        <Tooltip
          contentStyle={{
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: 10,
            fontSize: 13,
          }}
          formatter={(value) => [`${value}%`, "Realizacja"]}
        />
        <ReferenceLine
          y={80}
          stroke="#94a3b8"
          strokeDasharray="4 4"
          label={{
            value: "Cel 80%",
            position: "right",
            fontSize: 11,
            fill: "#94a3b8",
          }}
        />
        <Area
          type="monotone"
          dataKey="completion"
          stroke="#22c55e"
          strokeWidth={2.5}
          fill="url(#completionGrad)"
          dot={{ r: 3, fill: "#22c55e", strokeWidth: 0 }}
          activeDot={{ r: 5, fill: "#22c55e" }}
        />
      </AreaChart>
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
