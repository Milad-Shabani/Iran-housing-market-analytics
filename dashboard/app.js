/* Iran Housing Market Analytics - dashboard engine.
   Hand-built SVG maps and charts, no dependencies. Everything the page shows is in
   window.__DATA__ (built by scripts/run_pipeline.py). */
(() => {
'use strict';
const D = window.__DATA__, T = window.__T__, L = window.__LANG__, TX = window.__TEXT__[window.__LANG__];
const FA = L === 'fa';
const NS = 'http://www.w3.org/2000/svg';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

// ------------------------------------------------------------------ DOM helpers
function svg(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
function h(tag, attrs = {}, kids = []) {
  const e = document.createElement(tag);
  for (const k in attrs) {
    if (k === 'text') e.textContent = attrs[k];
    else if (k === 'cls') e.className = attrs[k];
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
    else if (attrs[k] != null) e.setAttribute(k, attrs[k]);
  }
  for (const c of [].concat(kids)) if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
}
function text(parent, x, y, s, cls, attrs = {}) { const t = svg('text', Object.assign({ x, y, class: cls }, attrs), parent); t.textContent = s; return t; }
const clear = e => { while (e.firstChild) e.removeChild(e.firstChild); return e; };

// ------------------------------------------------------------------ formatting
const LOC = FA ? 'fa-IR' : 'en-US';
const fmtCache = {};
function nf(x, d = 0, opts = {}) {
  if (x == null || !isFinite(x)) return '–';
  const key = d + JSON.stringify(opts);
  if (!fmtCache[key]) fmtCache[key] = new Intl.NumberFormat(LOC, Object.assign({ minimumFractionDigits: d, maximumFractionDigits: d }, opts));
  return fmtCache[key].format(x);
}
const iso = s => '⁨' + s + '⁩';               // bidi isolate for numbers inside RTL text
const yr = y => nf(y, 0, { useGrouping: false });
const Mv = (x, d) => x == null ? '–' : nf(x / 1e6, d != null ? d : (x / 1e6 >= 100 ? 0 : 1));
const Bv = x => x == null ? '–' : nf(x / 1e9, x / 1e9 >= 100 ? 0 : x / 1e9 >= 10 ? 1 : 2);
const pct = (x, d = 0) => x == null ? '–' : nf(x, d, { style: 'percent', maximumFractionDigits: d });
const spct = (x, d = 0) => x == null ? '–' : nf(x, d, { style: 'percent', signDisplay: 'exceptZero', maximumFractionDigits: d });
const mult = (x, d = 2) => x == null ? '–' : '×' + nf(x, d);
const MEN = ['Farvardin', 'Ordibehesht', 'Khordad', 'Tir', 'Mordad', 'Shahrivar', 'Mehr', 'Aban', 'Azar', 'Dey', 'Bahman', 'Esfand'];
const MFA = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
const tJ = t => [1395 + Math.floor(t / 12), (t % 12) + 1];
const mLabel = (y, m) => FA ? `${MFA[m - 1]} ${yr(y)}` : `${MEN[m - 1]} ${y}`;
const tLabel = t => mLabel(...tJ(t));
const gregShort = iso8601 => { const d = new Date(iso8601 + 'T00:00:00'); return d.toLocaleDateString(FA ? 'en-US' : 'en-US', { month: 'short', year: 'numeric' }); };
const unitM = T.u_m, unitB = T.u_b;

// names
const hoodName = hd => (FA && hd.fa) ? hd.fa : hd.en;
const cityName = c => (FA && c.fa) ? c.fa : c.en;
const provName = p => FA ? p.fa : p.en;
const distName = d => `${T.district} ${nf(d)}`;

// ------------------------------------------------------------------ data indexes
const DIST = D.tehran.districts, HOODS = D.tehran.hoods;
const DBY = Object.fromEntries(DIST.map(d => [d.d, d]));
const HBY = Object.fromEntries(HOODS.map(x => [x.s, x]));
const PROV = D.iran.provinces, CITIES = D.iran.cities;
const PBY = Object.fromEntries(PROV.map(p => [p.iso, p]));
const CBY = Object.fromEntries(CITIES.map(c => [c.s, c]));
const TEHRAN_MED = D.meta.tehran_median_2024, NAT_MED = D.meta.national_median_2024;
const TEH_CITY = CBY['tehran'];
const V = D.valuation.browser;
const MONTHS = D.series.months;
const lastCbi = MONTHS[D.series.last_cbi], lastKil = MONTHS[D.series.last_kilid];
const cbiYoY = t => { const a = MONTHS[t], b = MONTHS[t - 12]; return a && b && a.cbi && b.cbi ? a.cbi / b.cbi - 1 : null; };
const KILID_ROLL = D.forecast.kilid_last / TEH_CITY.p - 1;   // Kilid (1405/05) vs Divar Tehran median (1403)
const G_LONG = Math.expm1(12 * D.forecast.g_long), G_KIL = Math.expm1(12 * D.forecast.g_kilid);

// ------------------------------------------------------------------ periods (the year bar)
// Every figure belongs to one period. rec(o, y) returns an object's figures for year y (same
// short keys in every period) or null, so an indicator without data for that year shows "–".
const LIVE = D.meta.divar_1405 || null;
const liveDate = () => {
  if (!LIVE) return '';
  const j = LIVE.collected_on_jalali;
  if (!j) return LIVE.collected_on;
  return FA ? `${nf(j[2])} ${MFA[j[1] - 1]} ${yr(j[0])}` : `${j[2]} ${MEN[j[1] - 1]} ${j[0]}`;
};
const liveGreg = () => LIVE ? new Date(LIVE.collected_on + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '';
const MAP_YEARS = LIVE ? [1400, 1403, 1405] : [1400, 1403];
const YEARS = Array.from({ length: 11 }, (_, i) => 1395 + i);
const PER = {
  1400: { lab: FA ? 'حدود ۱۴۰۰' : 'c. 1400', src: FA ? `نمونه‌ی ${nf(D.meta.listings_2021)} آگهی دیوار` : `Divar sample, ${nf(D.meta.listings_2021)} ads` },
  1403: { lab: FA ? '۱۴۰۳' : '1403', src: FA ? `${nf(D.meta.tehran_listings_located)} آگهی دیوار` : `${nf(D.meta.tehran_listings_located)} Divar ads` },
};
if (LIVE) PER[1405] = { lab: liveDate(), src: FA ? `${nf(LIVE.ads_used)} آگهی دیوار` : `${nf(LIVE.ads_used)} Divar ads, collected ${liveGreg()}` };
const pLab = y => PER[y] ? PER[y].lab : yr(y);
const span2 = (a, b) => FA ? `${pLab(a)} تا ${pLab(b)}` : `${pLab(a)} → ${pLab(b)}`;
const prevYear = y => { const i = MAP_YEARS.indexOf(y); return i > 0 ? MAP_YEARS[i - 1] : null; };
function rec(o, y) {
  if (!o) return null;
  if (y === 1403) return o.p != null ? o : null;
  if (y === 1405) return o.y5 || null;
  if (y === 1400) return o.y0 && o.y0.p != null ? o.y0 : null;
  return null;
}
const val = (o, k, y) => { const r = rec(o, y); return r && r[k] != null ? r[k] : null; };
const growth = (o, y) => { const b = prevYear(y), a = val(o, 'p', y), c = b ? val(o, 'p', b) : null; return a && c ? a / c : null; };
function wq(pairs, q = 0.5) {   // listing-weighted quantile, same interpolation as the Python pipeline
  const v = pairs.filter(([x, w]) => x != null && w > 0).sort((a, b) => a[0] - b[0]);
  if (!v.length) return null;
  const tot = v.reduce((s, p) => s + p[1], 0), target = q * tot;
  let cum = 0, prev = null;
  for (const [x, w] of v) { const c = cum + w / 2; if (c >= target) return prev ? prev[0] + (x - prev[0]) * (target - prev[1]) / (c - prev[1] || 1) : x; prev = [x, c]; cum += w; }
  return v[v.length - 1][0];
}
const TMED = { 1400: D.meta.tehran_median_2021, 1403: TEHRAN_MED };
if (LIVE) TMED[1405] = LIVE.tehran_median_ppm2;
const TYP = {};   // typical listing price and size, listing-weighted over neighbourhoods
[1403, 1405].forEach(y => { const hs = HOODS.filter(x => rec(x, y)); if (hs.length) TYP[y] = { pm: wq(hs.map(x => [val(x, 'pm', y), val(x, 'n', y)])), sz: wq(hs.map(x => [val(x, 'sz', y), val(x, 'n', y)])) }; });
const lastIn = (y, k) => MONTHS.filter(m => m.y === y && m[k] != null).pop() || null;
const noData = y => FA ? `برای ${pLab(y)} داده نداریم` : `no data for ${pLab(y)}`;
const rankOf = (d, y) => { const v = val(d, 'p', y); return v == null ? null : DIST.filter(o => (val(o, 'p', y) || 0) > v).length + 1; };
const nRanked = y => DIST.filter(o => val(o, 'p', y) != null).length;

// ------------------------------------------------------------------ colour
const RAMP = {
  blue: ['#d7e7fb', '#a9cdf5', '#6da7ec', '#3987e5', '#1c5cab', '#0d366b'],
  orange: ['#fde3d6', '#f9bfa3', '#f39a70', '#eb6834', '#c24f1f', '#8f3712'],
  teal: ['#d3f1e6', '#a3e0ca', '#63c7a3', '#1baf7a', '#138a5f', '#0b5e41'],
};
const NODATA = '#ecebe6';
function quantileBreaks(vals, k = 6) {
  const v = vals.filter(x => x != null && isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return [];
  const br = [];
  for (let i = 1; i < k; i++) br.push(v[Math.min(v.length - 1, Math.floor(i * v.length / k))]);
  return Array.from(new Set(br));
}
function makeScale(vals, ramp) {
  const br = quantileBreaks(vals, ramp.length);
  const cols = ramp.slice(ramp.length - br.length - 1);
  const f = x => { if (x == null || !isFinite(x)) return NODATA; let i = 0; while (i < br.length && x >= br[i]) i++; return cols[i]; };
  f.breaks = br; f.colors = cols;
  f.bin = x => { if (x == null || !isFinite(x)) return -1; let i = 0; while (i < br.length && x >= br[i]) i++; return i; };
  return f;
}
const inkOn = hex => { const n = parseInt(hex.slice(1), 16); const r = n >> 16, g = (n >> 8) & 255, b = n & 255; return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#0b0b0b' : '#ffffff'; };

// ------------------------------------------------------------------ tooltip
const tip = $('#tip');
function showTip(ev, title, rows = [], foot) {
  clear(tip);
  tip.appendChild(h('div', { cls: 't', text: title }));
  for (const r of rows) {
    if (r.sep) { tip.appendChild(h('div', { cls: 'sep', text: r.sep === true ? '' : r.sep })); continue; }
    const row = h('div', { cls: 'r' + (r.b ? ' on' : '') });
    const lab = h('span');
    if (r.c) lab.appendChild(h('i', { cls: 'k', style: `background:${r.c}` }));
    lab.appendChild(document.createTextNode(r.k));
    row.appendChild(lab);
    row.appendChild(h('b', { text: r.v }));
    tip.appendChild(row);
  }
  if (foot) tip.appendChild(h('div', { cls: 'm', text: foot }));
  tip.classList.add('on');
  moveTip(ev);
}
function moveTip(ev) {
  const pad = 14, w = tip.offsetWidth, hh = tip.offsetHeight;
  let x = ev.clientX + pad, y = ev.clientY + pad;
  if (x + w > innerWidth - 8) x = ev.clientX - w - pad;
  if (y + hh > innerHeight - 8) y = ev.clientY - hh - pad;
  tip.style.left = Math.max(8, x) + 'px'; tip.style.top = Math.max(8, y) + 'px';
}
const hideTip = () => tip.classList.remove('on');
function focusTip(node, fn) {  // keyboard: same tooltip on focus
  node.setAttribute('tabindex', '0');
  node.addEventListener('focus', () => { const b = node.getBoundingClientRect(); fn({ clientX: b.left + b.width / 2, clientY: b.top + b.height / 2 }); });
  node.addEventListener('blur', hideTip);
}

// ------------------------------------------------------------------ zoom/pan for map SVGs
function zoomable(svgEl, g, box, onZoom) {
  const vb = svgEl.viewBox.baseVal;
  const st = { k: 1, x: 0, y: 0 };
  const apply = () => { g.setAttribute('transform', `translate(${st.x},${st.y}) scale(${st.k})`); onZoom && onZoom(st.k); };
  const clamp = () => {
    st.k = Math.max(1, Math.min(10, st.k));
    st.x = Math.min(0, Math.max(vb.width * (1 - st.k), st.x));
    st.y = Math.min(0, Math.max(vb.height * (1 - st.k), st.y));
  };
  const toSvg = (cx, cy) => { const p = svgEl.createSVGPoint(); p.x = cx; p.y = cy; return p.matrixTransform(svgEl.getScreenCTM().inverse()); };
  const zoomAt = (px, py, f) => { const k2 = Math.max(1, Math.min(10, st.k * f)); st.x = px - (px - st.x) * k2 / st.k; st.y = py - (py - st.y) * k2 / st.k; st.k = k2; clamp(); apply(); };
  svgEl.addEventListener('wheel', ev => {
    if (!ev.ctrlKey && !ev.metaKey && st.k === 1 && ev.deltaY > 0) return;   // let the page scroll
    ev.preventDefault(); const p = toSvg(ev.clientX, ev.clientY); zoomAt(p.x, p.y, ev.deltaY < 0 ? 1.25 : 0.8);
  }, { passive: false });
  let drag = null; st.moved = false;
  svgEl.addEventListener('pointerdown', ev => { if (ev.button !== 0) return; drag = { x: ev.clientX, y: ev.clientY, sx: st.x, sy: st.y }; st.moved = false; });
  addEventListener('pointermove', ev => {
    if (!drag) return; const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
    if (!st.moved && Math.hypot(dx, dy) < 4) return;
    st.moved = true; svgEl.classList.add('dragging'); hideTip();
    const s = vb.width / svgEl.getBoundingClientRect().width;
    st.x = drag.sx + dx * s; st.y = drag.sy + dy * s; clamp(); apply();
  });
  addEventListener('pointerup', () => { drag = null; svgEl.classList.remove('dragging'); setTimeout(() => { st.moved = false; }, 0); });
  box.querySelectorAll('.zoom button').forEach(b => b.addEventListener('click', () => {
    const z = b.dataset.z; if (z === 'reset') { st.k = 1; st.x = 0; st.y = 0; apply(); return; }
    zoomAt(vb.width / 2, vb.height / 2, z === 'in' ? 1.5 : 1 / 1.5);
  }));
  st.focus = (x, y, k) => { st.k = k; st.x = vb.width / 2 - x * k; st.y = vb.height / 2 - y * k; clamp(); apply(); };
  return st;
}

// ------------------------------------------------------------------ shared state
const S = {
  scope: { type: 'tehran' }, year: LIVE ? 1405 : 1403,
  tMetric: 'p', tLayer: 'd', budgetOn: false, budget: 8e9, bSize: 75, legendBin: null,
  iMetric: 'p', iCities: false,
  hood: 'saadat-abad', area: 90, rooms: 2, parking: 1, storage: 1, elevator: 1, roll: 0,
  fScale: 'log', fMethod: D.forecast.best, fG: G_LONG, mMode: 'adj',
};

// ================================================================== KPI strip
function kpi(label, value, unit, sub, opts = {}) {
  const k = h('div', { cls: 'kpi' + (opts.hero ? ' hero-kpi' : '') + (opts.spark ? ' has-spark' : '') + (opts.na ? ' na' : '') });
  const right = h('span', { cls: 'lab-r' });
  if (opts.when) right.appendChild(h('span', { cls: 'when', text: opts.when }));
  if (opts.info) right.appendChild(h('span', { cls: 'info', title: opts.info, text: 'i' }));
  k.appendChild(h('div', { cls: 'lab' }, [h('span', { text: label }), right]));
  const v = h('div', { cls: 'val' }, [iso(value)]);
  if (unit) { v.appendChild(document.createTextNode(' ')); v.appendChild(h('small', { text: unit })); }
  k.appendChild(v);
  if (sub) { const s = h('div', { cls: 'sub' }); if (typeof sub === 'string') s.textContent = sub; else s.appendChild(sub); k.appendChild(s); }
  if (opts.spark) k.appendChild(opts.spark);
  return k;
}
function spark(vals, color = '#2a78d6') {
  const w = 74, hh = 26, e = svg('svg', { width: w, height: hh, class: 'spark', viewBox: `0 0 ${w} ${hh}`, 'aria-hidden': 'true' });
  const v = vals.filter(x => x != null); if (v.length < 2) return e;
  const lo = Math.min(...v), hi = Math.max(...v);
  const pts = vals.map((x, i) => x == null ? null : [i / (vals.length - 1) * (w - 4) + 2, hh - 3 - (x - lo) / (hi - lo || 1) * (hh - 6)]).filter(Boolean);
  svg('path', { d: 'M' + pts.map(p => p.join(',')).join('L'), fill: 'none', stroke: color, 'stroke-width': 1.6, 'stroke-linejoin': 'round' }, e);
  const l = pts[pts.length - 1]; svg('circle', { cx: l[0], cy: l[1], r: 2.6, fill: color }, e);
  return e;
}
function deltaSpan(x, fmt = spct) { return h('span', { cls: x >= 0 ? 'delta-up' : 'delta-dn', text: iso(fmt(x)) }); }

function renderKPIs() {
  const box = clear($('#kpis')), sc = S.scope, y = S.year, P = pLab(y), py = prevYear(y);
  const na = (label, why, when = P) => kpi(label, '–', '', why || noData(y), { na: true, when });
  const c = lastIn(y, 'cbi'), k = lastIn(y, 'kil'), k0 = MONTHS.find(m => m.kil != null);
  const city = sc.type === 'province' ? (FA ? ' · تهران' : ' · Tehran') : '';
  const cbiTile = c ? kpi(T.k_cbi + city, Mv(c.cbi), unitM, cbiYoY(c.t) != null ? h('span', {}, [deltaSpan(cbiYoY(c.t)), FA ? ' نسبت به سال قبل' : ' vs a year earlier']) : '',
      { when: tLabel(c.t), spark: spark(MONTHS.filter(m => m.t > c.t - 36 && m.t <= c.t).map(m => m.cbi)), info: FA ? 'میانگین قیمت هر متر در معاملات ثبت‌شده‌ی تهران (بانک مرکزی)، آخرین ماه منتشرشده‌ی همین سال.' : 'Mean price per m² of registered Tehran transactions (Central Bank of Iran), last published month of this year.' })
    : na(T.k_cbi + city, FA ? 'بانک مرکزی برای این سال منتشر نکرده' : 'not published for this year', yr(y));
  const kilTile = k ? kpi(T.k_kilid + city, Mv(k.kil), unitM, k.t > k0.t ? h('span', {}, [deltaSpan(k.kil / k0.kil - 1), (FA ? ' نسبت به ' : ' vs ') + tLabel(k0.t)]) : '',
      { when: tLabel(k.t), spark: spark(MONTHS.filter(m => m.kil != null && m.t <= k.t).map(m => m.kil), '#eb6834'), info: FA ? 'شاخص آگهی کیلید برای کل تهران، آخرین ماه همین سال. قیمت پیشنهادی است، نه معامله.' : "Kilid's Tehran-wide listing indicator, last month of this year. Asking prices, not transactions." })
    : na(T.k_kilid + city, FA ? 'کیلید فقط ۱۴۰۴ و ۱۴۰۵ را دارد' : 'Kilid covers 1404–1405 only', yr(y));
  const chg = (a, b) => (a != null && b != null)
    ? kpi(T.k_growth, mult(a / b), '', h('span', {}, [deltaSpan(a / b - 1), ` · ${FA ? 'از' : 'from'} ${Mv(b)} ${T.u_m_short}`]), { when: span2(py, y) })
    : na(T.k_growth, py ? noData(a == null ? y : py) : (FA ? 'دوره‌ی قبلی نداریم' : 'no earlier period'), py ? span2(py, y) : P);
  let tiles = [];
  if (sc.type === 'tehran') {
    const v = TMED[y], t = TYP[y];
    tiles = [
      v != null ? kpi(T.k_ppm2, Mv(v), unitM, PER[y].src, { hero: true, when: P }) : na(T.k_ppm2, FA ? 'آگهی تهران برای این سال نداریم' : 'no Tehran listings for this year'),
      chg(v ?? null, py ? TMED[py] : null),
      y === 1403 ? kpi(T.k_vsn, mult(v / NAT_MED, 1), '', FA ? `میانه‌ی کشور: ${Mv(NAT_MED)} ${unitM}` : `national median: ${Mv(NAT_MED)} ${unitM}`, { when: P })
                 : na(T.k_vsn, FA ? 'میانه‌ی کشور فقط برای ۱۴۰۳' : 'national median exists for 1403 only'),
      t ? kpi(T.k_price, Bv(t.pm), unitB, FA ? `متراژ معمول ${nf(t.sz)} متر` : `typical size ${nf(t.sz)} m²`, { when: P }) : na(T.k_price),
      cbiTile, kilTile];
  } else if (sc.type === 'district') {
    const d = DBY[sc.d], r = rec(d, y);
    tiles = [
      r ? kpi(T.k_ppm2, Mv(r.p), unitM, FA ? `رتبه‌ی ${nf(rankOf(d, y))} از ${nf(nRanked(y))} · ${nf(r.n)} آگهی` : `rank ${rankOf(d, y)} of ${nRanked(y)} · ${nf(r.n)} ads`, { hero: true, when: P }) : na(T.k_ppm2),
      r && TMED[y] ? kpi(T.k_vs, spct(r.p / TMED[y] - 1), '', FA ? `میانه‌ی تهران ${Mv(TMED[y])}` : `Tehran median ${Mv(TMED[y])} M`, { when: P }) : na(T.k_vs),
      chg(val(d, 'p', y), py ? val(d, 'p', py) : null),
      r && r.pm ? kpi(T.k_price, Bv(r.pm), unitB, (FA ? `متراژ معمول ${nf(r.sz)} متر` : `typical ${nf(r.sz)} m²`) + (r.by ? (FA ? ` · ساخت ${yr(Math.round(r.by))}` : ` · built ${Math.round(r.by)}`) : ''), { when: P }) : na(T.k_price),
      cbiTile, kilTile];
  } else if (sc.type === 'hood') {
    const x = HBY[sc.s], d = DBY[x.d], r = rec(x, y), dr = rec(d, y);
    tiles = [
      r ? kpi(T.k_ppm2, Mv(r.p), unitM, r.p25 ? (FA ? `۵۰٪ میانی ${Mv(r.p25)}–${Mv(r.p75)} · ${nf(r.n)} آگهی` : `middle 50%: ${Mv(r.p25)}–${Mv(r.p75)} M · ${nf(r.n)} ads`) : '', { hero: true, when: P }) : na(T.k_ppm2),
      r && dr ? kpi(FA ? 'نسبت به منطقه' : 'vs its district', spct(r.p / dr.p - 1), '', FA ? `${distName(x.d)}: ${Mv(dr.p)}` : `${distName(x.d)}: ${Mv(dr.p)} M`, { when: P }) : na(FA ? 'نسبت به منطقه' : 'vs its district'),
      chg(val(x, 'p', y), py ? val(x, 'p', py) : null),
      r && r.pm ? kpi(T.k_price, Bv(r.pm), unitB, (FA ? `متراژ معمول ${nf(r.sz)} متر` : `typical ${nf(r.sz)} m²`) + (r.r != null ? (FA ? ` · ${nf(r.r)} اتاق` : ` · ${r.r} bed`) : ''), { when: P }) : na(T.k_price),
      cbiTile, kilTile];
  } else if (sc.type === 'province') {
    const p = PBY[sc.iso], why = FA ? 'داده‌ی استانی فقط برای ۱۴۰۳' : 'province data exist for 1403 only';
    const big = FA ? 'بزرگ‌ترین بازار استان' : 'Largest market';
    tiles = (y === 1403 && p.p != null) ? [
      kpi(T.k_ppm2, Mv(p.p), unitM, FA ? `رتبه‌ی ${nf(p.rank)} از ۳۱ · ${nf(p.n)} آگهی` : `rank ${p.rank} of 31 · ${nf(p.n)} ads`, { hero: true, when: P }),
      kpi(T.k_vsn, spct(p.vs), '', FA ? `میانه‌ی کشور ${Mv(NAT_MED)}` : `national median ${Mv(NAT_MED)} M`, { when: P }),
      kpi(T.k_price, Bv(p.pm), unitB, FA ? `متراژ معمول ${nf(p.sz)} متر` : `typical ${nf(p.sz)} m²`, { when: P }),
      kpi(big, cityName(CBY[p.big] || { en: p.big }), '', FA ? `${Mv(p.bigp)} ${unitM} · ${pct(p.bigsh)} آگهی‌ها` : `${Mv(p.bigp)} ${unitM} · ${pct(p.bigsh)} of ads`, { when: P }),
      cbiTile, kilTile] : [na(T.k_ppm2, why), na(T.k_vsn, why), na(T.k_price, why), na(big, why), cbiTile, kilTile];
  }
  tiles.forEach(t => box.appendChild(t));
  renderScopeChip();
}
function renderScopeChip() {
  const c = clear($('#scopeChip')), sc = S.scope;
  let label = T.tehran_all;
  if (sc.type === 'district') label = distName(sc.d);
  if (sc.type === 'hood') label = `${hoodName(HBY[sc.s])} · ${distName(HBY[sc.s].d)}`;
  if (sc.type === 'province') label = `${T.province} ${provName(PBY[sc.iso])}`;
  c.appendChild(h('span', { text: label }));
  if (sc.type !== 'tehran') c.appendChild(h('button', { title: T.scope_reset, 'aria-label': T.scope_reset, text: '×', onclick: () => setScope({ type: 'tehran' }) }));
  const w = clear($('#scopeWhen'));
  w.appendChild(h('span', { text: pLab(S.year) }));
}
function setScope(sc) {
  S.scope = sc;
  renderKPIs(); renderTehranMap(); renderTehranSide(); renderRank(); renderCatch(); renderIranMap(); renderIranSide();
}

// ================================================================== Tehran map
const T_METRICS = {
  p: { label: T.m_p, ramp: 'blue', fmt: v => Mv(v) + ' ' + T.u_m_short, legend: v => Mv(v) },
  g: { label: T.m_g, ramp: 'orange', fmt: v => mult(v), legend: v => mult(v, 2) },
  pm: { label: T.m_pm, ramp: 'blue', fmt: v => Bv(v) + ' ' + unitB, legend: v => Bv(v) },
  sz: { label: T.m_sz, ramp: 'teal', fmt: v => nf(v) + ' ' + T.u_sqm, legend: v => nf(v) },
  by: { label: T.m_by, ramp: 'teal', fmt: v => yr(Math.round(v)), legend: v => yr(Math.round(v)) },
  el: { label: T.m_el, ramp: 'teal', fmt: v => pct(v), legend: v => pct(v) },
  pk: { label: T.m_pk, ramp: 'teal', fmt: v => pct(v), legend: v => pct(v) },
  n: { label: T.m_n, ramp: 'teal', fmt: v => nf(v), legend: v => nf(v) },
};
const mval = (o, k, y) => k === 'g' ? growth(o, y) : val(o, k, y);
const mTitle = (m, key, y) => key === 'g' ? `${m.label} · ${prevYear(y) ? span2(prevYear(y), y) : pLab(y)}` : `${m.label} · ${pLab(y)}`;
const tSvg = $('#tMap');
tSvg.setAttribute('viewBox', `0 0 ${D.tehran.w} ${D.tehran.h}`);
const tG = svg('g', {}, tSvg);
const tDistG = svg('g', {}, tG), tHoodG = svg('g', {}, tG), tLabG = svg('g', {}, tG);
const tZoom = zoomable(tSvg, tG, $('#tMapBox'), k => {
  tHoodG.querySelectorAll('circle').forEach(c => c.setAttribute('r', +c.dataset.r / Math.pow(k, 0.75)));
  tLabG.querySelectorAll('text').forEach(t => t.setAttribute('font-size', 11 / Math.pow(k, 0.8)));
});
const hoodR = n => 2.2 + Math.sqrt(n) * 0.19;
function hoodPriceFor(x, size) {
  const r = rec(x, S.year); if (!r) return null;
  const A0 = r.sz || x.sz || 85; return r.p * A0 * Math.exp(V.b_area * (Math.log(size) - Math.log(A0)));
}
function affordClass(x) { const p = hoodPriceFor(x, S.bSize); return p == null ? null : p <= S.budget ? 0 : p <= S.budget * 1.2 ? 1 : 2; }
const AFF_COL = ['#0ca30c', '#fab219', '#c9c7bf'];

DIST.forEach(d => {
  const p = svg('path', { d: d.path, class: 'dist', 'data-d': d.d }, tDistG);
  p.addEventListener('pointermove', ev => distTip(ev, d));
  p.addEventListener('pointerleave', hideTip);
  p.addEventListener('click', () => { if (!tZoom.moved) setScope(S.scope.type === 'district' && S.scope.d === d.d ? { type: 'tehran' } : { type: 'district', d: d.d }); });
  focusTip(p, ev => distTip(ev, d));
  p.addEventListener('keydown', ev => { if (ev.key === 'Enter') setScope({ type: 'district', d: d.d }); });
  text(tLabG, d.lx, d.ly, nf(d.d), 'dlabel');
});
HOODS.slice().sort((a, b) => Math.max(b.n, val(b, 'n', 1405) || 0) - Math.max(a.n, val(a, 'n', 1405) || 0)).forEach(x => {
  const c = svg('circle', { cx: x.x, cy: x.y, r: 3, 'data-r': 3, class: 'hood', 'data-s': x.s }, tHoodG);
  c.addEventListener('pointermove', ev => hoodTip(ev, x));
  c.addEventListener('pointerleave', hideTip);
  c.addEventListener('click', ev => { ev.stopPropagation(); if (!tZoom.moved) setScope({ type: 'hood', s: x.s }); });
});
// price per m² in every period, the selected one highlighted: which figure belongs to which time
const histRows = o => [{ sep: FA ? 'قیمت هر متر در هر دوره' : 'Price per m² by period' }].concat(MAP_YEARS.map(y => {
  const v = val(o, 'p', y);
  return { k: pLab(y), v: v != null ? Mv(v) + ' ' + T.u_m_short : '–', b: y === S.year };
}));
function distTip(ev, d) {
  const y = S.year, r = rec(d, y), key = S.tMetric, m = T_METRICS[key], rows = [];
  if (r) {
    if (!['p', 'pm', 'n'].includes(key)) rows.push({ k: key === 'g' ? mTitle(m, key, y) : m.label, v: mval(d, key, y) != null ? m.fmt(mval(d, key, y)) : '–' });
    rows.push({ k: T.k_vs, v: TMED[y] ? spct(r.p / TMED[y] - 1) : '–' });
    if (r.pm) rows.push({ k: T.k_price, v: Bv(r.pm) + ' ' + unitB });
    rows.push({ k: T.u_list, v: nf(r.n) });
  }
  showTip(ev, `${distName(d.d)} · ${pLab(y)}`, rows.concat(histRows(d)), r ? null : noData(y));
}
function hoodTip(ev, x) {
  const y = S.year, r = rec(x, y), rows = [];
  if (r) {
    if (S.budgetOn) rows.push({ k: `${nf(S.bSize)} ${T.u_sqm}`, v: Bv(hoodPriceFor(x, S.bSize)) + ' ' + unitB, c: AFF_COL[affordClass(x)] });
    if (r.p25) rows.push({ k: T.tip_iqr, v: `${Mv(r.p25)}–${Mv(r.p75)}` });
    if (r.pm) rows.push({ k: T.k_price, v: Bv(r.pm) + ' ' + unitB });
    if (r.sz) rows.push({ k: T.k_size, v: nf(r.sz) + ' ' + T.u_sqm });
    rows.push({ k: T.u_list, v: nf(r.n) });
  }
  const foot = !r ? noData(y) : (y === 1403 && x.q === 'outlier_vs_district') ? T.tip_flag : (y === 1403 && x.q === 'thin_sample') ? T.tip_thin : null;
  showTip(ev, `${hoodName(x)} · ${distName(x.d)} · ${pLab(y)}`, rows.concat(histRows(x)), foot);
}
function renderTehranMap() {
  const y = S.year, onHoods = S.tLayer === 'h' || S.budgetOn;
  const key = S.tMetric, m = T_METRICS[key];
  const shown = onHoods ? HOODS.filter(x => rec(x, y) && !(y === 1403 && x.q === 'outlier_vs_district')) : DIST;
  const vals = shown.map(o => mval(o, key, y)).filter(v => v != null);
  const scale = vals.length ? makeScale(vals, RAMP[m.ramp]) : null;
  const sc = S.scope;
  const selD = sc.type === 'district' ? sc.d : sc.type === 'hood' ? HBY[sc.s].d : null;
  let missing = false;
  tDistG.querySelectorAll('path').forEach(p => {
    const d = DBY[+p.dataset.d], v = mval(d, key, y);
    if (!onHoods && v == null) missing = true;
    p.setAttribute('fill', onHoods ? (selD === d.d ? '#e3e1da' : '#efeee9') : (scale && v != null ? scale(v) : NODATA));
    p.classList.toggle('sel', selD === d.d);
    p.classList.toggle('dim', !onHoods && scale != null && S.legendBin != null && scale.bin(v) !== S.legendBin);
  });
  tHoodG.style.display = onHoods ? '' : 'none';
  if (onHoods) {
    let nFit = 0;
    const kz = Math.pow(tZoom.k || 1, 0.75);
    tHoodG.querySelectorAll('circle').forEach(c => {
      const x = HBY[c.dataset.s], r = rec(x, y), v = mval(x, key, y);
      c.style.display = r ? '' : 'none';
      if (!r) return;
      const rad = hoodR(r.n || 0); c.dataset.r = rad; c.setAttribute('r', rad / kz);
      let col;
      if (S.budgetOn) { const a = affordClass(x); col = AFF_COL[a]; if (a === 0) nFit++; }
      else { col = scale && v != null ? scale(v) : NODATA; if (v == null) missing = true; }
      c.setAttribute('fill', col);
      c.classList.toggle('flag', y === 1403 && x.q === 'outlier_vs_district');
      c.classList.toggle('sel', sc.type === 'hood' && sc.s === x.s);
      const dim = (scale && S.legendBin != null && !S.budgetOn && scale.bin(v) !== S.legendBin) || (!S.budgetOn && selD != null && x.d !== selD);
      c.setAttribute('opacity', dim ? 0.25 : 1);
    });
    $('#bCount').textContent = S.budgetOn ? `${nf(nFit)} ${T.afford_count} · ${pLab(y)}` : '';
  }
  tLabG.querySelectorAll('text').forEach(t => { t.style.display = onHoods ? 'none' : ''; });
  naOverlay($('#tNA'), !vals.length && !S.budgetOn || (S.budgetOn && !shown.length), FA
    ? `برای ${pLab(y)} داده‌ی منطقه‌ای نداریم. نقشه‌ی تهران برای این دوره‌ها داده دارد:`
    : `No district data for ${pLab(y)}. The Tehran map has data for:`, MAP_YEARS);
  renderLegend($('#tLegend'), S.budgetOn ? null : scale, S.budgetOn ? null : { ...m, label: mTitle(m, key, y) }, () => renderTehranMap(), missing);
}
function naOverlay(el, on, msg, years) {
  el.hidden = !on; if (!on) return;
  clear(el).appendChild(h('p', { text: msg }));
  el.appendChild(h('div', { cls: 'chips' }, years.map(y => h('button', { cls: 'chip', text: pLab(y), onclick: () => setYear(y) }))));
}
function renderLegend(box, scale, m, rerender, missing = false) {
  clear(box);
  if (!scale && m == null) {   // budget legend
    box.appendChild(h('span', { cls: 'title', text: `${T.budget}: ${Bv(S.budget)} ${unitB} · ${nf(S.bSize)} ${T.u_sqm} · ${pLab(S.year)}` }));
    [T.within, T.stretch, T.beyond].forEach((l, i) => box.appendChild(h('span', { cls: 'bin' }, [h('i', { cls: 'sw', style: `background:${AFF_COL[i]}` }), l])));
    return;
  }
  box.appendChild(h('span', { cls: 'title', text: m.label }));
  if (scale) {
    const br = scale.breaks, cols = scale.colors;
    cols.forEach((c, i) => {
      const lo = i === 0 ? null : br[i - 1], hi = i < br.length ? br[i] : null;
      const lab = lo == null ? `< ${m.legend(hi)}` : hi == null ? `≥ ${m.legend(lo)}` : `${m.legend(lo)}–${m.legend(hi)}`;
      const b = h('span', { cls: 'bin' + (S.legendBin === i ? ' on' : ''), role: 'button', tabindex: 0 }, [h('i', { cls: 'sw', style: `background:${c}` }), iso(lab)]);
      b.addEventListener('click', () => { S.legendBin = S.legendBin === i ? null : i; rerender(); });
      box.appendChild(b);
    });
  }
  if (missing || !scale) box.appendChild(h('span', { cls: 'bin' }, [h('i', { cls: 'sw', style: `background:${NODATA}` }), FA ? 'بدون داده در این دوره' : 'no data for this period']));
}

// ------------------------------------------------------------------ Tehran side panel
function barRow(name, value, lo, hi, v, max, onclick, opts = {}) {
  const row = h('div', { cls: 'barrow' + (opts.sel ? ' sel' : ''), role: 'button', tabindex: 0 });
  row.appendChild(h('span', { cls: 'nm', text: name, title: name }));
  const P = x => Math.max(0, Math.min(100, x / max * 100)).toFixed(2) + '%';
  const track = h('span', { cls: 'track' });
  if (lo != null && hi != null) {
    track.appendChild(h('i', { cls: 'band', style: `inset-inline-start:${P(lo)};width:calc(${P(hi)} - ${P(lo)})` + (opts.band ? `;background:${opts.band}` : '') }));
    track.appendChild(h('i', { cls: 'dot', style: `inset-inline-start:${P(v)};background:${opts.color || '#1c5cab'}` }));
  } else {
    track.appendChild(h('i', { cls: 'bar', style: `width:${P(v)};background:${opts.color || '#3987e5'}` }));
  }
  row.appendChild(track);
  row.appendChild(h('span', { cls: 'v', text: value }));
  row.addEventListener('click', onclick);
  row.addEventListener('keydown', ev => { if (ev.key === 'Enter') onclick(); });
  if (opts.hover) { row.addEventListener('pointerenter', () => opts.hover(true)); row.addEventListener('pointerleave', () => opts.hover(false)); }
  return row;
}
function kvBox(items) { return h('div', { cls: 'kv' }, items.map(([v, l]) => h('div', {}, [h('b', { text: iso(v) }), h('span', { text: l })]))); }
function highlightDist(d, on) { const p = tDistG.querySelector(`path[data-d="${d}"]`); if (p) p.style.stroke = on ? '#0b0b0b' : ''; if (p) p.style.strokeWidth = on ? '2.2' : ''; }
function renderTehranSide() {
  const box = clear($('#tSide')), sc = S.scope, y = S.year, P = pLab(y);
  const noYear = () => { box.appendChild(h('p', { cls: 'note', text: noData(y) }));
    box.appendChild(h('div', { cls: 'chips' }, MAP_YEARS.map(v => h('button', { cls: 'chip', text: pLab(v), onclick: () => setYear(v) })))); };
  if (sc.type === 'district' || sc.type === 'hood') {
    const d = DBY[sc.type === 'district' ? sc.d : HBY[sc.s].d], r = rec(d, y);
    box.appendChild(h('h3', {}, [distName(d.d) + ' ', h('span', { cls: 'when', text: P })]));
    if (!r) { noYear(); return; }
    const hs = HOODS.filter(x => x.d === d.d && rec(x, y)).sort((a, b) => val(b, 'p', y) - val(a, 'p', y));
    box.appendChild(h('p', { cls: 'note', text: FA ? `رتبه‌ی ${nf(rankOf(d, y))} از ${nf(nRanked(y))} · ${nf(hs.length)} محله · ${nf(r.n)} آگهی` : `Rank ${rankOf(d, y)} of ${nRanked(y)} · ${hs.length} neighbourhoods · ${nf(r.n)} listings` }));
    box.appendChild(kvBox([[Mv(r.p), T.u_m], [TMED[y] ? spct(r.p / TMED[y] - 1) : '–', T.k_vs], [growth(d, y) ? mult(growth(d, y)) : '–', prevYear(y) ? span2(prevYear(y), y) : T.k_growth]]));
    if (r.sz != null) box.appendChild(kvBox([[nf(r.sz) + ' ' + T.u_sqm, T.k_size], [r.by ? yr(Math.round(r.by)) : '–', T.k_year], [r.el != null ? pct(r.el) : '–', T.f_elevator]]));
    if (!hs.length) return;
    const max = Math.max(...hs.map(x => val(x, 'p75', y) || val(x, 'p', y))) * 1.02;
    box.appendChild(h('div', { cls: 'note', text: FA ? `محله‌ها در ${P}: میانه (نقطه) و ۵۰٪ میانی (نوار)، میلیون تومان/متر` : `Neighbourhoods, ${P}: median (dot) and middle 50% (band), M toman/m²` }));
    const list = h('div', { cls: 'barlist' });
    hs.forEach(x => list.appendChild(barRow(hoodName(x) + (y === 1403 && x.q === 'outlier_vs_district' ? ' ⚑' : ''), Mv(val(x, 'p', y)), val(x, 'p25', y), val(x, 'p75', y), val(x, 'p', y), max,
      () => setScope({ type: 'hood', s: x.s }), { sel: sc.type === 'hood' && sc.s === x.s, color: y !== 1403 || x.q === 'ok' ? '#1c5cab' : '#898781' })));
    box.appendChild(list);
    const target = sc.type === 'hood' && rec(HBY[sc.s], y) ? HBY[sc.s] : hs[0];
    box.appendChild(h('div', { style: 'margin-top:12px;display:flex;gap:8px;flex-wrap:wrap' }, [
      h('button', { cls: 'chip on', text: (FA ? 'قیمت‌گذاری خانه در ' : 'Price a home in ') + hoodName(target), onclick: () => { pickHood(target.s); location.hash = '#pricing'; } })]));
    return;
  }
  box.appendChild(h('h3', {}, [T.tehran_all + ' ', h('span', { cls: 'when', text: P })]));
  if (!PER[y] || !MAP_YEARS.includes(y)) { noYear(); return; }
  const nh = HOODS.filter(x => rec(x, y)).length;
  box.appendChild(h('p', { cls: 'note', text: FA ? `۲۲ منطقه${nh ? ` · ${nf(nh)} محله` : ''} · ${PER[y].src}` : `22 districts${nh ? ` · ${nh} neighbourhoods` : ''} · ${PER[y].src}` }));
  const key = S.tMetric, m = T_METRICS[key];
  const ds = DIST.slice().sort((a, b) => (mval(b, key, y) ?? -1) - (mval(a, key, y) ?? -1));
  const max = Math.max(...ds.map(d => mval(d, key, y) || 0)) * 1.02;
  box.appendChild(h('div', { cls: 'note', text: mTitle(m, key, y) + (key === 'p' ? ` (${T.u_m})` : key === 'pm' ? ` (${unitB})` : '') }));
  const list = h('div', { cls: 'barlist' });
  ds.forEach(d => { const v = mval(d, key, y); list.appendChild(barRow(distName(d.d), v != null ? m.legend(v) : '–', null, null, v || 0, max,
    () => setScope({ type: 'district', d: d.d }), { hover: on => highlightDist(d.d, on), color: RAMP[m.ramp][4] })); });
  box.appendChild(list);
}

// ------------------------------------------------------------------ generic chart frame
function frame(el, w, hgt, m) {
  const s = svg('svg', { viewBox: `0 0 ${w} ${hgt}`, role: 'img' });
  clear(el).appendChild(s);
  el.setAttribute('dir', 'ltr');
  return { s, w, h: hgt, m, iw: w - m.l - m.r, ih: hgt - m.t - m.b };
}
function niceTicks(lo, hi, n = 5) {
  const span = hi - lo; if (span <= 0) return [lo];
  const step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map(k => k * mag).find(s => span / s <= n) || 10 * mag;
  const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}
function logTicks(lo, hi) {
  const out = []; const cands = [1, 2, 5];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) for (const c of cands) { const v = c * Math.pow(10, e); if (v >= lo * 0.999 && v <= hi * 1.001) out.push(v); }
  return out;
}

// ------------------------------------------------------------------ district dumbbell (price ladder)
function renderRank() {
  const el = $('#tRank'), y = S.year, py = prevYear(y);
  if (!nRanked(y)) { clear(el).appendChild(h('p', { cls: 'note', text: noData(y) })); return; }
  const ds = DIST.slice().sort((a, b) => (val(b, 'p', y) ?? -1) - (val(a, 'p', y) ?? -1));
  const rowH = 17, f = frame(el, 560, ds.length * rowH + 40, { l: 70, r: 20, t: 14, b: 26 });
  const max = Math.max(...ds.map(d => Math.max(val(d, 'q75', y) || 0, val(d, 'p', y) || 0, py ? val(d, 'p', py) || 0 : 0))) * 1.05;
  const X = v => f.m.l + v / max * f.iw;
  niceTicks(0, max / 1e6, 5).forEach(t => {
    svg('line', { x1: X(t * 1e6), x2: X(t * 1e6), y1: f.m.t - 4, y2: f.h - f.m.b, class: 'gridl' }, f.s);
    text(f.s, X(t * 1e6), f.h - 8, nf(t), 'axis', { 'text-anchor': 'middle', 'font-size': 11, fill: '#898781' });
  });
  const sel = S.scope.type === 'district' ? S.scope.d : S.scope.type === 'hood' ? HBY[S.scope.s].d : null;
  ds.forEach((d, i) => {
    const yy = f.m.t + i * rowH + rowH / 2, v = val(d, 'p', y), v0 = py ? val(d, 'p', py) : null;
    const g = svg('g', { style: 'cursor:pointer' }, f.s);
    svg('rect', { x: 0, y: yy - rowH / 2, width: f.w, height: rowH, fill: sel === d.d ? '#eef5fd' : 'transparent' }, g);
    text(g, f.m.l - 8, yy + 4, distName(d.d), 'clabel' + (sel === d.d ? ' b' : ''), { 'text-anchor': 'end' });
    if (val(d, 'q25', y)) svg('line', { x1: X(val(d, 'q25', y)), x2: X(val(d, 'q75', y)), y1: yy, y2: yy, stroke: '#cfe0f7', 'stroke-width': 6, 'stroke-linecap': 'round' }, g);
    if (v != null && v0 != null) {
      svg('line', { x1: X(v0), x2: X(v), y1: yy, y2: yy, stroke: '#9c9a92', 'stroke-width': 1.2 }, g);
      svg('circle', { cx: X(v0), cy: yy, r: 4, fill: '#fff', stroke: '#eb6834', 'stroke-width': 1.8 }, g);
    }
    if (v != null) svg('circle', { cx: X(v), cy: yy, r: 4.6, fill: '#1c5cab', stroke: '#fff', 'stroke-width': 1.5 }, g);
    else text(g, f.m.l + 4, yy + 4, '–', 'clabel');
    const rows = [{ k: pLab(y), v: v != null ? Mv(v) + ' ' + T.u_m_short : '–', c: '#1c5cab', b: true }];
    if (val(d, 'q25', y)) rows.push({ k: T.tip_iqr, v: `${Mv(val(d, 'q25', y))}–${Mv(val(d, 'q75', y))}` });
    if (py) rows.push({ k: pLab(py), v: v0 != null ? Mv(v0) + ' ' + T.u_m_short : T.no_data, c: '#eb6834' }, { k: span2(py, y), v: v && v0 ? mult(v / v0) : '–' });
    g.addEventListener('pointermove', ev => showTip(ev, distName(d.d), rows));
    g.addEventListener('pointerleave', hideTip);
    g.addEventListener('pointerenter', () => highlightDist(d.d, true));
    g.addEventListener('pointerout', () => highlightDist(d.d, false));
    g.addEventListener('click', () => setScope({ type: 'district', d: d.d }));
  });
  const keys = [h('span', {}, [h('i', { style: 'background:#1c5cab;width:9px;height:9px;border-radius:50%' }), `${pLab(y)} (${PER[y].src})`])];
  if (py) keys.push(h('span', {}, [h('i', { style: 'background:#fff;border:2px solid #eb6834;width:9px;height:9px;border-radius:50%' }), `${pLab(py)} (${PER[py].src})`]));
  if (DIST.some(d => val(d, 'q25', y))) keys.push(h('span', {}, [h('i', { cls: 'box', style: 'background:#cfe0f7' }), FA ? `۵۰٪ میانی محله‌ها (${pLab(y)})` : `middle 50% of neighbourhoods (${pLab(y)})`]));
  el.insertBefore(h('div', { cls: 'keyrow' }, keys), el.firstChild);
  el.appendChild(h('div', { cls: 'note', style: 'text-align:center;margin:0', text: T.u_m }));
}

// ------------------------------------------------------------------ catch-up scatter
function renderCatch() {
  const el = $('#tCatch'), y = S.year, py = prevYear(y);
  const ds = py ? DIST.filter(d => growth(d, y)) : [];
  const title = $('#catchTitle'), desc = $('#catchDesc');
  if (ds.length < 5) {
    title.textContent = FA ? 'کدام منطقه‌ها سریع‌تر گران شدند؟' : 'Which districts rose faster?';
    desc.textContent = FA ? 'این نمودار دو دوره‌ی پشت سر هم لازم دارد. در نوار زمان ۱۴۰۳ یا ۱۴۰۵ را انتخاب کنید.' : 'This chart needs two consecutive periods. Pick 1403 or the latest year on the year bar.';
    clear(el).appendChild(h('div', { cls: 'chips' }, MAP_YEARS.filter(prevYear).map(v => h('button', { cls: 'chip', text: pLab(v), onclick: () => setYear(v) }))));
    return;
  }
  const xs = ds.map(d => val(d, 'p', py) / 1e6), ys = ds.map(d => growth(d, y));
  const lx = xs.map(Math.log), ly = ys.map(Math.log), mx = lx.reduce((a, b) => a + b) / lx.length, my = ly.reduce((a, b) => a + b) / ly.length;
  const sxy = lx.reduce((s, v, i) => s + (v - mx) * (ly[i] - my), 0), sxx = lx.reduce((s, v) => s + (v - mx) ** 2, 0), syy = ly.reduce((s, v) => s + (v - my) ** 2, 0);
  const corr = sxy / Math.sqrt(sxx * syy), b = sxy / sxx, a = my - b * mx;
  title.textContent = corr <= -0.3 ? (FA ? `منطقه‌های ارزان‌تر سریع‌تر گران شدند (${span2(py, y)})` : `Cheaper districts rose faster (${span2(py, y)})`)
    : corr >= 0.3 ? (FA ? `منطقه‌های گران‌تر سریع‌تر گران شدند (${span2(py, y)})` : `Pricier districts rose faster (${span2(py, y)})`)
    : (FA ? `رشد به سطح قیمت ربط روشنی ندارد (${span2(py, y)})` : `Growth barely tracks the price level (${span2(py, y)})`);
  desc.textContent = FA ? `قیمت هر متر در ${pLab(py)} (محور افقی) در برابر چند برابر شدن آن تا ${pLab(y)} (محور عمودی).` + (py === 1400 ? ' منطقه‌هایی با کمتر از ۱۵ آگهی در نمونه‌ی قدیمی کنار گذاشته شده‌اند.' : '')
    : `Price per m² in ${pLab(py)} (x) against how many times it multiplied by ${pLab(y)} (y).` + (py === 1400 ? ' Districts with fewer than 15 ads in the older sample are left out.' : '');
  const f = frame(el, 560, 360, { l: 46, r: 16, t: 14, b: 42 });
  const x0 = Math.min(...xs) * 0.8, x1 = Math.max(...xs) * 1.08, y0 = Math.min(...ys) * 0.92, y1 = Math.max(...ys) * 1.06;
  const X = v => f.m.l + (Math.log(v) - Math.log(x0)) / (Math.log(x1) - Math.log(x0)) * f.iw;
  const Y = v => f.m.t + (1 - (v - y0) / (y1 - y0)) * f.ih;
  const lt = logTicks(x0, x1); (lt.length >= 2 ? lt : niceTicks(x0, x1, 4)).forEach(t => { svg('line', { x1: X(t), x2: X(t), y1: f.m.t, y2: f.m.t + f.ih, class: 'gridl' }, f.s); text(f.s, X(t), f.h - 24, nf(t), 'axis', { 'text-anchor': 'middle', 'font-size': 11, fill: '#898781' }); });
  niceTicks(y0, y1, 5).forEach(t => { svg('line', { x1: f.m.l, x2: f.m.l + f.iw, y1: Y(t), y2: Y(t), class: 'gridl' }, f.s); text(f.s, f.m.l - 6, Y(t) + 4, '×' + nf(t, 1), 'axis', { 'text-anchor': 'end', 'font-size': 11, fill: '#898781' }); });
  text(f.s, f.m.l + f.iw / 2, f.h - 6, FA ? `قیمت هر متر در ${pLab(py)} (میلیون تومان، مقیاس لگاریتمی)` : `Price per m² in ${pLab(py)} (M toman, log scale)`, 'clabel', { 'text-anchor': 'middle' });
  const fx = [Math.min(...xs), Math.max(...xs)];
  svg('path', { d: `M${X(fx[0])},${Y(Math.exp(a + b * Math.log(fx[0])))}L${X(fx[1])},${Y(Math.exp(a + b * Math.log(fx[1])))}`, stroke: '#eb6834', 'stroke-width': 1.5, fill: 'none', opacity: .8 }, f.s);
  const sel = S.scope.type === 'district' ? S.scope.d : S.scope.type === 'hood' ? HBY[S.scope.s].d : null;
  ds.forEach(d => {
    const g = svg('g', { style: 'cursor:pointer' }, f.s);
    const cx = X(val(d, 'p', py) / 1e6), cy = Y(growth(d, y));
    svg('circle', { cx, cy, r: 12, fill: 'transparent' }, g);
    svg('circle', { cx, cy, r: sel === d.d ? 7.5 : 6, fill: sel === d.d ? '#0d366b' : '#3987e5', stroke: '#fff', 'stroke-width': 2 }, g);
    text(g, cx + 9, cy + 4, nf(d.d), 'clabel' + (sel === d.d ? ' b' : ''));
    g.addEventListener('pointermove', ev => showTip(ev, distName(d.d), [{ k: pLab(py), v: Mv(val(d, 'p', py)) + ' ' + T.u_m_short }, { k: pLab(y), v: Mv(val(d, 'p', y)) + ' ' + T.u_m_short }, { k: span2(py, y), v: mult(growth(d, y)) }]));
    g.addEventListener('pointerleave', hideTip);
    g.addEventListener('click', () => setScope({ type: 'district', d: d.d }));
  });
  text(f.s, f.m.l + f.iw - 4, f.m.t + 12, (FA ? 'همبستگی ' : 'correlation ') + nf(corr, 2), 'clabel b', { 'text-anchor': 'end' });
}

// ================================================================== pricing tool
const hoodListFor = y => HOODS.filter(x => rec(x, y) && (y !== 1403 || x.q === 'ok' || x.q === 'thin_sample')).sort((a, b) => a.d - b.d || val(b, 'p', y) - val(a, 'p', y));
function fillHoodSelect(filter = '') {
  const sel = clear($('#vHood')), f = filter.trim().toLowerCase(), y = S.year;
  let lastD = null, grp = null;
  hoodListFor(y).forEach(x => {
    if (f && !(x.en.toLowerCase().includes(f) || (x.fa || '').includes(filter.trim()) || x.s.includes(f) || String(x.d) === f)) return;
    if (x.d !== lastD) { grp = h('optgroup', { label: distName(x.d) }); sel.appendChild(grp); lastD = x.d; }
    grp.appendChild(h('option', { value: x.s, text: `${hoodName(x)} — ${Mv(val(x, 'p', y))} ${T.u_m_short}` }));
  });
  sel.value = S.hood;
}
function pickHood(s) { S.hood = s; $('#vSearch').value = ''; fillHoodSelect(); renderValuation(); }
function estimate() {
  const x = HBY[S.hood], r = rec(x, S.year);
  if (!r) return null;
  const A0 = r.sz || x.sz || 85, R0 = r.r ?? x.r ?? 2, p0 = r.pk ?? x.pk ?? .7, s0 = x.st ?? .85, e0 = r.el ?? x.el ?? .7;
  const base = r.p * A0;
  const steps = [
    ['adj_area', V.b_area * (Math.log(S.area) - Math.log(A0))],
    ['adj_rooms', V.b_rooms * (S.rooms - R0)],
    ['adj_parking', V.b_parking * (S.parking - p0)],
    ['adj_storage', V.b_storage * (S.storage - s0)],
    ['adj_elevator', V.b_elevator * (S.elevator - e0)],
  ];
  const logAdj = steps.reduce((s, [, v]) => s + v, 0);
  const roll = 1 + S.roll / 100;
  const price = base * Math.exp(logAdj) * roll;
  return { x, r, A0, base, steps, price, roll, lo: price * V.interval.q10, hi: price * V.interval.q90, q25: price * V.interval.q25, q75: price * V.interval.q75, ppm2: price / S.area };
}
function renderValuation() {
  const e = estimate(), out = clear($('#vOut')), y = S.year, P = pLab(y);
  $('#vAreaOut').textContent = `${nf(S.area)} ${T.u_sqm}`;
  $('#vRollOut').textContent = S.roll ? spct(S.roll / 100) : (FA ? `قیمت‌های ${P}` : `${P} prices`);
  if (!e) {
    const x = HBY[S.hood];
    out.appendChild(h('h3', {}, [`${hoodName(x)}, ${distName(x.d)} `, h('span', { cls: 'when', text: P })]));
    out.appendChild(h('p', { cls: 'note', text: FA ? `برای ${P} قیمت این محله را نداریم. دوره‌ای را انتخاب کنید که داده دارد:` : `No price for this neighbourhood in ${P}. Pick a period that has one:` }));
    out.appendChild(h('div', { cls: 'chips' }, MAP_YEARS.filter(v => rec(x, v)).map(v => h('button', { cls: 'chip', text: pLab(v), onclick: () => setYear(v) }))));
    clear($('#vLeft'));
    return;
  }
  const x = e.x, r = e.r;
  const card = h('div', { cls: 'estimate' });
  card.appendChild(h('div', { cls: 'note', style: 'margin:0' }, [`${T.est_title} · ${hoodName(x)}, ${distName(x.d)} `, h('span', { cls: 'when', text: S.roll ? `${P} ${spct(S.roll / 100)}` : P })]));
  card.appendChild(h('div', { cls: 'big' }, [iso(Bv(e.price)), ' ', h('small', { text: unitB })]));
  card.appendChild(h('div', { cls: 'range' }, [T.est_range + ': ', h('b', { text: iso(`${Bv(e.lo)}–${Bv(e.hi)}`) }), ' ' + unitB]));
  card.appendChild(h('div', { cls: 'range' }, [h('b', { text: iso(Mv(e.ppm2)) }), ` ${unitM} (${T.est_ppm2})`]));
  if (y === 1403 && x.q === 'thin_sample') card.appendChild(h('div', { cls: 'note', style: 'margin:6px 0 0', text: '⚠ ' + T.tip_thin }));
  out.appendChild(card);

  // position strip inside neighbourhood distribution
  out.appendChild(h('h3', { style: 'margin-top:16px', text: T.est_pos }));
  const pos = h('div', { cls: 'chart' }); out.appendChild(pos);
  const f = frame(pos, 560, 70, { l: 12, r: 12, t: 18, b: 20 });
  const q1 = r.p25 || r.p, q3 = r.p75 || r.p;
  const lo = Math.min(q1, e.ppm2 / e.roll, r.p) * 0.8, hi = Math.max(q3, e.ppm2 / e.roll, r.p) * 1.2;
  const lo2 = Math.min(lo, e.ppm2) , hi2 = Math.max(hi, e.ppm2 * 1.05);
  const X = v => f.m.l + (v - lo2) / (hi2 - lo2) * f.iw;
  svg('line', { x1: f.m.l, x2: f.m.l + f.iw, y1: 36, y2: 36, stroke: '#e1e0d9', 'stroke-width': 8, 'stroke-linecap': 'round' }, f.s);
  svg('line', { x1: X(q1 * e.roll), x2: X(q3 * e.roll), y1: 36, y2: 36, stroke: '#a9cdf5', 'stroke-width': 8, 'stroke-linecap': 'round' }, f.s);
  svg('line', { x1: X(r.p * e.roll), x2: X(r.p * e.roll), y1: 28, y2: 44, stroke: '#1c5cab', 'stroke-width': 2 }, f.s);
  svg('circle', { cx: X(e.ppm2), cy: 36, r: 7, fill: '#eb6834', stroke: '#fff', 'stroke-width': 2 }, f.s);
  text(f.s, X(e.ppm2), 14, (FA ? 'این خانه ' : 'this home ') + Mv(e.ppm2), 'clabel b', { 'text-anchor': 'middle' });
  text(f.s, X(q1 * e.roll), 62, Mv(q1 * e.roll), 'clabel', { 'text-anchor': 'middle' });
  text(f.s, X(q3 * e.roll), 62, Mv(q3 * e.roll), 'clabel', { 'text-anchor': 'middle' });
  out.appendChild(h('div', { cls: 'keyrow' }, [h('span', {}, [h('i', { cls: 'box', style: 'background:#a9cdf5' }), `${T.tip_iqr} (${hoodName(x)}, ${P})`]), h('span', {}, [h('i', { style: 'background:#1c5cab;width:2px;height:12px' }), FA ? 'میانه‌ی محله' : 'neighbourhood median']), h('span', {}, [h('i', { style: 'background:#eb6834;width:9px;height:9px;border-radius:50%' }), FA ? 'این خانه' : 'this home'])]));

  // waterfall
  out.appendChild(h('h3', { style: 'margin-top:14px', text: T.est_breakdown }));
  const wf = h('div', { cls: 'chart' }); out.appendChild(wf);
  const items = [['base_typ', e.base, null]];
  let cur = e.base;
  e.steps.forEach(([k, lv]) => { const nxt = cur * Math.exp(lv); items.push([k, nxt - cur, cur]); cur = nxt; });
  if (e.roll !== 1) { const nxt = cur * e.roll; items.push(['adj_time', nxt - cur, cur]); cur = nxt; }
  items.push(['result', cur, null]);
  const rh = 24, g = frame(wf, 560, items.length * rh + 10, { l: 178, r: 64, t: 4, b: 6 });
  const vmax = Math.max(...items.map(([, v, s]) => s == null ? v : Math.max(s, s + v))) * 1.05;
  const WX = v => g.m.l + v / vmax * g.iw;
  items.forEach(([k, v, start], i) => {
    const y = g.m.t + i * rh;
    const lab = k === 'base_typ' ? `${T.base_typ} (${nf(e.A0)} ${T.u_sqm})` : T[k];
    text(g.s, g.m.l - 8, y + rh / 2 + 4, lab, 'clabel' + (k === 'result' ? ' b' : ''), { 'text-anchor': 'end' });
    let x0, x1, col;
    if (start == null) { x0 = WX(0); x1 = WX(v); col = k === 'result' ? '#eb6834' : '#3987e5'; }
    else { x0 = WX(Math.min(start, start + v)); x1 = WX(Math.max(start, start + v)); col = v >= 0 ? '#1baf7a' : '#d03b3b'; }
    svg('rect', { x: x0, y: y + 5, width: Math.max(1.5, x1 - x0), height: rh - 10, rx: 3, fill: col }, g.s);
    const vs = start == null ? Bv(v) : (v >= 0 ? '+' : '−') + Bv(Math.abs(v));
    text(g.s, x1 + 6, y + rh / 2 + 4, vs, 'clabel');
  });

  // alternatives + same money elsewhere
  const alt = hoodListFor(y).filter(o => o.d !== x.d && Math.abs(val(o, 'p', y) / r.p - 1) < 0.07).sort((a, b) => val(b, 'n', y) - val(a, 'n', y)).slice(0, 8);
  out.appendChild(h('h3', { style: 'margin-top:14px', text: T.est_alt }));
  out.appendChild(h('div', { cls: 'chips' }, alt.map(o => h('button', { cls: 'chip', text: `${hoodName(o)} · ${nf(o.d)}`, title: `${Mv(val(o, 'p', y))} ${unitM} · ${P}`, onclick: () => pickHood(o.s) }))));
  const left = clear($('#vLeft'));
  left.appendChild(h('h3', { text: T.est_buy }));
  left.appendChild(h('p', { cls: 'note', text: FA ? `با ${Bv(e.price)} میلیارد تومان، به قیمت میانه‌ی هر منطقه در ${P} چند متر می‌شود خرید` : `What ${Bv(e.price)} B toman buys at each district's median price per m² in ${P}` }));
  const buy = h('div', { cls: 'barlist', style: 'max-height:none' }); left.appendChild(buy);
  const ref = [1, 3, 2, 6, 5, 22, 4, 10, 16, 18].map(d => DBY[d]).filter(d => rec(d, y)).sort((a, b) => val(a, 'p', y) - val(b, 'p', y));
  const sqm = ref.map(d => e.price / (val(d, 'p', y) * e.roll)); const mx = Math.max(...sqm) * 1.05;
  ref.forEach((d, i) => buy.appendChild(barRow(distName(d.d), `${nf(sqm[i])} ${T.u_sqm}`, null, null, sqm[i], mx, () => setScope({ type: 'district', d: d.d }), { color: d.d === x.d ? '#eb6834' : '#86b6ef' })));
}
function initValuation() {
  fillHoodSelect();
  $('#vSearch').addEventListener('input', ev => { fillHoodSelect(ev.target.value); const first = $('#vHood option'); if (first && !HBY[$('#vHood').value]) { $('#vHood').value = first.value; } });
  $('#vHood').addEventListener('change', ev => { S.hood = ev.target.value; renderValuation(); });
  const syncArea = v => { S.area = Math.max(20, Math.min(600, +v || 90)); $('#vArea').value = Math.min(300, S.area); $('#vAreaN').value = S.area; renderValuation(); };
  $('#vArea').addEventListener('input', ev => syncArea(ev.target.value));
  $('#vAreaN').addEventListener('change', ev => syncArea(ev.target.value));
  seg($('#vRooms'), v => { S.rooms = +v; renderValuation(); });
  [['#vPark', 'parking'], ['#vStor', 'storage'], ['#vElev', 'elevator']].forEach(([id, k]) => $(id).addEventListener('click', ev => {
    S[k] = S[k] ? 0 : 1; ev.currentTarget.setAttribute('aria-pressed', S[k] ? 'true' : 'false'); renderValuation(); }));
  $('#vRoll').addEventListener('input', ev => { S.roll = +ev.target.value; renderRollChips(); renderValuation(); });
  renderRollChips();
}
function renderRollChips() {
  const box = clear($('#vRollChips')), kil = Math.round(KILID_ROLL * 100), P = pLab(S.year);
  const opts = [[0, FA ? `قیمت‌های ${P}` : `${P} prices`]];
  if (S.year === 1403) opts.push([kil, (FA ? 'کیلید مرداد ۱۴۰۵: ' : 'Kilid, Mordad 1405: ') + spct(KILID_ROLL)]);
  opts.forEach(([v, l]) => box.appendChild(h('button', { cls: 'chip' + (S.roll === v ? ' on' : ''), text: l, onclick: () => { S.roll = v; $('#vRoll').value = v; renderRollChips(); renderValuation(); } })));
}
function seg(el, cb) {
  el.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    el.querySelectorAll('button').forEach(o => o.setAttribute('aria-pressed', o === b ? 'true' : 'false'));
    cb(b.dataset.v);
  }));
}

// ================================================================== Iran map
const I_METRICS = {
  p: { label: T.m_p, ramp: 'blue', fmt: v => Mv(v) + ' ' + T.u_m_short, legend: v => Mv(v) },
  pm: { label: T.m_pm, ramp: 'blue', fmt: v => Bv(v) + ' ' + unitB, legend: v => Bv(v) },
  sz: { label: T.m_sz, ramp: 'teal', fmt: v => nf(v) + ' ' + T.u_sqm, legend: v => nf(v) },
  n: { label: T.m_n, ramp: 'teal', fmt: v => nf(v), legend: v => nf(v) },
};
const iSvg = $('#iMap');
iSvg.setAttribute('viewBox', `0 0 ${D.iran.w} ${D.iran.h}`);
const iG = svg('g', {}, iSvg), iProvG = svg('g', {}, iG), iCityG = svg('g', {}, iG), iLabG = svg('g', {}, iG);
const iZoom = zoomable(iSvg, iG, $('#iMapBox'), k => {
  iCityG.querySelectorAll('circle').forEach(c => c.setAttribute('r', +c.dataset.r / Math.pow(k, 0.75)));
  iLabG.querySelectorAll('text').forEach(t => { t.setAttribute('font-size', 10.5 / Math.pow(k, 0.85)); });
});
const cityR = n => 1.6 + Math.sqrt(n) * 0.055;
PROV.forEach(p => {
  const e = svg('path', { d: p.path, class: 'prov', 'data-iso': p.iso }, iProvG);
  e.addEventListener('pointermove', ev => provTip(ev, p));
  e.addEventListener('pointerleave', hideTip);
  e.addEventListener('click', () => { if (!iZoom.moved) setScope(S.scope.type === 'province' && S.scope.iso === p.iso ? { type: 'tehran' } : { type: 'province', iso: p.iso }); });
  focusTip(e, ev => provTip(ev, p));
});
CITIES.slice().sort((a, b) => b.n - a.n).forEach(c => {
  const e = svg('circle', { cx: c.x, cy: c.y, r: cityR(c.n), 'data-r': cityR(c.n), class: 'city' }, iCityG);
  e.addEventListener('pointermove', ev => showTip(ev, cityName(c) + ' · ' + provName(PBY[c.iso]) + ' · ' + pLab(1403), [
    { k: T.k_ppm2, v: Mv(c.p) + ' ' + T.u_m_short }, { k: T.k_price, v: Bv(c.pm) + ' ' + unitB }, { k: T.k_size, v: nf(c.sz) + ' ' + T.u_sqm }, { k: T.u_list, v: nf(c.n) }],
    c.exact ? null : (FA ? 'موقعیت: مرکز شهرستان' : 'Placed at its county centre')));
  e.addEventListener('pointerleave', hideTip);
  e.addEventListener('click', ev => { ev.stopPropagation(); if (!iZoom.moved) setScope({ type: 'province', iso: c.iso }); });
});
PROV.filter(p => p.p != null).forEach(p => { const t = text(iLabG, p.lx, p.ly, provName(p), 'dlabel'); t.setAttribute('font-size', 10.5); t.setAttribute('font-weight', 600); });
function provTip(ev, p) {
  const ok = S.year === 1403;
  showTip(ev, provName(p) + ' · ' + pLab(1403) + (p.rank ? ` · ${T.k_rank} ${nf(p.rank)}` : ''), [
    { k: T.k_ppm2, v: Mv(p.p) + ' ' + T.u_m_short }, { k: T.k_vsn, v: spct(p.vs) }, { k: T.k_price, v: Bv(p.pm) + ' ' + unitB },
    { k: T.k_size, v: nf(p.sz) + ' ' + T.u_sqm }, { k: (FA ? 'شهر · آگهی' : 'cities · ads'), v: `${nf(p.c)} · ${nf(p.n)}` }],
    ok ? null : (FA ? `برای ${pLab(S.year)} داده‌ی استانی نداریم؛ این عددها مال ۱۴۰۳ است.` : `No province data for ${pLab(S.year)}; these figures are for 1403.`));
}
let iLegendBin = null;
function renderIranMap() {
  const m = I_METRICS[S.iMetric], ok = S.year === 1403;
  const sc = makeScale(PROV.map(p => p[S.iMetric]), RAMP[m.ramp]);
  const cityScale = makeScale(CITIES.map(c => c.p), RAMP.blue);
  const sel = S.scope.type === 'province' ? S.scope.iso : null;
  iProvG.querySelectorAll('path').forEach(e => {
    const p = PBY[e.dataset.iso];
    e.setAttribute('fill', !ok ? NODATA : S.iCities ? '#efeee9' : sc(p[S.iMetric]));
    if (S.iCities && sel === p.iso) e.setAttribute('fill', '#e3e1da');
    e.classList.toggle('sel', sel === p.iso);
    e.classList.toggle('dim', !S.iCities && iLegendBin != null && sc.bin(p[S.iMetric]) !== iLegendBin);
  });
  iCityG.style.display = S.iCities && ok ? '' : 'none';
  iCityG.querySelectorAll('circle').forEach((e, i) => {
    const c = CITIES.slice().sort((a, b) => b.n - a.n)[i];
    e.setAttribute('fill', cityScale(c.p));
    e.setAttribute('opacity', (sel && c.iso !== sel) || (iLegendBin != null && S.iCities && cityScale.bin(c.p) !== iLegendBin) ? 0.2 : 1);
  });
  iLabG.querySelectorAll('text').forEach(t => t.style.display = S.iCities && ok ? 'none' : '');
  const box = $('#iLegend');
  naOverlay($('#iNA'), !ok, FA ? `برای ${pLab(S.year)} داده‌ی استانی نداریم. نقشه‌ی ایران فقط برای ۱۴۰۳ داده دارد:` : `No province data for ${pLab(S.year)}. The Iran map has data for:`, [1403]);
  if (!ok) { renderLegend(box, null, { label: `${m.label} · ${pLab(S.year)}` }, () => {}, true); return; }
  if (S.iCities) { const save = S.legendBin; S.legendBin = iLegendBin; renderLegend(box, cityScale, { label: (FA ? 'قیمت هر متر در شهرها (دایره: تعداد آگهی)' : 'City price per m² (bubble = listings)') + ' · ' + pLab(1403), legend: v => Mv(v) }, () => {}); S.legendBin = save; }
  else { const save = S.legendBin; S.legendBin = iLegendBin; renderLegend(box, sc, { ...m, label: `${m.label} · ${pLab(1403)}` }, () => {}); S.legendBin = save; }
  box.querySelectorAll('.bin[role=button]').forEach((b, i) => b.addEventListener('click', () => { iLegendBin = iLegendBin === i ? null : i; renderIranMap(); }));
}
function renderIranSide() {
  const box = clear($('#iSide')), sc = S.scope;
  if (S.year !== 1403) {
    box.appendChild(h('h3', {}, [(sc.type === 'province' ? `${T.province} ${provName(PBY[sc.iso])}` : T.iran_all) + ' ', h('span', { cls: 'when', text: pLab(S.year) })]));
    box.appendChild(h('p', { cls: 'note', text: FA ? 'داده‌ی استان‌ها و شهرها فقط برای ۱۴۰۳ موجود است.' : 'Province and city data exist for 1403 only.' }));
    box.appendChild(h('button', { cls: 'chip on', text: FA ? 'نمایش ۱۴۰۳' : 'Show 1403', onclick: () => setYear(1403) }));
    return;
  }
  if (sc.type === 'province') {
    const p = PBY[sc.iso];
    box.appendChild(h('h3', {}, [`${T.province} ${provName(p)} `, h('span', { cls: 'when', text: pLab(1403) })]));
    box.appendChild(h('p', { cls: 'note', text: FA ? `رتبه‌ی ${nf(p.rank)} از ۳۱ · ${nf(p.c)} شهر · ${nf(p.n)} آگهی` : `Rank ${p.rank} of 31 · ${p.c} cities · ${nf(p.n)} listings` }));
    box.appendChild(kvBox([[Mv(p.p), T.u_m], [spct(p.vs), T.k_vsn], [Bv(p.pm), unitB]]));
    const cs = CITIES.filter(c => c.iso === p.iso).sort((a, b) => b.p - a.p);
    const max = Math.max(...cs.map(c => c.p)) * 1.05;
    box.appendChild(h('div', { cls: 'note', text: FA ? 'شهرها، میلیون تومان/متر' : 'Cities, M toman/m²' }));
    const list = h('div', { cls: 'barlist' });
    cs.forEach(c => list.appendChild(barRow(cityName(c), Mv(c.p), null, null, c.p, max, () => {}, { color: '#3987e5' })));
    box.appendChild(list);
    return;
  }
  box.appendChild(h('h3', {}, [T.iran_all + ' ', h('span', { cls: 'when', text: pLab(1403) })]));
  box.appendChild(h('p', { cls: 'note', text: FA ? `میانه‌ی کشور ${Mv(NAT_MED)} ${unitM} · ${nf(D.meta.listings_2024_total)} آگهی در ${nf(D.meta.cities_2024)} شهر` : `National median ${Mv(NAT_MED)} ${unitM} · ${nf(D.meta.listings_2024_total)} ads in ${D.meta.cities_2024} cities` }));
  const m = I_METRICS[S.iMetric];
  const ps = PROV.filter(p => p[S.iMetric] != null).sort((a, b) => b[S.iMetric] - a[S.iMetric]);
  const max = Math.max(...ps.map(p => p[S.iMetric])) * 1.03;
  box.appendChild(h('div', { cls: 'note', text: `${T.prov_rank} · ${m.label}` + (S.iMetric === 'p' ? ` (${T.u_m})` : S.iMetric === 'pm' ? ` (${unitB})` : '') }));
  const list = h('div', { cls: 'barlist' });
  ps.forEach(p => list.appendChild(barRow(provName(p), m.legend(p[S.iMetric]), null, null, p[S.iMetric], max, () => setScope({ type: 'province', iso: p.iso }), { color: RAMP[m.ramp][4] })));
  box.appendChild(list);
}

// ================================================================== line chart engine (time)
function lineChart(el, cfg) {
  // cfg: {w,h, xMin,xMax, yLog, yMin,yMax, series:[{id,label,color,pts:[[x,y]],dash,width}], bands:[{color,opacity,pts:[[x,lo,hi]]}],
  //       xTicks:[x], xFmt, yFmt, crosshair: x=>rows, vlines:[{x,label}]}
  const f = frame(el, cfg.w || 1100, cfg.h || 380, cfg.m || { l: 54, r: 70, t: 16, b: 34 });
  const X = x => f.m.l + (x - cfg.xMin) / (cfg.xMax - cfg.xMin) * f.iw;
  const ly = v => cfg.yLog ? Math.log(v) : v;
  const Y = v => f.m.t + (1 - (ly(v) - ly(cfg.yMin)) / (ly(cfg.yMax) - ly(cfg.yMin))) * f.ih;
  const yt = cfg.yTicks || (cfg.yLog ? logTicks(cfg.yMin, cfg.yMax) : niceTicks(cfg.yMin, cfg.yMax, 5));
  yt.forEach(t => { svg('line', { x1: f.m.l, x2: f.m.l + f.iw, y1: Y(t), y2: Y(t), class: 'gridl' }, f.s); text(f.s, f.m.l - 7, Y(t) + 4, cfg.yFmt(t), 'axis', { 'text-anchor': 'end', 'font-size': 11, fill: '#898781' }); });
  (cfg.xTicks || []).forEach(t => { svg('line', { x1: X(t), x2: X(t), y1: f.m.t + f.ih, y2: f.m.t + f.ih + 4, stroke: '#c3c2b7' }, f.s); text(f.s, X(t), f.h - 12, cfg.xFmt(t), 'axis', { 'text-anchor': 'middle', 'font-size': 11, fill: '#898781' }); });
  svg('line', { x1: f.m.l, x2: f.m.l + f.iw, y1: f.m.t + f.ih, y2: f.m.t + f.ih, stroke: '#c3c2b7' }, f.s);
  if (cfg.hl) {
    const a = Math.max(cfg.xMin, cfg.hl.x0), b = Math.min(cfg.xMax, cfg.hl.x1);
    if (b > a) {
      svg('rect', { x: X(a), y: f.m.t, width: X(b) - X(a), height: f.ih, fill: '#2a78d6', opacity: .08 }, f.s);
      text(f.s, (X(a) + X(b)) / 2, f.m.t + f.ih - 6, cfg.hl.label, 'clabel b', { 'text-anchor': 'middle', fill: '#1c5cab' });
    }
  }
  (cfg.vlines || []).forEach(v => { svg('line', { x1: X(v.x), x2: X(v.x), y1: f.m.t, y2: f.m.t + f.ih, stroke: '#c3c2b7', 'stroke-width': 1 }, f.s); text(f.s, X(v.x) + 4, f.m.t + 10, v.label, 'clabel', {}); });
  (cfg.bands || []).forEach(b => {
    const top = b.pts.map(p => `${X(p[0])},${Y(p[2])}`), bot = b.pts.slice().reverse().map(p => `${X(p[0])},${Y(p[1])}`);
    svg('path', { d: 'M' + top.join('L') + 'L' + bot.join('L') + 'Z', fill: b.color, opacity: b.opacity }, f.s);
  });
  (cfg.series || []).forEach(s => {
    let d = '', pen = false;
    s.pts.forEach(p => { if (p[1] == null) { pen = false; return; } d += (pen ? 'L' : 'M') + X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1); pen = true; });
    svg('path', { d, fill: 'none', stroke: s.color, 'stroke-width': s.width || 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'stroke-dasharray': s.dash || null }, f.s);
    // isolated points (gaps on both sides) get a dot so they are visible
    s.pts.forEach((p, i) => { if (p[1] != null && (s.dots || ((!s.pts[i - 1] || s.pts[i - 1][1] == null) && (!s.pts[i + 1] || s.pts[i + 1][1] == null)))) svg('circle', { cx: X(p[0]), cy: Y(p[1]), r: s.dots ? 3 : 2.4, fill: s.color }, f.s); });
    const last = s.pts.filter(p => p[1] != null).pop();
    if (last && s.endLabel) { svg('circle', { cx: X(last[0]), cy: Y(last[1]), r: 4, fill: s.color, stroke: '#fff', 'stroke-width': 2 }, f.s); text(f.s, X(last[0]) + 7, Y(last[1]) + 4, s.endLabel, 'clabel b'); }
  });
  if (cfg.crosshair) {
    const ch = svg('line', { y1: f.m.t, y2: f.m.t + f.ih, stroke: '#0b0b0b', 'stroke-width': 1, opacity: 0 }, f.s);
    const hit = svg('rect', { x: f.m.l, y: f.m.t, width: f.iw, height: f.ih, fill: 'transparent' }, f.s);
    hit.addEventListener('pointermove', ev => {
      const pt = f.s.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY; const p = pt.matrixTransform(f.s.getScreenCTM().inverse());
      const x = Math.round(cfg.xMin + (p.x - f.m.l) / f.iw * (cfg.xMax - cfg.xMin));
      const r = cfg.crosshair(x); if (!r) { hideTip(); ch.setAttribute('opacity', 0); return; }
      ch.setAttribute('x1', X(x)); ch.setAttribute('x2', X(x)); ch.setAttribute('opacity', .35);
      showTip(ev, r.title, r.rows, r.foot);
    });
    hit.addEventListener('pointerleave', () => { hideTip(); ch.setAttribute('opacity', 0); });
  }
  return { X, Y, f };
}

// ------------------------------------------------------------------ major cities
const CITY_COL = { tehran: '#2a78d6', mashhad: '#eb6834', karaj: '#1baf7a', isfahan: '#eda100', shiraz: '#e87ba4' };
function renderMajor() {
  const el = $('#mChart'), key = clear($('#mKey'));
  const rows = D.major.filter(r => r.n >= 500);
  const cities = Object.keys(CITY_COL);
  const ts = rows.map(r => r.t), tMin = Math.min(...ts), tMax = Math.max(...ts);
  const val = r => S.mMode === 'adj' ? r.adj : r.p;
  const vs = rows.map(val);
  const series = cities.map(c => ({ id: c, color: CITY_COL[c], label: cityName(CBY[c]), pts: rows.filter(r => r.city === c).sort((a, b) => a.t - b.t).map(r => [r.t, val(r)]), dots: true }));
  const gm = Object.fromEntries(rows.map(r => [r.t, r.month]));
  cities.forEach(c => key.appendChild(h('span', {}, [h('i', { style: `background:${CITY_COL[c]}` }), cityName(CBY[c])])));
  const lo = Math.min(...vs), hi = Math.max(...vs);
  lineChart(el, {
    w: 560, h: 320, m: { l: 44, r: 16, t: 12, b: 30 }, xMin: tMin - 0.3, xMax: tMax + 0.3, yLog: false,
    yMin: S.mMode === 'adj' ? Math.floor(lo / 5) * 5 : 0, yMax: hi * 1.05,
    xTicks: Array.from({ length: tMax - tMin + 1 }, (_, i) => tMin + i).filter((t, i) => i % 2 === 0), xFmt: t => FA ? MFA[tJ(t)[1] - 1] : (gm[t] ? new Date(gm[t] + '-15').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }) : ''),
    yFmt: v => S.mMode === 'adj' ? nf(v) : Mv(v), series,
    crosshair: t => { const rs = rows.filter(r => r.t === t); if (!rs.length) return null; return { title: tLabel(t), rows: cities.map(c => { const r = rs.find(x => x.city === c); return r ? { k: cityName(CBY[c]), v: S.mMode === 'adj' ? nf(r.adj, 1) : Mv(r.p) + ' ' + T.u_m_short, c: CITY_COL[c] } : null; }).filter(Boolean) }; },
  });
}

