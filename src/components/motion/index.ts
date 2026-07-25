/**
 * PAPI PLANER motion layer.
 *
 * Gesture and animation components that sit on top of the existing inline-style
 * screens. Nothing here owns business logic - they move pixels and report which
 * panel / tab the user picked.
 *
 * @example
 * import { SwipeDeck, SegmentedTabs, AnimatedNumber, Reveal } from "@/components/motion";
 */

export { SwipeDeck, type SwipeDeckProps } from "./SwipeDeck";
export { SegmentedTabs, type SegmentedTabsProps, type SegmentedTab } from "./SegmentedTabs";
export { AnimatedNumber, type AnimatedNumberProps } from "./AnimatedNumber";
export { Reveal, type RevealProps } from "./Reveal";

/* the gesture engine, re-exported so a screen can drive its own layout */
export {
  useSwipeable,
  type UseSwipeableOptions,
  type UseSwipeableResult,
  type SwipeableHandlers,
} from "@/hooks/useSwipeable";
