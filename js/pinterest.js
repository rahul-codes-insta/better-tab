// Pinterest for the Pinterest widget.
//
// Pins always come from Pinterest's public RSS feeds (newest pins first, ~25 per feed).
// Which feeds:
//   - Links:   public accounts or boards you paste in. No sign-in.
//   - Account: sign in with your own Pinterest developer app; we read the people and
//              boards you follow and show their newest pins. (Pinterest's API has no
//              home feed, so this is the closest thing to "new pins for me".)
// The sign-in token stays in this browser's extension storage and is left out of backups.
import * as store from './store.js';

const AUTH_KEY = 'pinterest:auth';            // { appId, secret, token, refresh, expiresAt, username }
const FOLLOW_KEY = 'pinterest:following';     // { at, feeds: [{ feed, label }] }
const FEED_TTL = 10 * 60 * 1000;              // re-download a feed at most every 10 minutes
const FOLLOW_TTL = 6 * 60 * 60 * 1000;        // re-read who you follow every 6 hours
const MAX_FEEDS = 15;                         // feeds read per refresh in account mode
const API = 'https://api.pinterest.com/v5';
const SCOPES = 'user_accounts:read,boards:read,pins:read';

const feedCache = new Map();                  // feed url -> { at, pins }

/* ---------------- links → feeds ---------------- */

/** "user", "@user", "user/board", or a pinterest.com profile / board link → { feed, label } (null if it isn't one). */
export function toFeed(input) {
  let s = String(input || '').trim().replace(/^@/, '');
  if (!s) return null;
  let parts;
  if (/pinterest\.|^https?:/i.test(s)) {
    let u;
    try { u = new URL(/^https?:/i.test(s) ? s : 'https://' + s); } catch { return null; }
    if (!/(^|\.)pinterest\.[a-z.]+$/i.test(u.hostname)) return null;
    parts = u.pathname.split('/').filter(Boolean);
  } else {
    parts = s.split('/').filter(Boolean);
  }
  parts = parts.map((p) => p.replace(/\.rss$/i, '')).filter((p) => p !== 'feed');
  const [user, board] = parts;
  if (!user || !/^[\w.-]+$/.test(user) || ['pin', 'search', 'ideas', 'today', 'business'].includes(user.toLowerCase())) return null;
  if (board && !/^[\w%.-]+$/.test(board)) return null;
  return board
    ? { feed: `https://www.pinterest.com/${user}/${board}.rss`, label: `${user}/${decodeURIComponent(board)}` }
    : { feed: `https://www.pinterest.com/${user}/feed.rss`, label: `@${user}` };
}

/* ---------------- reading feeds ---------------- */

async function readFeed({ feed, label }, force = false) {
  const hit = feedCache.get(feed);
  if (hit && !force && Date.now() - hit.at < FEED_TTL) return hit.pins;
  const res = await fetch(feed, { credentials: 'omit', cache: 'no-store' });
  if (!res.ok) throw new Error(`${label}: ${res.status}`);
  const xml = new DOMParser().parseFromString(await res.text(), 'text/xml');
  if (xml.querySelector('parsererror')) throw new Error(`${label}: not a feed`);
  const pins = [...xml.querySelectorAll('item')].map((it) => {
    const get = (t) => it.querySelector(t)?.textContent?.trim() || '';
    const desc = get('description');
    const src = /<img[^>]+src="([^"]+)"/i.exec(desc)?.[1] || '';
    return {
      link: get('link') || get('guid'),
      title: get('title').slice(0, 140),
      // Feeds carry small 236px images; ask for the 474px version instead.
      img: src.replace(/\/(\d+x|\d+x\d+(_RS)?)\//, '/474x/'),
      date: Date.parse(get('pubDate')) || 0,
      source: label,
    };
  }).filter((p) => p.link && p.img);
  feedCache.set(feed, { at: Date.now(), pins });
  return pins;
}

/** Newest pins across feeds, without duplicates. */
export async function loadPins(feeds, { max = 9, force = false } = {}) {
  const results = await Promise.allSettled(feeds.map((f) => readFeed(f, force)));
  const failed = feeds.filter((_, i) => results[i].status === 'rejected').map((f) => f.label);
  const seen = new Set();
  const pins = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    .sort((a, b) => b.date - a.date)
    .filter((p) => (seen.has(p.link) ? false : seen.add(p.link)))
    .slice(0, max);
  return { pins, failed };
}

/* ---------------- sign-in (your own Pinterest app) ---------------- */

export const canSignIn = () => typeof chrome !== 'undefined' && !!chrome.identity?.launchWebAuthFlow;
export const redirectUrl = () => (canSignIn() ? chrome.identity.getRedirectURL('pinterest') : '');

