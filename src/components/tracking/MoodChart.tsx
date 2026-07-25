"use client";

interface MoodChartProps {
  moodDistribution: Record<string, number>;
}

/**
 * Colours are CSS custom properties, not hex: these land in inline `style`
 * (real CSS, not an SVG attribute), so var() resolves and the bars follow the
 * theme instead of staying light-mode green on a black card.
 */
const MOOD_CONFIG: Record<string, { emoji: string; label: string; color: string }> = {
  great: { emoji: "😄", label: "Świetny", color: "var(--success)" },
  good: { emoji: "🙂", label: "Dobry", color: "var(--primary)" },
  ok: { emoji: "😐", label: "Neutralny", color: "var(--warning)" },
  bad: { emoji: "😔", label: "Słaby", color: "var(--accent)" },
  terrible: { emoji: "😢", label: "Bardzo słaby", color: "var(--danger)" },
};

export function MoodChart({ moodDistribution }: MoodChartProps) {
  const entries = Object.entries(moodDistribution);
  const total = entries.reduce((s, [, v]) => s + v, 0);

  if (total === 0) {
    return (
      <div style={emptyStyle}>
        <span style={{ fontSize: 32 }}>&#128522;</span>
        <p style={{ margin: 0 }}>Brak danych o nastroju</p>
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
        color: "var(--text-3)",
      });
    }
  }

  const maxCount = Math.max(...sorted.map((s) => s.count));

  return (
    <div className="anim-stagger" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {sorted.map((item) => (
        <div key={item.mood} style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 24, width: 32, textAlign: "center", lineHeight: 1 }}>
            {item.emoji}
          </span>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
                fontSize: 13,
                color: "var(--text-2)",
              }}
            >
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                {item.label}
              </span>
              <span
                style={{
                  fontWeight: 700,
                  color: "var(--text)",
                  fontVariantNumeric: "tabular-nums",
                  flexShrink: 0,
                }}
              >
                {item.count}&times;
              </span>
            </div>
            <div
              style={{
                height: 10,
                borderRadius: "var(--r-full)",
                background: "var(--surface-2)",
                overflow: "hidden",
              }}
            >
              {/* .anim-bar = scaleX from 0, never width: layout stays untouched */}
              <div
                className="anim-bar"
                style={{
                  height: "100%",
                  width: `${(item.count / maxCount) * 100}%`,
                  borderRadius: "var(--r-full)",
                  background: item.color,
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
  color: "var(--text-3)",
  fontSize: "var(--fs-callout, 15px)",
  gap: 8,
};
