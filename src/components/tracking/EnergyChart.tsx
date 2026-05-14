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

interface DayStat {
  date: string;
  energy: number | null;
}

interface EnergyChartProps {
  data: DayStat[];
  avgEnergy: number | null;
}

export function EnergyChart({ data, avgEnergy }: EnergyChartProps) {
  const chartData = data
    .filter((d) => d.energy != null)
    .map((d) => ({
      date: d.date,
      label: format(parseISO(d.date), "dd MMM", { locale: pl }),
      energy: d.energy,
    }));

  if (chartData.length === 0) {
    return (
      <div style={emptyStyle}>
        <span style={{ fontSize: 28 }}>&#9889;</span>
        <p>Brak danych o energii</p>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
        <defs>
          <linearGradient id="energyGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1d4ed8" stopOpacity={0.2} />
            <stop offset="100%" stopColor="#1d4ed8" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: "#94a3b8" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          domain={[0, 10]}
          tick={{ fontSize: 11, fill: "#94a3b8" }}
          axisLine={false}
          tickLine={false}
          ticks={[0, 2, 4, 6, 8, 10]}
        />
        <Tooltip
          contentStyle={{
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: 10,
            fontSize: 13,
          }}
          formatter={(value) => [`${value}/10`, "Energia"]}
        />
        {avgEnergy != null && (
          <ReferenceLine
            y={avgEnergy}
            stroke="#94a3b8"
            strokeDasharray="4 4"
            label={{
              value: `Avg ${avgEnergy}`,
              position: "right",
              fontSize: 11,
              fill: "#94a3b8",
            }}
          />
        )}
        <Line
          type="monotone"
          dataKey="energy"
          stroke="#1d4ed8"
          strokeWidth={2.5}
          dot={{ r: 3, fill: "#1d4ed8", strokeWidth: 0 }}
          activeDot={{ r: 5, fill: "#1d4ed8" }}
        />
      </LineChart>
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
