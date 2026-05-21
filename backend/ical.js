/**
 * ical.js
 * Parses iCal feed URLs and returns structured event data.
 *
 * Configuration: add any number of ICAL_URL_* keys to .env
 *   ICAL_URL_1=https://bc.instructure.com/...       → source: "canvas_college"
 *   ICAL_URL_2=https://lwsd414.instructure.com/...  → source: "canvas_school"
 *
 * Source tagging:
 *   bc.instructure     → canvas_college
 *   lwsd414.instructure → canvas_school
 *   (any other)        → ical_N (1-based index of the env key)
 *
 * Priority flagging: events with exam/test/quiz/due/deadline/final/midterm/
 *   assignment/project/submit in the title → flagged: true, suggestedRank: "Admiral"
 *
 * Exports:
 *   parseAllIcalFeeds()         → merged, sorted, deduplicated array (cached 4h)
 *   getTodayFromIcal()          → { school: [], college: [], flagged: [] }
 *   getUpcomingFromIcal(days=7) → sorted by date, flagged first
 */

require('dotenv').config();
const ical  = require('node-ical');
const cache = require('./cache');

const CACHE_KEY = 'ical_feeds_all';
const CACHE_TTL = 14400; // 4 hours

const PRIORITY_KEYWORDS = [
  'exam', 'test', 'quiz', 'homework', 'due', 'deadline', 'final',
  'midterm', 'assignment', 'project', 'submit',
];

/** Infer a human-readable source tag from the URL. */
function sourceFromUrl(url, index) {
  if (url.includes('bc.instructure'))      return 'canvas_college';
  if (url.includes('lwsd414.instructure')) return 'canvas_school';
  return `ical_${index + 1}`;
}

/** Returns true if the event title matches a priority keyword. */
function isPriority(title = '') {
  const lower = title.toLowerCase();
  return PRIORITY_KEYWORDS.some((kw) => lower.includes(kw));
}

/** Collect all ICAL_URL_* keys from process.env, in order. */
function getIcalUrls() {
  const entries = Object.entries(process.env)
    .filter(([key]) => /^ICAL_URL_\d+$/i.test(key))
    .sort(([a], [b]) => {
      const na = parseInt(a.replace(/\D/g, ''), 10);
      const nb = parseInt(b.replace(/\D/g, ''), 10);
      return na - nb;
    });
  return entries.map(([, url]) => url.trim()).filter(Boolean);
}

/**
 * Fetches and parses a single iCal URL.
 * Returns an array of all upcoming events (not just today).
 */
async function fetchIcalUrl(url, source) {
  const data   = await ical.async.fromURL(url);
  const events = [];

  for (const key of Object.keys(data)) {
    const event = data[key];
    if (event.type !== 'VEVENT') continue;

    const start = event.start ? new Date(event.start) : null;
    const end   = event.end   ? new Date(event.end)   : null;
    if (!start) continue;

    const title     = event.summary || '(No title)';
    const flagged   = isPriority(title);
    const recurring = !!(event.rrule || event.recurrenceid);

    events.push({
      title,
      start:        start.toISOString(),
      end:          end ? end.toISOString() : null,
      description:  event.description || '',
      location:     event.location    || '',
      url:          event.url         || '',
      allDay:       !!(event.datetype === 'date'),
      source,
      flagged,
      recurring,
      suggestedRank: flagged ? 'Admiral' : null,
    });
  }

  events.sort((a, b) => new Date(a.start) - new Date(b.start));
  return events;
}

/**
 * Fetches all configured iCal feeds, merges, deduplicates, and sorts.
 * Caches result for 4 hours.
 */
async function parseAllIcalFeeds() {
  const cached = cache.get(CACHE_KEY);
  if (cached) {
    console.log('[ical] Returning cached feeds');
    return cached;
  }

  const urls = getIcalUrls();
  if (urls.length === 0) {
    console.log('[ical] No ICAL_URL_* keys found in .env');
    return [];
  }

  const results = await Promise.allSettled(
    urls.map((url, i) => fetchIcalUrl(url, sourceFromUrl(url, i)))
  );

  const allEvents = [];
  const seen = new Set();

  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      for (const ev of result.value) {
        // Dedup by title + start
        const key = `${ev.title}|${ev.start}`;
        if (!seen.has(key)) {
          seen.add(key);
          allEvents.push(ev);
        }
      }
    } else {
      console.error(`[ical] Failed to fetch URL #${i + 1}:`, result.reason?.message);
    }
  });

  allEvents.sort((a, b) => new Date(a.start) - new Date(b.start));
  cache.set(CACHE_KEY, allEvents, CACHE_TTL);
  return allEvents;
}

/**
 * Returns today's events split by source.
 * { school: [], college: [], flagged: [] }
 */
async function getTodayFromIcal() {
  const all   = await parseAllIcalFeeds();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const todayEvents = all.filter((ev) => {
    const start = new Date(ev.start);
    const end   = ev.end ? new Date(ev.end) : start;
    return start < tomorrow && end >= today;
  });

  return {
    school:  todayEvents.filter((ev) => ev.source === 'canvas_school'),
    college: todayEvents.filter((ev) => ev.source === 'canvas_college'),
    flagged: todayEvents.filter((ev) => ev.flagged),
  };
}

/**
 * Returns events in the next N days, flagged items first.
 */
async function getUpcomingFromIcal(days = 7) {
  const all     = await parseAllIcalFeeds();
  const now     = new Date();
  const cutoff  = new Date(now.getTime() + days * 86_400_000);

  const upcoming = all.filter((ev) => {
    const start = new Date(ev.start);
    return start >= now && start <= cutoff;
  });

  // Flagged first, then chronological
  upcoming.sort((a, b) => {
    if (a.flagged && !b.flagged) return -1;
    if (!a.flagged && b.flagged) return 1;
    return new Date(a.start) - new Date(b.start);
  });

  return upcoming;
}

// Legacy export — kept for backward compat with calendar.js
async function getAllIcalEvents() {
  return getTodayFromIcal().then(({ school, college }) => [...school, ...college]);
}

module.exports = {
  parseAllIcalFeeds,
  getTodayFromIcal,
  getUpcomingFromIcal,
  getAllIcalEvents,
};