// ------------------------------------------------------------------ satellites
function renderSat() {
  const el = $('#satChart');
  const tehranG = D.meta.tehran_median_2024 / D.meta.tehran_median_2021;
  const items = D.satellites.map(s => ({ name: cityName(s), g: s.g, s })).concat([{ name: FA ? 'تهران (مناطق)' : 'Tehran (districts)', g: tehranG, tehran: true }]).sort((a, b) => b.g - a.g);
  const rh = 24, f = frame(el, 560, items.length * rh + 28, { l: 150, r: 60, t: 6, b: 22 });
  const max = Math.max(...items.map(i => i.g)) * 1.08;
  const X = v => f.m.l + v / max * f.iw;
  niceTicks(0, max, 5).forEach(t => { svg('line', { x1: X(t), x2: X(t), y1: f.m.t, y2: f.h - f.m.b, class: 'gridl' }, f.s); text(f.s, X(t), f.h - 6, '×' + nf(t, 1), 'axis', { 'text-anchor': 'middle', 'font-size': 11, fill: '#898781' }); });
  items.forEach((it, i) => {
    const y = f.m.t + i * rh;
    text(f.s, f.m.l - 8, y + rh / 2 + 4, it.name, 'clabel' + (it.tehran ? ' b' : ''), { 'text-anchor': 'end' });
    const r = svg('rect', { x: X(0), y: y + 6, width: X(it.g) - X(0), height: rh - 12, rx: 3, fill: it.tehran ? '#0d366b' : '#86b6ef' }, f.s);
    text(f.s, X(it.g) + 6, y + rh / 2 + 4, mult(it.g), 'clabel');
    if (it.s) { r.addEventListener('pointermove', ev => showTip(ev, it.name, [{ k: FA ? 'حدود ۱۴۰۰' : 'c. 1400', v: Mv(it.s.p21) + ' ' + T.u_m_short }, { k: '1403', v: Mv(it.s.p24) + ' ' + T.u_m_short }, { k: FA ? 'آگهی قدیم/جدید' : 'ads old/new', v: `${nf(it.s.n21)} / ${nf(it.s.n24)}` }])); r.addEventListener('pointerleave', hideTip); }
  });
}

