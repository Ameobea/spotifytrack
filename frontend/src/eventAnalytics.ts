const ENDPOINT = 'https://osu-api-bridge.ameo.dev/a/z';
const SALT = '4rW9XKHcEKa6bolWry8k0LGW';
const PROJECT = 'spotifytrack';

interface AnalyticsEvent {
  category: string;
  subcategory: string;
  payload?: unknown;
}

const genSessionID = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
};

const getSessionID = (): string => {
  try {
    const existing = sessionStorage.getItem('analyticsSessionID');
    if (existing) {
      return existing;
    }
    const id = genSessionID();
    sessionStorage.setItem('analyticsSessionID', id);
    return id;
  } catch (_err) {
    return genSessionID();
  }
};

const sessionID = getSessionID();

let queue: AnalyticsEvent[] = [];
let flushTimer: number | null = null;

const flush = async () => {
  const events = queue;
  queue = [];

  try {
    const hashInput = new TextEncoder().encode(
      events.map(evt => evt.category + evt.subcategory).join('') + SALT
    );
    const digest = await crypto.subtle.digest('SHA-256', hashInput);
    const verification = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');

    await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events, verification, project: PROJECT, session_id: sessionID }),
      keepalive: true,
    });
  } catch (_err) {
    // analytics must never break the app
  }
};

export const logEvent = (category: string, subcategory = '', payload?: unknown) => {
  if (window.location.host.includes('localhost')) {
    console.debug('[analytics]', category, subcategory, payload);
    return;
  }

  queue.push(payload === undefined ? { category, subcategory } : { category, subcategory, payload });
  if (flushTimer === null) {
    flushTimer = window.setTimeout(() => {
      flushTimer = null;
      void flush();
    }, 800);
  }
};

window.addEventListener('pagehide', () => {
  if (queue.length) {
    void flush();
  }
});
