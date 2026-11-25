// Weather from Open-Meteo (free, no API key): current conditions + city search.

const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';

export async function fetchCurrent(lat, lon, unit = 'celsius') {
  const u = new URL(FORECAST);
  u.searchParams.set('latitude', lat.toFixed(3));
  u.searchParams.set('longitude', lon.toFixed(3));
  u.searchParams.set('current', 'temperature_2m,weather_code,is_day');
  u.searchParams.set('temperature_unit', unit === 'fahrenheit' ? 'fahrenheit' : 'celsius');
  u.searchParams.set('timezone', 'auto');
  const r = await fetch(u, { credentials: 'omit' });
  if (!r.ok) throw new Error('Weather unavailable');
  const j = await r.json();
  const c = j.current || {};
  if (typeof c.temperature_2m !== 'number') throw new Error('Weather unavailable');
  return { temp: c.temperature_2m, code: c.weather_code ?? 0, isDay: c.is_day !== 0 };
}

export async function searchCities(query) {
  const u = new URL(GEOCODE);
  u.searchParams.set('name', query.trim());
  u.searchParams.set('count', '6');
  u.searchParams.set('language', (navigator.language || 'en').split('-')[0]);
  u.searchParams.set('format', 'json');
  const r = await fetch(u, { credentials: 'omit' });
  if (!r.ok) throw new Error('Search failed');
  const j = await r.json();
  return (j.results || []).map((x) => ({
    name: x.name,
    detail: [x.admin1, x.country].filter(Boolean).join(', '),
    lat: x.latitude,
    lon: x.longitude,
  }));
}

export function currentPosition(timeout = 8000) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Location not available'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => reject(new Error('Location not available')),
      { timeout, maximumAge: 30 * 60 * 1000 },
    );
  });
}

/* ---------- WMO weather codes ---------- */

export function kindOf(code) {
  if (code === 0) return 'clear';
  if (code === 1 || code === 2) return 'partly';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'storm';
  return 'cloudy';
}

const LABEL = {
  clear: 'Clear', partly: 'Partly cloudy', cloudy: 'Cloudy', fog: 'Fog',
  drizzle: 'Drizzle', rain: 'Rain', snow: 'Snow', storm: 'Thunderstorm',
};
export const describe = (code) => LABEL[kindOf(code)];

const CLOUD = 'M7.2 18.5h9.9a3.9 3.9 0 0 0 .5-7.77 5.6 5.6 0 0 0-10.8 1.3A3.3 3.3 0 0 0 7.2 18.5z';
const CLOUD_UP = 'M7.2 15h9.9a3.9 3.9 0 0 0 .5-7.77 5.6 5.6 0 0 0-10.8 1.3A3.3 3.3 0 0 0 7.2 15z';
const SUN_RAYS = 'M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4';
const MOON = 'M19.5 14.6A8 8 0 0 1 9.4 4.5a.6.6 0 0 0-.8-.7 8.6 8.6 0 1 0 11.6 11.6.6.6 0 0 0-.7-.8z';

export function iconSvg(code, isDay = true) {
  const k = kindOf(code);
  let body;
  switch (k) {
    case 'clear':
      body = isDay
        ? `<circle cx="12" cy="12" r="4.2"/><path d="${SUN_RAYS}"/>`
        : `<path d="${MOON}"/>`;
      break;
    case 'partly':
      body = (isDay
        ? '<circle cx="9" cy="8.5" r="3.2"/><path d="M9 2.6v1.3M3.1 8.5h1.3M4.8 4.3l.9.9M13.2 4.3l-.9.9"/>'
        : '<path d="M13.6 9.2A5 5 0 0 1 7.3 2.9a.5.5 0 0 0-.6-.5 5.6 5.6 0 0 0 7.4 7.4.5.5 0 0 0-.5-.6z"/>')
        + `<path d="${CLOUD}" fill="var(--wx-fill, rgba(14,26,30,.55))"/>`;
      break;
    case 'cloudy': body = `<path d="${CLOUD}"/>`; break;
    case 'fog': body = `<path d="${CLOUD_UP}"/><path d="M5 18.5h14M7 21.5h10"/>`; break;
    case 'drizzle': body = `<path d="${CLOUD_UP}"/><path d="M9 18.5v.6M13 18.5v.6M11 21v.6M15 21v.6"/>`; break;
    case 'rain': body = `<path d="${CLOUD_UP}"/><path d="M8.5 17.5l-1 3M12.5 17.5l-1 3M16.5 17.5l-1 3"/>`; break;
    case 'snow': body = `<path d="${CLOUD_UP}"/><path d="M8.5 18.5h.01M12 20.5h.01M15.5 18.5h.01M10 22h.01M14 22h.01" stroke-width="2.6"/>`; break;
    case 'storm': body = `<path d="${CLOUD_UP}"/><path d="M12.5 15.5l-2 3.5h3l-2 3.5"/>`; break;
  }
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}