// ================================================================== forecast studio
function renderForecast() {
  const el = $('#fChart'), key = clear($('#fKey'));
  const H = 12, lk = D.series.last_kilid, lc = D.series.last_cbi;
  const gm = Math.log(1 + S.fG) / 12;
  const bands = D.forecast.bands;
  const mid = h_ => D.forecast.kilid_last * Math.exp(gm * h_);
  const fan = Array.from({ length: H + 1 }, (_, i) => i);
  const b80 = fan.map(i => i === 0 ? [lk, D.forecast.kilid_last, D.forecast.kilid_last] : [lk + i, mid(i) * bands[i - 1].q10, mid(i) * bands[i - 1].q90]);
  const b50 = fan.map(i => i === 0 ? [lk, D.forecast.kilid_last, D.forecast.kilid_last] : [lk + i, mid(i) * bands[i - 1].q25, mid(i) * bands[i - 1].q75]);
  const off = D.forecast.official[S.fMethod];
  const offPts = [[lc, lastCbi.cbi]].concat(off.map((v, i) => [lc + i + 1, v]));
  const divar = D.major.filter(r => r.city === 'tehran' && r.n >= 1000).map(r => [r.t, r.p]);
  const divarLive = (D.series.divar_live || []).map(r => [r.t, r.p]);   // scheduled collector snapshots
  const cbiPts = MONTHS.map(m => [m.t, m.cbi]);
  const kilPts = MONTHS.map(m => [m.t, m.kil]);
  const xMax = lk + H;
  const all = [...MONTHS.map(m => m.cbi), ...MONTHS.map(m => m.kil), ...b80.map(p => p[2]), ...off, ...divarLive.map(p => p[1])].filter(v => v);
  const yMin = S.fScale === 'log' ? 3e6 : 0, yMax = Math.max(...all) * 1.06;
  const todayT = (1405 - 1395) * 12 + 6;   // Mehr 1405
  [[T.cbi, '#2a78d6'], [T.kilid, '#eb6834'], [T.divar, '#1baf7a']].forEach(([l, c]) => key.appendChild(h('span', {}, [h('i', { style: `background:${c}` }), l])));
  key.appendChild(h('span', { style: 'color:#2a78d6' }, [h('i', { cls: 'dash', style: 'background:#2a78d6' }), h('span', { style: 'color:#52514e', text: `${T.official_path} (${D.forecast.labels[S.fMethod][L]})` })]));
  key.appendChild(h('span', {}, [h('i', { cls: 'box', style: 'background:rgba(235,104,52,.18)' }), `${T.forecast}: ${T.band80}`]));
  key.appendChild(h('span', {}, [h('i', { cls: 'box', style: 'background:rgba(235,104,52,.32)' }), T.band50]));
  const years = []; for (let y = 1395; y <= 1406; y++) years.push((y - 1395) * 12);
  lineChart(el, {
    w: 1100, h: 400, m: { l: 58, r: 96, t: 16, b: 34 }, xMin: 0, xMax, yLog: S.fScale === 'log', yMin, yMax,
    yTicks: S.fScale === 'log' ? [5e6, 1e7, 2e7, 5e7, 1e8, 2e8, 5e8].filter(v => v >= yMin && v <= yMax) : null,
    yFmt: v => Mv(v, 0), xTicks: years, xFmt: t => yr(1395 + t / 12),
    bands: [{ color: '#eb6834', opacity: .16, pts: b80 }, { color: '#eb6834', opacity: .22, pts: b50 }],
    vlines: [{ x: todayT, label: FA ? 'امروز' : 'today' }],
    hl: { x0: (S.year - 1395) * 12, x1: (S.year - 1395) * 12 + 12, label: pLab(S.year) },
    series: [
      { id: 'cbi', color: '#2a78d6', pts: cbiPts },
      { id: 'off', color: '#2a78d6', pts: offPts, dash: '5 4', width: 1.6 },
      { id: 'divar', color: '#1baf7a', pts: divar, dots: true },
      { id: 'divarLive', color: '#1baf7a', pts: divarLive, dots: true },
      { id: 'kil', color: '#eb6834', pts: kilPts },
      { id: 'fc', color: '#eb6834', pts: fan.map(i => [lk + i, mid(i)]), dash: '5 4', endLabel: Mv(mid(H)) },
    ],
    crosshair: t => {
      if (t < 0 || t > xMax) return null;
      const m = MONTHS[t], rows = [];
      if (m && m.cbi) rows.push({ k: T.cbi, v: Mv(m.cbi) + ' ' + T.u_m_short, c: '#2a78d6' });
      if (m && m.cbi && cbiYoY(t) != null) rows.push({ k: FA ? 'تغییر سالانه' : 'year on year', v: spct(cbiYoY(t)) });
      if (m && m.tx) rows.push({ k: FA ? 'تعداد معامله' : 'transactions', v: nf(m.tx) });
      const dv = divar.find(p => p[0] === t) || divarLive.filter(p => p[0] === t).pop(); if (dv) rows.push({ k: T.divar, v: Mv(dv[1]) + ' ' + T.u_m_short, c: '#1baf7a' });
      if (m && m.kil) rows.push({ k: T.kilid, v: Mv(m.kil) + ' ' + T.u_m_short, c: '#eb6834' });
      if (t > lc && t <= lc + 24) rows.push({ k: T.official_path, v: Mv(off[t - lc - 1]) + ' ' + T.u_m_short, c: '#2a78d6' });
      if (t > lk) { const i = t - lk; rows.push({ k: T.forecast, v: Mv(mid(i)) + ' ' + T.u_m_short, c: '#eb6834' }); rows.push({ k: T.band80, v: `${Mv(b80[i][1])}–${Mv(b80[i][2])}` }); }
      if (!rows.length) return null;
      return { title: tLabel(t), rows };
    },
  });
  // outlook card
  const out = clear($('#fOut'));
  const endT = lk + H, e = b80[H];
  out.appendChild(h('h3', { text: T.fc_out_title }));
  out.appendChild(h('p', { cls: 'note', text: FA ? `از آخرین عدد کیلید (${tLabel(lk)}) با فرض رشد سالانه‌ی ${pct(S.fG)}` : `From Kilid's latest reading (${tLabel(lk)}) at ${pct(S.fG)} a year` }));
  out.appendChild(h('div', { cls: 'estimate' }, [
    h('div', { cls: 'note', style: 'margin:0', text: tLabel(endT) }),
    h('div', { cls: 'big' }, [iso(Mv(mid(H))), ' ', h('small', { text: unitM })]),
    h('div', { cls: 'range' }, [T.band80 + ': ', h('b', { text: iso(`${Mv(e[1])}–${Mv(e[2])}`) })]),
    h('div', { cls: 'range' }, [FA ? 'خانه‌ی ۱۰۰ متری: ' : 'A 100 m² home: ', h('b', { text: iso(Bv(mid(H) * 100)) }), ' ' + unitB])]));
  out.appendChild(h('p', { cls: 'note', style: 'margin-top:10px', text: FA ? 'پهنای بازه از خطاهای واقعی روش برتر در ۳۵ آزمون گذشته‌نگر آمده است، نه از فرض مدل.' : "Band widths are the best method's actual errors across 35 historical tests, not a model assumption." }));
  // reality check
  const rc = clear($('#fReal'));
  const offAt = off[lk - lc - 1];
  rc.appendChild(h('h3', { text: T.reality_title }));
  rc.appendChild(h('p', { style: 'margin:6px 0 10px;color:#52514e;font-size:14px', text: FA
    ? `اگر در ${tLabel(lc)} (آخرین ماه رسمی) با روش «${D.forecast.labels[S.fMethod].fa}» پیش‌بینی می‌کردیم، برای ${tLabel(lk)} عدد ${Mv(offAt)} میلیون تومان به دست می‌آمد. شاخص آگهی کیلید در همان ماه ${Mv(lastKil.kil)} است (${spct(lastKil.kil / offAt - 1)}).`
    : `Run from ${tLabel(lc)}, the last official month, the "${D.forecast.labels[S.fMethod].en}" method projects ${Mv(offAt)} M toman for ${tLabel(lk)}. Kilid's listing indicator for that month reads ${Mv(lastKil.kil)} M (${spct(lastKil.kil / offAt - 1)}).` }));
  rc.appendChild(h('p', { cls: 'note', text: FA ? 'قیمت آگهی معمولاً بالاتر از قیمت معامله است و گزارش‌های رسانه‌ای مرداد ۱۴۰۵ عددی بین ۲۰۶ تا ۲۳۳ میلیون تومان را نشان می‌دهند؛ پس شکاف واقعی احتمالاً کوچک‌تر از این است، ولی جهتش روشن است: ۱۴۰۴ تا ۱۴۰۵ از روند بلندمدت تندتر بوده است.' : 'Asking prices usually sit above transaction prices, and press reports for Mordad 1405 range from 206 to 233 M toman, so the true gap is likely smaller. The direction is clear: 1404–1405 ran hotter than the long-run trend.' }));
  // presets
  const pr = clear($('#fPresets'));
  [[G_LONG, T.preset_long], [G_KIL, T.preset_kilid], [G_LONG / 2, T.preset_half], [0, T.preset_zero]].forEach(([g, l]) => pr.appendChild(h('button', { cls: 'chip' + (Math.abs(S.fG - g) < 0.005 ? ' on' : ''), text: `${l} ${pct(g)}`, onclick: () => { S.fG = g; $('#fG').value = Math.round(g * 100); $('#fGOut').textContent = pct(S.fG); renderForecast(); renderKPIs(); } })));
  $('#fGOut').textContent = pct(S.fG);
}
function renderLeaderboard() {
  const box = clear($('#fLb'));
  const lb = D.forecast.leaderboard, cols = ['h1', 'h3', 'h6', 'h12', 'h24'];
  const best = Object.fromEntries(cols.map(c => [c, Math.min(...lb.map(r => r[c]))]));
  const t = h('table', { cls: 't' });
  t.appendChild(h('thead', {}, h('tr', {}, [h('th', { text: T.method }), ...cols.map(c => h('th', { cls: 'n', text: FA ? `${nf(+c.slice(1))} ماه` : `${c.slice(1)} mo` }))])));
  const tb = h('tbody');
  lb.forEach(r => {
    const tr = h('tr', { cls: r.method === D.forecast.best ? 'best' : '' });
    tr.appendChild(h('td', { text: D.forecast.labels[r.method][L] + (r.method === D.forecast.best ? ` · ${T.best}` : '') }));
    cols.forEach(c => { const td = h('td', { cls: 'n' }); const s = pct(r[c], 1); if (r[c] === best[c]) td.appendChild(h('b', { text: s })); else td.textContent = s; tr.appendChild(td); });
    tb.appendChild(tr);
  });
  t.appendChild(tb); box.appendChild(t);
}
function renderYoY() {
  const el = $('#yoyChart');
  const pts = MONTHS.filter(m => m.t <= D.series.last_cbi).map(m => [m.t, cbiYoY(m.t)]).filter(p => p[1] != null);
  const f = frame(el, 420, 260, { l: 44, r: 8, t: 10, b: 26 });
  const t0 = pts[0][0], t1 = pts[pts.length - 1][0];
  const X = t => f.m.l + (t - t0) / (t1 - t0 + 1) * f.iw;
  const max = Math.max(...pts.map(p => p[1])) * 1.08, min = Math.min(0, ...pts.map(p => p[1]));
  const Y = v => f.m.t + (1 - (v - min) / (max - min)) * f.ih;
  niceTicks(min, max, 5).forEach(t => { svg('line', { x1: f.m.l, x2: f.m.l + f.iw, y1: Y(t), y2: Y(t), class: 'gridl' }, f.s); text(f.s, f.m.l - 6, Y(t) + 4, pct(t), 'axis', { 'text-anchor': 'end', 'font-size': 11, fill: '#898781' }); });
  svg('line', { x1: f.m.l, x2: f.m.l + f.iw, y1: Y(0), y2: Y(0), stroke: '#c3c2b7' }, f.s);
  const bw = Math.max(2, f.iw / (t1 - t0 + 1) - 1.5);
  pts.forEach(([t, v]) => {
    const r = svg('rect', { x: X(t), y: Math.min(Y(v), Y(0)), width: bw, height: Math.abs(Y(v) - Y(0)), rx: 1.5, fill: tJ(t)[0] === S.year ? '#0d366b' : '#a9cdf5' }, f.s);
    r.addEventListener('pointermove', ev => showTip(ev, tLabel(t), [{ k: FA ? 'تغییر سالانه' : 'year on year', v: spct(v) }, { k: T.cbi, v: Mv(MONTHS[t].cbi) + ' ' + T.u_m_short }]));
    r.addEventListener('pointerleave', hideTip);
  });
  for (let y = 1396; y <= 1403; y++) { const t = (y - 1395) * 12; if (t >= t0) text(f.s, X(t), f.h - 8, yr(y), 'axis', { 'text-anchor': 'middle', 'font-size': 11, fill: '#898781' }); }
}

