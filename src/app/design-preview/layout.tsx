import type { Metadata } from "next";

/**
 * /design-preview is public (see PUBLIC_PATHS in src/middleware.ts) so the owner
 * can open it on his phone without logging in. Public also means crawlable: this
 * layout keeps the unfinished design lab out of Google, so it can never show up
 * next to the real product under the brand domain.
 *
 * It only adds metadata. No wrapper markup, no styles, no behaviour change.
 */
export const metadata: Metadata = {
  title: "Podglad kierunku wizualnego — PAPI PLANER",
  robots: { index: false, follow: false, nocache: true },
};

export default function DesignPreviewLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
