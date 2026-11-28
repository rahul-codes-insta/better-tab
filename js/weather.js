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

// Current conditions, the rest of the day hour by hour, and the next days.
export async function fetchForecast(lat, lon, unit = 'celsius') {
  const u = new URL(FORECAST);
  u.searchParams.set('latitude', lat.toFixed(3));
  u.searchParams.set('longitude', lon.toFixed(3));
  u.searchParams.set('current', 'temperature_2m,weather_code,is_day,apparent_temperature,relative_humidity_2m,wind_speed_10m');
  u.searchParams.set('hourly', 'temperature_2m,weather_code,is_day,precipitation_probability');
  u.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_probability_max');
  u.searchParams.set('wind_speed_unit', unit === 'fahrenheit' ? 'mph' : 'kmh');
  u.searchParams.set('forecast_days', '7');
  u.searchParams.set('temperature_unit', unit === 'fahrenheit' ? 'fahrenheit' : 'celsius');
  u.searchParams.set('timezone', 'auto');
  const r = await fetch(u, { credentials: 'omit' });
  if (!r.ok) throw new Error('Weather unavailable');
  const j = await r.json();
  const c = j.current || {};
  const h = j.hourly || {};
  const d = j.daily || {};
  const hourly = (h.time || []).map((time, i) => ({
    time, temp: h.temperature_2m?.[i], code: h.weather_code?.[i] ?? 0, isDay: h.is_day?.[i] !== 0, rain: h.precipitation_probability?.[i] ?? null,
  }));
  const daily = (d.time || []).map((date, i) => ({
    date, code: d.weather_code?.[i] ?? 0,
    high: d.temperature_2m_max?.[i], low: d.temperature_2m_min?.[i],
    sunrise: d.sunrise?.[i], sunset: d.sunset?.[i], uv: d.uv_index_max?.[i] ?? null, rain: d.precipitation_probability_max?.[i] ?? null,
  }));
  return {
    temp: c.temperature_2m, code: c.weather_code ?? 0, isDay: c.is_day !== 0, hourly, daily,
    feels: c.apparent_temperature, humidity: c.relative_humidity_2m, wind: c.wind_speed_10m,
    windUnit: unit === 'fahrenheit' ? 'mph' : 'km/h',
  };
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


/* ---------------- colour icons (weather widget) ---------------- */
// Soft, filled icons in the system style: warm sun, pale moon, layered clouds, blue rain.
const C = {
  sun: '<circle cx="12" cy="12" r="5" fill="url(#wxSun)"/><g stroke="#FFC93C" stroke-width="1.8" stroke-linecap="round"><path d="M12 2.6v1.6M12 19.8v1.6M2.6 12h1.6M19.8 12h1.6M5.4 5.4l1.1 1.1M17.5 17.5l1.1 1.1M5.4 18.6l1.1-1.1M17.5 6.5l1.1-1.1"/></g>',
  moon: '<path d="M18.6 14.9A7.2 7.2 0 0 1 9.1 5.4a.6.6 0 0 0-.8-.7 8 8 0 1 0 11 11 .6.6 0 0 0-.7-.8z" fill="url(#wxMoon)"/>',
  smallSun: '<circle cx="9" cy="8.6" r="3.6" fill="url(#wxSun)"/><g stroke="#FFC93C" stroke-width="1.5" stroke-linecap="round"><path d="M9 2.4v1.2M2.8 8.6H4M4.6 4.2l.85.85M13.4 4.2l-.85.85"/></g>',
  smallMoon: '<path d="M13.4 9.6A4.8 4.8 0 0 1 7.1 3.3a.5.5 0 0 0-.6-.5 5.4 5.4 0 1 0 7.4 7.4.5.5 0 0 0-.5-.6z" fill="url(#wxMoon)"/>',
  cloud: (y = 0, back = false) => `<path transform="translate(0 ${y})" d="M7.2 18.5h9.9a3.9 3.9 0 0 0 .5-7.77 5.6 5.6 0 0 0-10.8 1.3A3.3 3.3 0 0 0 7.2 18.5z" fill="url(#${back ? 'wxCloudB' : 'wxCloud'})"/>`,
  drops: '<g stroke="#4FA9FF" stroke-width="1.9" stroke-linecap="round"><path d="M8.6 17.6l-1 2.6"/><path d="M12.4 17.6l-1 2.6"/><path d="M16.2 17.6l-1 2.6"/></g>',
};
const DEFS = '<defs>'
  + '<radialGradient id="wxSun" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="#FFE27A"/><stop offset="1" stop-color="#FFB627"/></radialGradient>'
  + '<linearGradient id="wxMoon" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFF6D8"/><stop offset="1" stop-color="#E4D7A8"/></linearGradient>'
  + '<linearGradient id="wxCloud" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#D9E2EA"/></linearGradient>'
  + '<linearGradient id="wxCloudB" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C9D3DD"/><stop offset="1" stop-color="#9FAEBC"/></linearGradient>'
  + '</defs>';
export function iconColor(code, isDay = true) {
  const k = kindOf(code);
  let b;
  switch (k) {
    case 'clear': b = isDay ? C.sun : C.moon; break;
    case 'partly': b = (isDay ? C.smallSun : C.smallMoon) + C.cloud(1); break;
    case 'cloudy': b = '<g transform="translate(3 -3) scale(.82)">' + C.cloud(0, true) + '</g>' + C.cloud(1); break;
    case 'fog': b = C.cloud(-3) + '<g stroke="#B9C6D2" stroke-width="1.7" stroke-linecap="round"><path d="M5 18.6h14M7.5 21.4h9"/></g>'; break;
    case 'drizzle': b = C.cloud(-3, true) + '<g fill="#4FA9FF"><circle cx="9" cy="18.6" r="1"/><circle cx="13" cy="18.6" r="1"/><circle cx="11" cy="21.4" r="1"/><circle cx="15" cy="21.4" r="1"/></g>'; break;
    case 'rain': b = C.cloud(-3, true) + C.drops; break;
    case 'snow': b = C.cloud(-3) + '<g fill="#BFE3FF"><circle cx="8.6" cy="18.6" r="1.3"/><circle cx="12.4" cy="20.6" r="1.3"/><circle cx="16.2" cy="18.6" r="1.3"/></g>'; break;
    case 'storm': b = C.cloud(-3, true) + '<path d="M12.8 15.2l-2.6 4h2.6l-1.6 4 4.2-5.4h-2.6l1.6-2.6z" fill="#FFD43B"/>'; break;
    default: b = C.cloud(0);
  }
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${DEFS}${b}</svg>`;
}
// The sky behind the default weather widget.
export function skyOf(code, isDay = true) {
  const k = kindOf(code);
  if (!isDay) return k === 'clear' || k === 'partly' ? 'night' : k === 'storm' ? 'storm' : 'night-cloud';
  return { clear: 'day', partly: 'day', cloudy: 'cloud', fog: 'cloud', drizzle: 'rain', rain: 'rain', snow: 'snow', storm: 'storm' }[k] || 'day';
}