// ================================================================== model section
function renderModel() {
  const cv = D.valuation.cv, box = clear($('#mCv'));
  const t = h('table', { cls: 't' });
  const cols = [['r2_log', T.r2, v => nf(v, 3)], ['median_ape', T.mdape, v => pct(v, 1)], ['mape', T.mape, v => pct(v, 1)], ['within_20pct', T.w20, v => pct(v, 0)]];
  t.appendChild(h('thead', {}, h('tr', {}, [h('th', { text: T.method }), ...cols.map(c => h('th', { cls: 'n', text: c[1] }))])));
  const tb = h('tbody');
  [['hedonic_ols', T.m_ols], ['gradient_boosting', T.m_gb], ['location_only', T.m_loc]].forEach(([k, l]) => {
    const tr = h('tr', { cls: k === 'hedonic_ols' ? 'best' : '' });
    tr.appendChild(h('td', { text: l }));
    cols.forEach(([c, , fm]) => tr.appendChild(h('td', { cls: 'n', text: fm(cv[k][c]) })));
    tb.appendChild(tr);
  });
  t.appendChild(tb); box.appendChild(t);
  box.appendChild(h('p', { cls: 'note', style: 'margin:8px 0 0', text: FA ? `n = ${nf(D.valuation.n)} آگهی. مدل هدانیک کمی ضعیف‌تر از گرادیان بوستینگ است ولی شش ضریب دارد و در مرورگر اجرا می‌شود.` : `n = ${nf(D.valuation.n)} listings. The hedonic model trails gradient boosting slightly but has six coefficients and runs in your browser.` }));

  // coefficients
  const ce = $('#coefChart');
  const pr = D.valuation.premiums, ci = D.valuation.ci;
  const rows = [[T.per_room, pr.rooms_each, ci.rooms], [T.parking, pr.parking, ci.parking], [T.elevator, pr.elevator, ci.elevator], [T.storage, pr.storage, ci.storage]];
  const f = frame(ce, 420, rows.length * 44 + 40, { l: 96, r: 20, t: 10, b: 30 });
  const lo = -0.15, hi = 0.25, X = v => f.m.l + (v - lo) / (hi - lo) * f.iw;
  niceTicks(lo, hi, 5).forEach(t => { svg('line', { x1: X(t), x2: X(t), y1: f.m.t, y2: f.h - f.m.b, class: 'gridl' }, f.s); text(f.s, X(t), f.h - 10, pct(t), 'axis', { 'text-anchor': 'middle', 'font-size': 11, fill: '#898781' }); });
  svg('line', { x1: X(0), x2: X(0), y1: f.m.t, y2: f.h - f.m.b, stroke: '#898781' }, f.s);
  rows.forEach(([l, v, c], i) => {
    const y = f.m.t + i * 44 + 22;
    text(f.s, f.m.l - 8, y + 4, l, 'clabel', { 'text-anchor': 'end' });
    svg('line', { x1: X(Math.expm1(c[0])), x2: X(Math.expm1(c[1])), y1: y, y2: y, stroke: '#86b6ef', 'stroke-width': 4, 'stroke-linecap': 'round' }, f.s);
    svg('circle', { cx: X(v), cy: y, r: 5.5, fill: v >= 0 ? '#1c5cab' : '#d03b3b', stroke: '#fff', 'stroke-width': 2 }, f.s);
    text(f.s, X(v), y - 10, spct(v, 1), 'clabel b', { 'text-anchor': 'middle' });
  });
  ce.appendChild(h('p', { cls: 'note', style: 'margin:6px 0 0', text: (FA ? `${T.area10}: ${spct(pr.ppm2_change_per_10pct_area, 1)}. ضریب منفی انباری احتمالاً اثر قدمت ساختمان را حمل می‌کند؛ انباری در ساختمان‌های قدیمی‌تر رایج‌تر است.` : `${T.area10}: ${spct(pr.ppm2_change_per_10pct_area, 1)}. Storage's negative sign most likely carries building age: storage units are more common in older blocks, and this dataset has no age field.`) }));

  // scatter
  const se = $('#scChart');
  const sc = D.valuation.scatter;
  const g = frame(se, 420, 380, { l: 44, r: 12, t: 10, b: 38 });
  const vals = sc.flat().filter(v => v > 0), a = Math.max(0.1, Math.min(...vals)), b = Math.max(...vals);
  const SX = v => g.m.l + (Math.log(v) - Math.log(a)) / (Math.log(b) - Math.log(a)) * g.iw;
  const SY = v => g.m.t + (1 - (Math.log(v) - Math.log(a)) / (Math.log(b) - Math.log(a))) * g.ih;
  logTicks(a, b).forEach(t => { svg('line', { x1: SX(t), x2: SX(t), y1: g.m.t, y2: g.m.t + g.ih, class: 'gridl' }, g.s); svg('line', { x1: g.m.l, x2: g.m.l + g.iw, y1: SY(t), y2: SY(t), class: 'gridl' }, g.s); text(g.s, SX(t), g.h - 22, nf(t, t < 1 ? 1 : 0), 'axis', { 'text-anchor': 'middle', 'font-size': 11, fill: '#898781' }); text(g.s, g.m.l - 6, SY(t) + 4, nf(t, t < 1 ? 1 : 0), 'axis', { 'text-anchor': 'end', 'font-size': 11, fill: '#898781' }); });
  svg('line', { x1: SX(a), y1: SY(a), x2: SX(b), y2: SY(b), stroke: '#eb6834', 'stroke-width': 1.5 }, g.s);
  sc.forEach(([act, pre]) => { if (act > 0 && pre > 0) svg('circle', { cx: SX(act), cy: SY(pre), r: 2.6, fill: '#2a78d6', 'fill-opacity': .45 }, g.s); });
  text(g.s, g.m.l + g.iw / 2, g.h - 4, `${T.actual} (${unitB})`, 'clabel', { 'text-anchor': 'middle' });
  text(g.s, g.m.l + 6, g.m.t + 10, `${T.predicted} ↑`, 'clabel');
  const hit = svg('rect', { x: g.m.l, y: g.m.t, width: g.iw, height: g.ih, fill: 'transparent' }, g.s);
  hit.addEventListener('pointermove', ev => {
    const pt = g.s.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY; const p = pt.matrixTransform(g.s.getScreenCTM().inverse());
    let best = null, bd = 1e9; sc.forEach(s => { const d = Math.hypot(SX(s[0]) - p.x, SY(s[1]) - p.y); if (d < bd) { bd = d; best = s; } });
    if (best && bd < 16) showTip(ev, `${T.actual} ${Bv(best[0] * 1e9)} ${unitB}`, [{ k: T.predicted, v: Bv(best[1] * 1e9) + ' ' + unitB }, { k: FA ? 'خطا' : 'error', v: spct(best[1] / best[0] - 1) }]); else hideTip();
  });
  hit.addEventListener('pointerleave', hideTip);

  // importance
  const ie = $('#impChart'), imp = D.valuation.importance;
  const names = { log_hood_ppm2: FA ? 'سطح قیمت محله' : 'Neighbourhood price level', log_area: FA ? 'متراژ' : 'Floor area', rooms: FA ? 'اتاق' : 'Bedrooms', parking: T.parking, elevator: T.elevator, storage: T.storage };
  const tot = Object.values(imp).reduce((s, v) => s + Math.max(0, v), 0);
  const items = Object.entries(imp).map(([k, v]) => [names[k], Math.max(0, v) / tot]).sort((a, b) => b[1] - a[1]);
  const q = frame(ie, 420, items.length * 34 + 20, { l: 150, r: 50, t: 6, b: 10 });
  items.forEach(([n, v], i) => {
    const y = q.m.t + i * 34;
    text(q.s, q.m.l - 8, y + 20, n, 'clabel', { 'text-anchor': 'end' });
    svg('rect', { x: q.m.l, y: y + 9, width: Math.max(2, v * q.iw), height: 16, rx: 3, fill: '#3987e5' }, q.s);
    text(q.s, q.m.l + v * q.iw + 6, y + 21, pct(v), 'clabel');
  });
}

