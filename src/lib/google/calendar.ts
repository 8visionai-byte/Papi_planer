import { prisma } from "@/lib/db/prisma";

export interface CalendarEvent {
  id: string;
  title: string;
  start: string; // ISO
  end: string; // ISO
  allDay: boolean;
  location?: string | null;
  description?: string | null;
  attendees?: string[];
  hangoutLink?: string | null;
}

export interface GetCalendarOptions {
  from?: Date;
  to?: Date;
}

export type CalendarFetchError =
  | "not_connected"
  | "missing_scope"
  | "refresh_failed"
  | "api_error"
  | "unknown";

export class CalendarError extends Error {
  code: CalendarFetchError;
  status?: number;
  constructor(code: CalendarFetchError, message: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const CAL_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
];

interface GoogleEventDateTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

interface GoogleEvent {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleEventDateTime;
  end?: GoogleEventDateTime;
  status?: string;
  hangoutLink?: string;
  attendees?: { email?: string; responseStatus?: string }[];
}

interface GoogleEventsResponse {
  items?: GoogleEvent[];
  error?: { code: number; message: string };
}

interface RefreshTokenResponse {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

function hasCalendarScope(scope: string | null | undefined): boolean {
  if (!scope) return false;
  const granted = scope.split(/\s+/);
  return CAL_SCOPES.some((s) => granted.includes(s));
}

async function refreshAccessToken(
  accountId: string,
  refreshToken: string,
): Promise<{ accessToken: string; expiresAt: number }> {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const json = (await res.json().catch(() => ({}))) as RefreshTokenResponse;

  if (!res.ok || !json.access_token) {
    throw new CalendarError(
      "refresh_failed",
      json.error_description || json.error || "Refresh token failed",
      res.status,
    );
  }

  const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 3600;
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;

  await prisma.account.update({
    where: { id: accountId },
    data: {
      access_token: json.access_token,
      expires_at: expiresAt,
      token_type: json.token_type ?? undefined,
      scope: json.scope ?? undefined,
    },
  });

  return { accessToken: json.access_token, expiresAt };
}

async function callGoogleEvents(
  accessToken: string,
  timeMin: string,
  timeMax: string,
): Promise<Response> {
  const url = new URL(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
  );
  url.searchParams.set("timeMin", timeMin);
  url.searchParams.set("timeMax", timeMax);
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "100");

  return fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
    // Disable Next data cache; we want fresh data.
    cache: "no-store",
  });
}

function parseEvent(ev: GoogleEvent): CalendarEvent | null {
  if (!ev.id) return null;
  if (ev.status === "cancelled") return null;

  const startRaw = ev.start?.dateTime ?? ev.start?.date ?? null;
  const endRaw = ev.end?.dateTime ?? ev.end?.date ?? null;
  if (!startRaw || !endRaw) return null;

  const allDay = !ev.start?.dateTime;
  // Normalise all-day to ISO at local midnight to avoid TZ confusion downstream.
  const start = allDay ? `${startRaw}T00:00:00` : startRaw;
  const end = allDay ? `${endRaw}T00:00:00` : endRaw;

  return {
    id: ev.id,
    title: ev.summary?.trim() || "(Bez tytułu)",
    start,
    end,
    allDay,
    location: ev.location ?? null,
    description: ev.description ?? null,
    hangoutLink: ev.hangoutLink ?? null,
    attendees: (ev.attendees ?? [])
      .map((a) => a.email)
      .filter((e): e is string => !!e),
  };
}

export async function getGoogleAccount(userId: string) {
  return prisma.account.findFirst({
    where: { userId, provider: "google" },
    select: {
      id: true,
      access_token: true,
      refresh_token: true,
      expires_at: true,
      scope: true,
    },
  });
}

export async function getCalendarEvents(
  userId: string,
  options: GetCalendarOptions = {},
): Promise<CalendarEvent[]> {
  const account = await getGoogleAccount(userId);
  if (!account) {
    throw new CalendarError("not_connected", "Brak połączonego konta Google");
  }
  if (!account.access_token && !account.refresh_token) {
    throw new CalendarError(
      "not_connected",
      "Brak tokenów dla konta Google — zaloguj się ponownie",
    );
  }
  if (!hasCalendarScope(account.scope)) {
    throw new CalendarError(
      "missing_scope",
      "Konto Google nie ma uprawnień do Kalendarza — połącz ponownie",
    );
  }

  const from = options.from ?? new Date();
  const to =
    options.to ?? new Date(from.getTime() + 24 * 60 * 60 * 1000);

  const timeMin = from.toISOString();
  const timeMax = to.toISOString();

  // Build a usable access token (refresh if expired or missing).
  const now = Math.floor(Date.now() / 1000);
  let accessToken = account.access_token ?? null;
  const expired =
    !accessToken ||
    (typeof account.expires_at === "number" && account.expires_at <= now + 30);

  if (expired) {
    if (!account.refresh_token) {
      throw new CalendarError(
        "refresh_failed",
        "Brak refresh_token — zaloguj się ponownie do Google",
      );
    }
    const refreshed = await refreshAccessToken(
      account.id,
      account.refresh_token,
    );
    accessToken = refreshed.accessToken;
  }

  let res = await callGoogleEvents(accessToken!, timeMin, timeMax);

  // On 401, try one refresh + retry.
  if (res.status === 401 && account.refresh_token) {
    const refreshed = await refreshAccessToken(
      account.id,
      account.refresh_token,
    );
    res = await callGoogleEvents(refreshed.accessToken, timeMin, timeMax);
  }

  const json = (await res.json().catch(() => ({}))) as GoogleEventsResponse;

  if (!res.ok) {
    throw new CalendarError(
      "api_error",
      json.error?.message || `Google API ${res.status}`,
      res.status,
    );
  }

  const items = json.items ?? [];
  const events: CalendarEvent[] = [];
  for (const ev of items) {
    const parsed = parseEvent(ev);
    if (parsed) events.push(parsed);
  }
  return events;
}

export async function getCalendarStatus(userId: string): Promise<{
  connected: boolean;
  scopes: string[];
  email?: string;
  hasRefreshToken: boolean;
  expiresAt: number | null;
}> {
  const account = await prisma.account.findFirst({
    where: { userId, provider: "google" },
    select: {
      scope: true,
      access_token: true,
      refresh_token: true,
      expires_at: true,
      user: { select: { email: true } },
    },
  });
  if (!account) {
    return { connected: false, scopes: [], hasRefreshToken: false, expiresAt: null };
  }
  const scopes = account.scope ? account.scope.split(/\s+/).filter(Boolean) : [];
  const connected =
    !!account.access_token && hasCalendarScope(account.scope);
  return {
    connected,
    scopes,
    email: account.user?.email ?? undefined,
    hasRefreshToken: !!account.refresh_token,
    expiresAt: account.expires_at ?? null,
  };
}

export async function disconnectGoogleCalendar(userId: string): Promise<void> {
  // Only clear Calendar-related scopes. We keep the Account row so login still works,
  // but blank out tokens to force re-consent on next /api/calendar use.
  const account = await prisma.account.findFirst({
    where: { userId, provider: "google" },
    select: { id: true, scope: true },
  });
  if (!account) return;
  const remaining = (account.scope ?? "")
    .split(/\s+/)
    .filter((s) => s && !CAL_SCOPES.includes(s))
    .join(" ");
  await prisma.account.update({
    where: { id: account.id },
    data: {
      access_token: null,
      refresh_token: null,
      expires_at: null,
      scope: remaining || null,
    },
  });
}
