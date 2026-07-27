const CONFIG = {
  resource: 'AS219443',
  registeredAt: '2026-06-12T15:49:25Z',
  sourceapp: 'ascl-sh',

  requestTimeoutMs: 8000,
  cacheTtlMs: 60 * 60 * 1000,
  registryTtlMs: 6 * 60 * 60 * 1000,
  cachePrefix: 'ascl:v1:',
};

const RIPESTAT = 'https://stat.ripe.net/data';

function readCache(key) {
  try {
    const raw = localStorage.getItem(CONFIG.cachePrefix + key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry || typeof entry.t !== 'number') return null;
    return entry;
  } catch {
    return null;
  }
}

function writeCache(key, payload) {
  try {
    localStorage.setItem(CONFIG.cachePrefix + key, JSON.stringify({ t: Date.now(), payload }));
  } catch {
    return;
  }
}

async function fetchJson(url, { cacheKey, ttl }) {
  const cached = readCache(cacheKey);
  const fresh = cached && Date.now() - cached.t < ttl;
  if (fresh) return { data: cached.payload, stale: false, age: Date.now() - cached.t };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.requestTimeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const body = await response.json();
    if (body?.status !== 'ok') throw new Error(`status ${body?.status}`);

    writeCache(cacheKey, body);
    return { data: body, stale: false, age: 0 };
  } catch {
    if (cached) return { data: cached.payload, stale: true, age: Date.now() - cached.t };
    return { data: null, stale: false, age: 0 };
  } finally {
    clearTimeout(timer);
  }
}

