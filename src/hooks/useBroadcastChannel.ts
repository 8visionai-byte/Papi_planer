"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Cross-page / cross-tab messaging via native BroadcastChannel API.
 *
 * @param channelName  Name of the channel (e.g. "papicoach:diet")
 * @param onMessage    Optional listener invoked for every received message
 * @returns            `post` function used to broadcast a message to other listeners
 *
 * Falls back gracefully when BroadcastChannel is not available (returns a no-op post).
 */
export function useBroadcastChannel(
  channelName: string,
  onMessage?: (data: unknown) => void
): (data: unknown) => void {
  const channelRef = useRef<BroadcastChannel | null>(null);
  const onMessageRef = useRef(onMessage);

  // Keep latest listener reference without re-creating the channel.
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (typeof BroadcastChannel === "undefined") return;

    const channel = new BroadcastChannel(channelName);
    channelRef.current = channel;

    const handler = (event: MessageEvent) => {
      onMessageRef.current?.(event.data);
    };
    channel.addEventListener("message", handler);

    return () => {
      channel.removeEventListener("message", handler);
      channel.close();
      channelRef.current = null;
    };
  }, [channelName]);

  const post = useCallback((data: unknown) => {
    channelRef.current?.postMessage(data);
  }, []);

  return post;
}