export async function getAuth() { return (await store.get(AUTH_KEY))[AUTH_KEY] || {}; }
async function setAuth(a) { await store.set({ [AUTH_KEY]: a }); }
export const isSignedIn = async () => !!(await getAuth()).token;

async function tokenRequest(auth, params) {
  const res = await fetch(`${API}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + btoa(`${auth.appId}:${auth.secret}`),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error(j.message || `Pinterest said no (${res.status})`);
  return {
    ...auth,
    token: j.access_token,
    refresh: j.refresh_token || auth.refresh,
    expiresAt: Date.now() + (j.expires_in || 2592000) * 1000 - 60000,
  };
}

/** Opens Pinterest's sign-in window. Returns the username. */
export async function signIn(appId, secret) {
  if (!canSignIn()) throw new Error('Sign-in works when BetterTab runs as a Chrome extension.');
  appId = String(appId || '').trim();
  secret = String(secret || '').trim();
  if (!appId || !secret) throw new Error('Add your app’s ID and secret first.');
  const state = crypto.getRandomValues(new Uint32Array(2)).join('');
  const url = new URL('https://www.pinterest.com/oauth/');
  url.search = new URLSearchParams({ client_id: appId, redirect_uri: redirectUrl(), response_type: 'code', scope: SCOPES, state });
  const back = new URL(await chrome.identity.launchWebAuthFlow({ url: url.href, interactive: true }));
  if (back.searchParams.get('state') !== state) throw new Error('Sign-in was interrupted. Try again.');
  const code = back.searchParams.get('code');
  if (!code) throw new Error(back.searchParams.get('error_description') || 'Sign-in was cancelled.');
  let auth = await tokenRequest({ appId, secret }, { grant_type: 'authorization_code', code, redirect_uri: redirectUrl() });
  await setAuth(auth);
  const me = await api('/user_account');
  auth = { ...(await getAuth()), username: me.username || '' };
  await setAuth(auth);
  await store.remove(FOLLOW_KEY);
  return auth.username;
}

export async function signOut() {
  const { appId, secret } = await getAuth();
  await setAuth({ appId, secret }); // keep the app details so signing in again is one click
  await store.remove(FOLLOW_KEY);
}

async function api(path, retried = false) {
  let auth = await getAuth();
  if (!auth.token) throw new Error('Not signed in.');
  if (auth.expiresAt && Date.now() > auth.expiresAt && auth.refresh) {
    auth = await tokenRequest(auth, { grant_type: 'refresh_token', refresh_token: auth.refresh });
    await setAuth(auth);
  }
  const res = await fetch(API + path, { headers: { Authorization: `Bearer ${auth.token}` } });
  if (res.status === 401 && !retried && auth.refresh) {
    await setAuth(await tokenRequest(auth, { grant_type: 'refresh_token', refresh_token: auth.refresh }));
    return api(path, true);
  }
  if (res.status === 401) { await signOut(); throw new Error('Your Pinterest sign-in expired. Sign in again.'); }
  if (!res.ok) throw new Error(`Pinterest error ${res.status}`);
  return res.json();
}

const slug = (name) => String(name).toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Feeds for the people and boards you follow (cached for a few hours). */
export async function followingFeeds({ force = false } = {}) {
  const cached = (await store.get(FOLLOW_KEY))[FOLLOW_KEY];
  if (cached && !force && Date.now() - cached.at < FOLLOW_TTL) return cached.feeds;
  const [people, boards] = await Promise.allSettled([
    api('/user_account/following?page_size=50'),
    api('/user_account/following/boards?page_size=50'),
  ]);
  if (people.status === 'rejected' && boards.status === 'rejected') throw people.reason;
  const feeds = [];
  for (const u of people.value?.items || []) if (u.username) feeds.push(toFeed(u.username));
  for (const b of boards.value?.items || []) if (b.owner?.username && b.name) feeds.push(toFeed(`${b.owner.username}/${slug(b.name)}`));
  const list = feeds.filter(Boolean);
  await store.set({ [FOLLOW_KEY]: { at: Date.now(), feeds: list } });
  return list;
}

/** Up to MAX_FEEDS of the feeds you follow, a different slice each refresh so everyone gets a turn. */
export async function accountFeeds(opts) {
  const all = await followingFeeds(opts);
  if (all.length <= MAX_FEEDS) return all;
  const start = Math.floor(Date.now() / (30 * 60 * 1000)) % all.length;
  return [...all, ...all].slice(start, start + MAX_FEEDS);
}
