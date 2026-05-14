"use client";

interface MoodChartProps {
  moodDistribution: Record<string, number>;
}

const MOOD_CONFIG: Record<string, { emoji: string; label: string; color: string }> = {
  great: { emoji: "😄", label: "Swietny", color: "#22c55e" },
  good: { emoji: "🙂", label: "Dobry", color: "#3b82f6" },
  ok: { emoji: "😐", label: "Neutralny", color: "#eab308" },
  bad: { emoji: "😔", label: "Slaby", color: "#f97316" },
  terrible: { emoji: "😢", label: "Bardzo slaby", color: "#ef4444" },
};

export function MoodChart({ moodDistribution }: MoodChartProps) {
  const entries = Object.entries(moodDistribution);
  const total = entries.reduce((s, [, v]) => s + v, 0);

  if (total === 0) {
    return (
      <div style={emptyStyle}>
        <span style={{ fontSize: 28 }}>&#128522;</span>
        <p>Brak danych o nastroju</p>
      </div>
    );
  }

  // Sort by MOOD_CONFIG order
  const order = ["great", "good", "ok", "bad", "terrible"];
  const sorted = order
    .filter((mood) => moodDistribution[mood] != null && moodDistribution[mood] > 0)
    .map((mood) => ({
      mood,
      count: moodDistribution[mood],
      ...MOOD_CONFIG[mood],
    }));

  // Handle unknown moods
  for (const [mood, count] of entries) {
    if (!MOOD_CONFIG[mood] && count > 0) {
      sorted.push({
        mood,
        count,
        emoji: "😶",
        label: mood,
        color: "#94a3b8",
      });
    }
  }

  const maxCount = Math.max(...sorted.map((s) => s.count));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {sorted.map((item) => (
        <div
          key={item.mood}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span style={{ fontSize: 22, width: 30, textAlign: "center" }}>
            {item.emoji}
          </span>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 12,
                color: "#64748b",
              }}
            >
              <span>{item.label}</span>
              <span style={{ fontWeight: 600 }}>
                {item.count}x
              </span>
            </div>
            <div
              style={{
                height: 8,
                borderRadius: 4,
                background: "#f1f5f9",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${(item.count / maxCount) * 100}%`,
                  borderRadius: 4,
                  background: item.color,
                  transition: "width 500ms ease",
                }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

const emptyStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  height: 160,
  color: "#94a3b8",
  fontSize: 14,
  gap: 4,
};
