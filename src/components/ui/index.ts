/**
 * PAPI PLANER UI primitives.
 *
 * One import line for the whole library:
 * @example
 * import { Button, Card, ListRow, Sheet, Stat, Field, Skeleton, EmptyState } from "@/components/ui";
 *
 * Every primitive reads the CSS tokens from `src/app/globals.css` (DESIGN-SPEC section 3),
 * so light and dark mode come for free and no component writes a hex colour.
 */

export { Pressable, type PressableProps } from "./Pressable";
export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from "./Button";
export { Card, type CardProps, type CardVariant, type CardPadding } from "./Card";
export { ListRow, type ListRowProps } from "./ListRow";
export { Sheet, type SheetProps, type SheetSize } from "./Sheet";
export { Stat, type StatProps, type StatSize, type StatTrend } from "./Stat";
export {
  Field,
  fieldControlStyle,
  fieldTextareaStyle,
  fieldControlErrorStyle,
  type FieldProps,
  type FieldChildProps,
} from "./Field";
export { Skeleton, type SkeletonProps, type SkeletonVariant } from "./Skeleton";
export { EmptyState, type EmptyStateProps, type EmptyStateAction } from "./EmptyState";

/* design tokens and helpers */
export { T, TYPO, MOTION, TONE, SLOW_MS, type Tone } from "./tokens";
export { fireHaptic, type HapticKind } from "./haptics-bridge";

/* already in the codebase, re-exported so imports stay on one line */
export { default as BigTabs, type BigTab } from "./BigTabs";
