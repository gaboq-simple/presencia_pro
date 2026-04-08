// ─── Google Calendar REST API adapter ─────────────────────────────────────────
// Pure fetch — no googleapis SDK. All side effects isolated here.
// Receives credentials as params — never reads env vars directly.
// Date objects are the canonical internal format; ISO strings are
// produced only at the API boundary (in this file).

import type { GoogleCredentials, BusyPeriod } from './types';

// ─── Constants ─────────────────────────────────────────────────────────────────

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';
const MAX_RETRY_ATTEMPTS = 3;

// ─── Retry helper ──────────────────────────────────────────────────────────────

/**
 * Retries an async operation with exponential backoff on rate-limiting errors.
 * Only retries on HTTP 429 (Too Many Requests) — other errors propagate immediately.
 */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: Error = new Error('Retry failed');

  for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof RateLimitError) {
        lastError = err;
        // Exponential backoff: 1s, 2s, 4s
        await new Promise((resolve) => setTimeout(resolve, 1_000 * 2 ** attempt));
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

class RateLimitError extends Error {
  constructor() {
    super('Google Calendar API rate limit exceeded');
    this.name = 'RateLimitError';
  }
}

// ─── Token refresh ─────────────────────────────────────────────────────────────

interface TokenResponse {
  readonly access_token: string;
  readonly expires_in: number;
  readonly token_type: string;
}

/**
 * Exchanges a refresh token for a short-lived access token.
 * Always fetches a fresh token — no in-memory cache (stateless engine).
 * Throws with a clear message if refresh fails — never silences auth errors.
 */
export async function getAccessToken(credentials: GoogleCredentials): Promise<string> {
  const body = new URLSearchParams({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    refresh_token: credentials.refreshToken,
    grant_type: 'refresh_token',
  });

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Google token refresh failed (${response.status}): ${text}. ` +
        'Check GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN.',
    );
  }

  const data = (await response.json()) as TokenResponse;
  return data.access_token;
}

// ─── FreeBusy ──────────────────────────────────────────────────────────────────

interface FreeBusyRequest {
  readonly timeMin: string;
  readonly timeMax: string;
  readonly timeZone: string;
  readonly items: ReadonlyArray<{ readonly id: string }>;
}

interface FreeBusyResponse {
  readonly calendars: Record<
    string,
    { readonly busy: ReadonlyArray<{ readonly start: string; readonly end: string }> }
  >;
}

/**
 * Returns busy periods for a calendar within the given time range.
 * Efficient alternative to getCalendarEvents for availability checking —
 * returns only start/end timestamps, not full event details.
 */
export async function getFreeBusy(
  calendarId: string,
  from: Date,
  to: Date,
  timezone: string,
  accessToken: string,
): Promise<readonly BusyPeriod[]> {
  return withRetry(async () => {
    const requestBody: FreeBusyRequest = {
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      timeZone: timezone,
      items: [{ id: calendarId }],
    };

    const response = await fetch(`${CALENDAR_BASE}/freeBusy`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (response.status === 429) throw new RateLimitError();

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Google FreeBusy failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as FreeBusyResponse;
    const calendarData = data.calendars[calendarId];
    if (!calendarData) return [];

    return calendarData.busy.map((b) => ({ start: b.start, end: b.end }));
  });
}

// ─── Calendar Events ───────────────────────────────────────────────────────────

/** A Google Calendar event returned by the Events.list API */
export interface GoogleCalendarEvent {
  readonly id: string;
  readonly summary: string;
  readonly start: { readonly dateTime: string; readonly timeZone?: string };
  readonly end: { readonly dateTime: string; readonly timeZone?: string };
  readonly status: string;
  readonly visibility?: string;
}

interface EventsListResponse {
  readonly items: ReadonlyArray<GoogleCalendarEvent>;
  readonly nextPageToken?: string;
}

/**
 * Returns all events in a calendar within the given time range.
 * Use getFreeBusy when you only need availability — it's cheaper.
 * Use getCalendarEvents when you need full event details.
 */
export async function getCalendarEvents(params: {
  readonly calendarId: string;
  readonly from: Date;
  readonly to: Date;
  readonly accessToken: string;
}): Promise<readonly GoogleCalendarEvent[]> {
  return withRetry(async () => {
    const url = new URL(
      `${CALENDAR_BASE}/calendars/${encodeURIComponent(params.calendarId)}/events`,
    );
    url.searchParams.set('timeMin', params.from.toISOString());
    url.searchParams.set('timeMax', params.to.toISOString());
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('orderBy', 'startTime');

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${params.accessToken}` },
    });

    if (response.status === 429) throw new RateLimitError();

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Google Calendar events list failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as EventsListResponse;
    return data.items ?? [];
  });
}

// ─── Create event ──────────────────────────────────────────────────────────────

export interface CreateEventParams {
  readonly calendarId: string;
  readonly title: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly timezone: string;
  readonly accessToken: string;
  readonly description?: string;
  /**
   * 'private' — event is hidden from shared/public views; doctor still sees it.
   * Used for emergency blocked slots — patients never see them.
   * Defaults to 'default' if omitted.
   */
  readonly visibility?: 'default' | 'private';
}

interface CalendarEventResponse {
  readonly id: string;
  readonly status: string;
}

/**
 * Creates a Google Calendar event and returns the event ID.
 * Dates are Date objects — conversion to ISO string happens here at the API boundary.
 */
export async function createCalendarEvent(params: CreateEventParams): Promise<string> {
  return withRetry(async () => {
    const body: Record<string, unknown> = {
      summary: params.title,
      start: { dateTime: params.startsAt.toISOString(), timeZone: params.timezone },
      end: { dateTime: params.endsAt.toISOString(), timeZone: params.timezone },
    };

    if (params.description) body['description'] = params.description;
    if (params.visibility) body['visibility'] = params.visibility;

    const response = await fetch(
      `${CALENDAR_BASE}/calendars/${encodeURIComponent(params.calendarId)}/events`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${params.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );

    if (response.status === 429) throw new RateLimitError();

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Google Calendar createEvent failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as CalendarEventResponse;
    return data.id;
  });
}

// ─── Cancel event ──────────────────────────────────────────────────────────────

/**
 * Cancels (deletes) a Google Calendar event by event ID.
 * If the event is already deleted (410 Gone), the error is swallowed — idempotent.
 */
export async function cancelCalendarEvent(params: {
  readonly calendarId: string;
  readonly eventId: string;
  readonly accessToken: string;
}): Promise<void> {
  return withRetry(async () => {
    const response = await fetch(
      `${CALENDAR_BASE}/calendars/${encodeURIComponent(params.calendarId)}/events/${encodeURIComponent(params.eventId)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${params.accessToken}` },
      },
    );

    if (response.status === 429) throw new RateLimitError();

    // 204 No Content = success. 410 Gone = already deleted — both are acceptable.
    if (!response.ok && response.status !== 410) {
      const text = await response.text();
      throw new Error(`Google Calendar cancelEvent failed (${response.status}): ${text}`);
    }
  });
}
