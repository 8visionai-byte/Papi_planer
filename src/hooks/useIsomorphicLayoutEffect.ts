"use client";

/**
 * `useLayoutEffect` on the client, `useEffect` on the server.
 *
 * Client components are still rendered on the server by Next, and React logs a
 * warning for every `useLayoutEffect` it meets there. The motion components need
 * layout timing (measure, then paint - no flash), so they use this instead.
 */

import { useEffect, useLayoutEffect } from "react";

export const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export default useIsomorphicLayoutEffect;
