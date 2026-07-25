"use client";

import React from "react";
import { Button } from "./Button";
import { T, TONE, TYPO, type Tone } from "./tokens";

export interface EmptyStateAction {
  label: string;
  onPress: (e: React.MouseEvent<HTMLElement>) => void;
  loading?: boolean;
}

export interface EmptyStateProps {
  /** Icon or emoji. Rendered inside a soft circle. */
  icon?: React.ReactNode;
  title: string;
  body?: string;
  /** Primary way out of the empty screen. Every empty state should have one. */
  action?: EmptyStateAction;
  /** Optional second, quieter way out. */
  secondaryAction?: EmptyStateAction;
  tone?: Tone;
  /** Compact variant for an empty section inside a card. */
  compact?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Empty state with an icon, a sentence and an action.
 *
 * Today the app has 36 "Brak ..." messages and not one of them offers a way out
 * (habits/page.tsx:436 literally says "Dodaj swój pierwszy nawyk" without a button).
 * The `action` prop is the whole point of this component.
 *
 * @example
 * <EmptyState
 *   icon="🌱"
 *   title="Brak nawyków"
 *   body="Dodaj pierwszy nawyk i zacznij budować rytuał."
 *   action={{ label: "Dodaj nawyk", onPress: () => setShowAdd(true) }}
 * />
 */
export function EmptyState({
  icon,
  title,
  body,
  action,
  secondaryAction,
  tone = "primary",
  compact = false,
  className,
  style,
}: EmptyStateProps) {
  const toneColors = TONE[tone];

  return (
    <div
      className={className}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        gap: T.sp2,
        padding: compact ? `${T.sp5} ${T.sp4}` : `${T.sp10} ${T.sp5}`,
        width: "100%",
        boxSizing: "border-box",
        ...style,
      }}
    >
      {icon ? (
        <div
          aria-hidden="true"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: compact ? 48 : 64,
            height: compact ? 48 : 64,
            borderRadius: T.rFull,
            background: toneColors.soft,
            color: toneColors.fg,
            fontSize: compact ? 24 : 30,
            lineHeight: 1,
            marginBottom: T.sp1,
          }}
        >
          {icon}
        </div>
      ) : null}

      <div style={{ ...TYPO.title3, color: T.text }}>{title}</div>

      {body ? (
        <div style={{ ...TYPO.callout, color: T.text3, maxWidth: 320 }}>{body}</div>
      ) : null}

      {action || secondaryAction ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: T.sp2,
            marginTop: T.sp3,
            width: "100%",
            maxWidth: 280,
          }}
        >
          {action ? (
            <Button
              variant="primary"
              size="md"
              fullWidth
              loading={action.loading}
              onPress={action.onPress}
            >
              {action.label}
            </Button>
          ) : null}
          {secondaryAction ? (
            <Button
              variant="ghost"
              size="md"
              fullWidth
              loading={secondaryAction.loading}
              onPress={secondaryAction.onPress}
            >
              {secondaryAction.label}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default EmptyState;