// ================================================================== data section
function renderData() {
  const fill = (tpl, o) => tpl.replace(/\{(\w+)\}/g, (_, k) => o[k]);
  const d1 = DBY[1], dmin = DIST.slice().sort((a, b) => a.p - b.p)[0];
  const gs = DIST.filter(d => d.g).sort((a, b) => b.g - a.g);
  const ps = PROV.filter(p => p.p).sort((a, b) => b.p - a.p);
  const lb = D.forecast.leaderboard, worst = lb.slice().sort((a, b) => b.h12 - a.h12)[0];
  const cv = D.valuation.cv, pr = D.valuation.premiums;
  const F = TX.findings;
  const items = [
    ['1', fill(F.gradient, { d1: `${Mv(d1.p)} ${unitM}`, x: nf(d1.p / dmin.p, 1), dmin: nf(dmin.d), dminv: `${Mv(dmin.p)}` })],
    ['2', fill(F.catch, { r: nf(D.meta.growth_corr, 2), gmax: nf(gs[0].d), gmaxv: nf(gs[0].g, 2), g1: nf(d1.g, 2) })],
    ['3', fill(F.capital, { x: nf(ps[0].p / NAT_MED, 1), second: provName(ps[1]), secondv: `${Mv(ps[1].p)} ${unitM}`, alborz: `${Mv(PBY['IR-30'].p)} ${unitM}` })],
    ['4', fill(F.forecast, { bad: pct(worst.h12, 0), good: pct(lb[0].h12, 0) })],
    ['5', fill(F.model, { loc: nf(cv.location_only.r2_log, 2), ols: nf(cv.hedonic_ols.r2_log, 2), pk: spct(pr.parking, 0), el: spct(pr.elevator, 0) })],
  ];
  const fb = clear($('#dFind'));
  items.forEach(([n, s]) => fb.appendChild(h('div', { cls: 'finding' }, [h('div', { cls: 'ic', text: nf(+n) }), h('p', { style: 'margin:4px 0 0;color:#0b0b0b', text: s })])));
  const sb = clear($('#dSrc'));
  TX.sources.forEach(([name, url, desc]) => sb.appendChild(h('li', {}, [h('a', { href: url, target: '_blank', rel: 'noopener', text: name }), h('div', { cls: 'muted', text: desc })])));
  const lbx = clear($('#dLim'));
  TX.limits.forEach(s => lbx.appendChild(h('li', { text: s })));
  $('#built').textContent = (FA ? 'به‌روزرسانی: ' : 'Built ') + D.meta.built;
}
function renderPills() {
  const box = clear($('#pills'));
  const items = FA ? [
    [nf(D.meta.listings_2024_total), 'آگهی دیوار در ۴۲۰ شهر، ۱۴۰۳'],
    ...(LIVE ? [[nf(LIVE.ads_used), `آگهی تهران، ${liveDate()}`]] : []),
    [nf(D.meta.listings_2021), 'آگهی تک‌به‌تک، حدود ۱۴۰۰'],
    ['۹۱', 'ماه قیمت رسمی، ۱۳۹۵ تا ۱۴۰۳'], ['۱۲', 'ماه شاخص کیلید، ۱۴۰۴ تا ۱۴۰۵']]
    : [[nf(D.meta.listings_2024_total), 'Divar ads in 420 cities, 1403'],
      ...(LIVE ? [[nf(LIVE.ads_used), `Tehran ads, ${liveDate()}`]] : []),
      [nf(D.meta.listings_2021), 'individual ads, c. 1400'],
      ['91', 'months of official prices, 1395–1403'], ['12', 'months of Kilid, 1404–1405']];
  items.forEach(([v, l]) => box.appendChild(h('span', { cls: 'pill' }, [h('b', { text: iso(v) }), ' ' + l])));
}