function ripestat(call, params = {}) {
  const url = new URL(`${RIPESTAT}/${call}/data.json`);
  url.searchParams.set('resource', CONFIG.resource);
  url.searchParams.set('sourceapp', CONFIG.sourceapp);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

const $ = (id) => document.getElementById(id);

function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

function replaceChildren(el, nodes) {
  el.textContent = '';
  for (const node of nodes) el.appendChild(node);
}

function nowIso() {
  return new Date().toISOString().slice(0, 19);
}

export function currentPrefixes(body) {
  const latest = body?.data?.latest_time;
  const prefixes = body?.data?.prefixes || [];
  if (!latest) return [];

  return prefixes
    .filter((entry) => entry.timelines?.some((timeline) => timeline.endtime === latest))
    .map((entry) => entry.prefix);
}

function expandIpv6(address) {
  let groups;
  if (address.includes('::')) {
    const [head, tail = ''] = address.split('::');
    const headGroups = head ? head.split(':') : [];
    const tailGroups = tail ? tail.split(':') : [];
    const missing = 8 - headGroups.length - tailGroups.length;
    groups = [...headGroups, ...Array(Math.max(0, missing)).fill('0'), ...tailGroups];
  } else {
    groups = address.split(':');
  }
  return groups.map((group) => group.padStart(4, '0')).join('');
}

export function sortPrefixes(prefixes) {
  const key = (prefix) => {
    const [address, length] = prefix.split('/');
    const isV6 = prefix.includes(':');
    const value = isV6
      ? expandIpv6(address)
      : address
          .split('.')
          .map((octet) => octet.padStart(3, '0'))
          .join('');
    return [isV6 ? 1 : 0, value, Number(length) || 0];
  };

  return [...prefixes].sort((a, b) => {
    const [familyA, valueA, lengthA] = key(a);
    const [familyB, valueB, lengthB] = key(b);
    if (familyA !== familyB) return familyA - familyB;
    if (valueA !== valueB) return valueA < valueB ? -1 : 1;
    return lengthA - lengthB;
  });
}

export function prefixCounts(prefixes) {
  let v4 = 0;
  let v6 = 0;

  for (const prefix of prefixes) {
    const length = Number(prefix.split('/')[1]);
    if (!Number.isFinite(length)) continue;
    if (prefix.includes(':')) v6 += 2 ** (48 - length);
    else v4 += 2 ** (24 - length);
  }

  return { v4: Math.round(v4 * 100) / 100, v6: Math.round(v6 * 100) / 100 };
}

export function formatWhois(records) {
  const grouped = new Map();

  for (const record of records || []) {
    for (const field of record || []) {
      const values = grouped.get(field.key) || [];
      values.push(field.value);
      grouped.set(field.key, values);
    }
  }

  const lines = [];
  for (const [key, values] of grouped) {
    lines.push([`${key}:`.padEnd(16, ' '), values[0]]);
    for (const value of values.slice(1)) lines.push([' '.repeat(16), value]);
  }
  return lines;
}

function relativeTime(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

function renderUptime() {
  const el = $('uptime-value');
  if (!el) return;

  const since = new Date(CONFIG.registeredAt).getTime();
  if (!Number.isFinite(since)) return;

  const tick = () => {
    const seconds = Math.floor(Math.max(0, Date.now() - since) / 1000);
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor(seconds / 3600) % 24;
    const minutes = Math.floor(seconds / 60) % 60;
    const pad = (n) => String(n).padStart(2, '0');
    el.textContent = `${days}d ${pad(hours)}h ${pad(minutes)}m ${pad(seconds % 60)}s`;
  };

  tick();
  setInterval(tick, 1000);
}

function renderPrefixes(prefixes, latestTime) {
  const tbody = $('prefix-rows');
  if (!tbody || !prefixes.length) return;

  const rows = prefixes.map((prefix) => {
    const tr = document.createElement('tr');

    const prefixCell = document.createElement('td');
    prefixCell.className = 'prefix';
    prefixCell.appendChild(document.createTextNode(prefix));

    const descr = document.createElement('span');
    descr.className = 'prefix-descr';
    descr.dataset.prefix = prefix;
    prefixCell.appendChild(descr);

    const rpkiCell = document.createElement('td');
    rpkiCell.className = 'rpki';
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.dataset.prefix = prefix;
    badge.dataset.state = 'pending';
    badge.textContent = 'rpki …';
    rpkiCell.appendChild(badge);

    tr.append(prefixCell, rpkiCell);
    return tr;
  });

  replaceChildren(tbody, rows);

  const counts = prefixCounts(prefixes);
  setText('ipv4-count', String(counts.v4));
  setText('ipv6-count', String(counts.v6));

  if (latestTime) {
    setText('prefix-caption', `seen by ripe ris at ${latestTime.replace('T', ' ')} utc`);
  }
}

function renderWhois(records) {
  const el = $('whois-records');
  const lines = formatWhois(records);
  if (!el || !lines.length) return;

  const fragment = document.createDocumentFragment();

  for (const [key, value] of lines) {
    const keySpan = document.createElement('span');
    keySpan.className = 'key';
    keySpan.textContent = key;
    fragment.appendChild(keySpan);

    for (const chunk of String(value).split(/(AS\d+)/g)) {
      if (!chunk) continue;
      const span = document.createElement('span');
      span.className = /^AS\d+$/.test(chunk) ? 'asn' : 'val';
      span.textContent = chunk;
      fragment.appendChild(span);
    }

    fragment.appendChild(document.createTextNode('\n'));
  }

  el.classList.remove('is-error');
  replaceChildren(el, [fragment]);
}

function renderStatus(body) {
  const visibility = body?.data?.visibility;
  if (!visibility) return;

  const v4 = visibility.v4 || {};
  const v6 = visibility.v6 || {};
  const seen = (v4.ris_peers_seeing || 0) + (v6.ris_peers_seeing || 0);

  const dot = $('status-dot');
  if (dot) dot.dataset.state = seen > 0 ? 'up' : 'down';
  setText('status-value', seen > 0 ? 'announced' : 'not visible');
}

async function fillRpki(prefix) {
  const url = ripestat('rpki-validation', { prefix });
  const { data } = await fetchJson(url, { cacheKey: `rpki:${prefix}`, ttl: CONFIG.registryTtlMs });
  const status = data?.data?.status;

  const badge = document.querySelector(`.badge[data-prefix="${CSS.escape(prefix)}"]`);
  if (!badge) return;

  if (!status) {
    badge.dataset.state = 'unknown';
    badge.textContent = 'rpki n/a';
    return;
  }

  badge.dataset.state = status === 'valid' ? 'valid' : status === 'unknown' ? 'unknown' : 'invalid';
  badge.textContent = `rpki ${status.replace('_', ' ')}`;
}

export function inetnumLabel(records) {
  let descr = '';
  let netname = '';

  for (const record of records || []) {
    for (const field of record || []) {
      if (field.key === 'descr' && !descr) descr = String(field.value).trim();
      if (field.key === 'netname' && !netname) netname = String(field.value).trim();
    }
  }

  if (descr) return descr;
  if (netname && !/^ORG-/i.test(netname)) return netname;
  return '';
}

async function fillDescr(prefix) {
  const url = ripestat('whois', { resource: prefix });
  const { data } = await fetchJson(url, { cacheKey: `whois:${prefix}`, ttl: CONFIG.registryTtlMs });
  if (!data) return;

  const label = inetnumLabel(data?.data?.records);
  const element = document.querySelector(`.prefix-descr[data-prefix="${CSS.escape(prefix)}"]`);
  if (element) element.textContent = label;
}

async function enrichPrefixes(prefixes) {
  for (const prefix of prefixes) {
    await Promise.all([fillRpki(prefix), fillDescr(prefix)]);
  }
}

function renderFreshness(entries) {
  const el = $('freshness');
  if (!el) return;

  const stale = entries.filter((entry) => entry.stale);
  const failed = entries.filter((entry) => !entry.data);

  if (failed.length === entries.length) {
    el.textContent = 'live data unavailable · showing last known values';
    return;
  }
  if (stale.length) {
    const oldest = Math.max(...stale.map((entry) => entry.age || 0));
    el.textContent = `cached · fetched ${relativeTime(oldest)}`;
    return;
  }

  const oldest = Math.max(...entries.map((entry) => entry.age || 0));
  el.textContent = oldest < 60000 ? 'fetched just now' : `fetched ${relativeTime(oldest)}`;
}

async function main() {
  renderUptime();

  const requests = [
    fetchJson(ripestat('announced-prefixes', { starttime: nowIso() }), {
      cacheKey: 'announced-prefixes',
      ttl: CONFIG.cacheTtlMs,
    }),
    fetchJson(ripestat('whois'), { cacheKey: 'whois', ttl: CONFIG.cacheTtlMs }),
    fetchJson(ripestat('routing-status'), { cacheKey: 'routing-status', ttl: CONFIG.cacheTtlMs }),
  ];

  const [announced, whois, routing] = await Promise.all(requests);

  const prefixes = sortPrefixes(currentPrefixes(announced.data));
  if (prefixes.length) renderPrefixes(prefixes, announced.data?.data?.latest_time);
  else setText('prefix-empty', announced.data ? 'none announced' : 'unavailable');
  if (whois.data) renderWhois(whois.data?.data?.records);
  if (routing.data) renderStatus(routing.data);

  renderFreshness([announced, whois, routing]);

  if (announced.stale || whois.stale || routing.stale) {
    document.querySelector('.panel')?.classList.add('is-stale');
  }

  if (prefixes.length) {
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 200));
    idle(() => enrichPrefixes(prefixes));
  }
}

if (typeof document !== 'undefined') {
  main();
}
