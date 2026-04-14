const EARNINGS_CACHE_KEY = 'options-screener-earnings-cache';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 1 day

interface EarningsCacheEntry {
  date: string;
  timestamp: number;
}

function getCache(): Record<string, EarningsCacheEntry> {
  try {
    return JSON.parse(localStorage.getItem(EARNINGS_CACHE_KEY) || '{}');
  } catch {
    return {};
  }
}

function setCache(cache: Record<string, EarningsCacheEntry>) {
  localStorage.setItem(EARNINGS_CACHE_KEY, JSON.stringify(cache));
}

export async function getNextEarningsDate(
  ticker: string,
  finnhubToken: string,
): Promise<string> {
  if (!finnhubToken) return '';

  // Check cache first
  const cache = getCache();
  const entry = cache[ticker.toUpperCase()];
  if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
    return entry.date;
  }

  try {
    const today = new Date().toISOString().split('T')[0];
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 90);
    const to = futureDate.toISOString().split('T')[0];

    const url = `https://finnhub.io/api/v1/calendar/earnings?symbol=${ticker.toUpperCase()}&from=${today}&to=${to}&token=${finnhubToken}`;
    const res = await fetch(url);
    if (!res.ok) return '';

    const data = await res.json();
    const earnings = data.earningsCalendar;
    if (!earnings || earnings.length === 0) return '';

    // Find the next future earnings date
    const nextDate = earnings
      .map((e: { date: string }) => e.date)
      .filter((d: string) => d >= today)
      .sort()[0] || '';

    // Cache it
    cache[ticker.toUpperCase()] = { date: nextDate, timestamp: Date.now() };
    setCache(cache);

    return nextDate;
  } catch {
    return '';
  }
}