// ================================================================== year bar
let playT = null;
function renderYearBar() {
  const yb = clear($('#ybYears')), y = S.year;
  const has = v => ({ t: MAP_YEARS.includes(v), i: v === 1403, c: !!lastIn(v, 'cbi'), k: !!lastIn(v, 'kil') });
  YEARS.forEach(v => {
    const a = has(v);
    yb.appendChild(h('button', { cls: 'yb-y' + (v === y ? ' on' : '') + (a.t ? ' map' : ''), 'aria-pressed': v === y ? 'true' : 'false', onclick: () => { stopPlay(); setYear(v); } }, [
      h('b', { text: yr(v) }), h('span', { cls: 'yb-dots' }, ['t', 'i', 'c', 'k'].filter(k => a[k]).map(k => h('i', { cls: 'yb-dot ' + k })))]));
  });
  centerYear();
  const c = lastIn(y, 'cbi'), k = lastIn(y, 'kil');
  const item = (cls, name, v) => h('span', { cls: 'yb-s' + (v ? '' : ' off') }, [h('i', { cls: 'yb-dot ' + cls }), name + ': ', h('b', { text: v || (FA ? 'ندارد' : 'none') })]);
  const st = clear($('#ybStatus'));
  [item('t', FA ? 'نقشه‌ی تهران' : 'Tehran map', MAP_YEARS.includes(y) ? `${pLab(y)} · ${PER[y].src}` : null),
   item('i', FA ? 'استان‌ها' : 'Provinces', y === 1403 ? pLab(1403) : null),
   item('c', FA ? 'بانک مرکزی' : 'Central Bank', c ? tLabel(c.t) : null),
   item('k', FA ? 'کیلید' : 'Kilid', k ? tLabel(k.t) : null)].forEach(e => st.appendChild(e));
}
function centerYear() {   // keep the selected year in view when the bar scrolls (phones)
  const yb = $('#ybYears'), on = yb.querySelector('.on');
  if (!on || yb.scrollWidth <= yb.clientWidth) return;
  const a = on.getBoundingClientRect(), b = yb.getBoundingClientRect();
  yb.scrollLeft += (a.left + a.width / 2) - (b.left + b.width / 2);
}
function stopPlay() { if (playT) { clearInterval(playT); playT = null; } $('#ybPlay').textContent = '▶'; $('#ybPlay').setAttribute('aria-pressed', 'false'); }
function togglePlay() {
  if (playT) { stopPlay(); return; }
  let i = YEARS.indexOf(S.year); if (i >= YEARS.length - 1) i = -1;
  $('#ybPlay').textContent = '❚❚'; $('#ybPlay').setAttribute('aria-pressed', 'true');
  const step = () => { i++; if (i >= YEARS.length) { stopPlay(); return; } setYear(YEARS[i]); };
  step(); playT = setInterval(step, 1400);
}
function setYear(y) {
  if (!YEARS.includes(y)) return;
  S.year = y; S.legendBin = null; iLegendBin = null;
  if (S.roll) { S.roll = 0; $('#vRoll').value = 0; }
  renderYearBar(); renderKPIs(); renderTehranMap(); renderTehranSide(); renderRank(); renderCatch();
  fillHoodSelect($('#vSearch').value); renderRollChips(); renderValuation(); renderIranMap(); renderIranSide(); renderForecast(); renderYoY();
}

// ================================================================== wiring
function initControls() {
  $('#ybPlay').addEventListener('click', togglePlay);
  $('#ybYears').addEventListener('keydown', ev => {
    const back = FA ? 'ArrowRight' : 'ArrowLeft', fwd = FA ? 'ArrowLeft' : 'ArrowRight';
    if (ev.key !== back && ev.key !== fwd) return;
    ev.preventDefault(); stopPlay();
    const i = YEARS.indexOf(S.year) + (ev.key === fwd ? 1 : -1);
    if (i >= 0 && i < YEARS.length) { setYear(YEARS[i]); $('#ybYears .on').focus(); }
  });
  const tm = $('#tMetric');
  Object.entries(T_METRICS).forEach(([k, m]) => tm.appendChild(h('option', { value: k, text: m.label })));
  tm.addEventListener('change', ev => { S.tMetric = ev.target.value; S.legendBin = null; renderTehranMap(); renderTehranSide(); });
  seg($('#tLayer'), v => { S.tLayer = v; S.legendBin = null; renderTehranMap(); });
  $('#tBudgetOn').addEventListener('change', ev => { S.budgetOn = ev.target.checked; $('#tBudget').classList.toggle('on', S.budgetOn); renderTehranMap(); });
  const setB = v => { S.budget = Math.max(0.5, +v || 8) * 1e9; $('#bAmt').value = S.budget / 1e9; $('#bAmtR').value = Math.min(60, S.budget / 1e9); renderTehranMap(); };
  $('#bAmt').addEventListener('change', ev => setB(ev.target.value));
  $('#bAmtR').addEventListener('input', ev => setB(ev.target.value));
  $('#bSize').addEventListener('change', ev => { S.bSize = Math.max(30, +ev.target.value || 75); renderTehranMap(); });
  const im = $('#iMetric');
  Object.entries(I_METRICS).forEach(([k, m]) => im.appendChild(h('option', { value: k, text: m.label })));
  im.addEventListener('change', ev => { S.iMetric = ev.target.value; iLegendBin = null; if (S.iCities && S.iMetric !== 'p') { S.iCities = false; $('#iCities').checked = false; } renderIranMap(); renderIranSide(); });
  $('#iCities').addEventListener('change', ev => { S.iCities = ev.target.checked; iLegendBin = null; renderIranMap(); });
  seg($('#mMode'), v => { S.mMode = v; renderMajor(); });
  seg($('#fScale'), v => { S.fScale = v; renderForecast(); });
  const fm = $('#fMethod');
  D.forecast.leaderboard.forEach(r => fm.appendChild(h('option', { value: r.method, text: `${D.forecast.labels[r.method][L]} (${pct(r.h12, 0)})` })));
  fm.value = S.fMethod;
  fm.addEventListener('change', ev => { S.fMethod = ev.target.value; renderForecast(); });
  $('#fG').value = Math.round(S.fG * 100);
  $('#fG').addEventListener('input', ev => { S.fG = +ev.target.value / 100; renderForecast(); });
  // nav highlight
  const secs = $$('section.block'), links = $$('.nav a');
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) links.forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + e.target.id)); }), { rootMargin: '-40% 0px -55% 0px' });
  secs.forEach(s => io.observe(s));
  addEventListener('scroll', hideTip, { passive: true });
}

function boot() {
  initControls(); initValuation(); renderPills(); renderYearBar();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(centerYear);
  addEventListener('resize', centerYear);
  renderKPIs(); renderTehranMap(); renderTehranSide(); renderRank(); renderCatch();
  renderValuation(); renderIranMap(); renderIranSide(); renderMajor(); renderSat();
  renderForecast(); renderLeaderboard(); renderYoY(); renderModel(); renderData();
}
boot();
})();
