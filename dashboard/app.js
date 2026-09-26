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
    const row = h('div', { cls: 'r' });
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
  scope: { type: 'tehran' },
  tMetric: 'p', tLayer: 'd', budgetOn: false, budget: 8e9, bSize: 75, legendBin: null,
  iMetric: 'p', iCities: false,
  hood: 'saadat-abad', area: 90, rooms: 2, parking: 1, storage: 1, elevator: 1, roll: 0,
  fScale: 'log', fMethod: D.forecast.best, fG: G_LONG, mMode: 'adj',
};

// ================================================================== KPI strip
function kpi(label, value, unit, sub, opts = {}) {
  const k = h('div', { cls: 'kpi' + (opts.hero ? ' hero-kpi' : '') + (opts.spark ? ' has-spark' : '') });
  const lab = h('div', { cls: 'lab' }, [h('span', { text: label })]);
  if (opts.info) lab.appendChild(h('span', { cls: 'info', title: opts.info, text: 'i' }));
  k.appendChild(lab);
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
  const box = clear($('#kpis')), sc = S.scope;
  const cbiSpark = spark(MONTHS.filter(m => m.t >= D.series.last_cbi - 36 && m.t <= D.series.last_cbi).map(m => m.cbi));
  const kilSpark = spark(MONTHS.filter(m => m.kil).map(m => m.kil), '#eb6834');
  const yoy = cbiYoY(D.series.last_cbi);
  const common = [
    kpi(T.k_cbi, Mv(lastCbi.cbi), unitM, h('span', {}, [deltaSpan(yoy), (FA ? ' سالانه · ' : ' y/y · ') + tLabel(lastCbi.t)]), { spark: cbiSpark, info: FA ? 'میانگین قیمت هر متر در معاملات ثبت‌شده‌ی تهران (بانک مرکزی). آخرین ماه منتشرشده.' : 'Mean price per m² of registered Tehran transactions (Central Bank of Iran). Last published month.' }),
    kpi(T.k_kilid, Mv(lastKil.kil), unitM, h('span', {}, [deltaSpan(lastKil.kil / MONTHS.find(m => m.kil).kil - 1), ' · ' + tLabel(lastKil.t)]), { spark: kilSpark, info: FA ? 'شاخص آگهی کیلید برای کل تهران. قیمت پیشنهادی است، نه معامله.' : "Kilid's Tehran-wide listing indicator. Asking prices, not transactions." }),
  ];
  let tiles = [];
  if (sc.type === 'tehran') {
    tiles = [
      kpi(T.k_ppm2, Mv(TEHRAN_MED), unitM, FA ? `میانه‌ی آگهی‌های ۱۴۰۳ · ${nf(D.meta.tehran_listings_located)} آگهی` : `1403 listings · ${nf(D.meta.tehran_listings_located)} ads`, { hero: true }),
      kpi(T.k_vsn, mult(TEHRAN_MED / NAT_MED, 1), '', FA ? `میانه‌ی کشور: ${Mv(NAT_MED)} ${unitM}` : `national median: ${Mv(NAT_MED)} ${unitM}`),
      kpi(T.k_price, Bv(TEH_CITY.pm), unitB, FA ? `متراژ معمول ${nf(TEH_CITY.sz)} متر` : `typical size ${nf(TEH_CITY.sz)} m²`),
      LIVE ? kpi(liveLabel(), Mv(LIVE.tehran_median_ppm2), unitM, h('span', {}, [deltaSpan(LIVE.tehran_median_ppm2 / TEHRAN_MED - 1), FA ? ` نسبت به ۱۴۰۳ · ${nf(LIVE.ads_used)} آگهی` : ` vs 1403 · ${nf(LIVE.ads_used)} ads`]), { info: FA ? 'میانه‌ی آگهی‌های فروش آپارتمان که همین حالا روی نقشه‌ی دیوار است، به همان روش عدد ۱۴۰۳ (میانه‌ی وزنی میانه‌ی محله‌ها). هر هفته خودکار به‌روز می‌شود.' : 'Median of the apartment-sale ads on Divar\'s map at collection time, computed the same way as the 1403 figure (listing-weighted median of neighbourhood medians). Refreshed weekly.' })
           : kpi(T.k_growth, mult(TEHRAN_MED / D.meta.tehran_median_2021), '', FA ? `از ${Mv(D.meta.tehran_median_2021)} در حدود ۱۴۰۰` : `from ${Mv(D.meta.tehran_median_2021)} M c. 1400`),
      ...common];
  } else if (sc.type === 'district') {
    const d = DBY[sc.d];
    tiles = [
      kpi(T.k_ppm2, Mv(d.p), unitM, FA ? `رتبه‌ی ${nf(d.rank)} از ۲۲ · ${nf(d.n)} آگهی` : `rank ${d.rank} of 22 · ${nf(d.n)} ads`, { hero: true }),
      kpi(T.k_vs, spct(d.vs), '', FA ? `میانه‌ی تهران ${Mv(TEHRAN_MED)}` : `Tehran median ${Mv(TEHRAN_MED)} M`),
      kpi(T.k_price, Bv(d.pm), unitB, FA ? `متراژ معمول ${nf(d.sz)} متر · ساخت ${yr(d.by)}` : `typical ${nf(d.sz)} m² · built ${d.by}`),
      (LIVE && d.p5) ? kpi(liveLabel(), Mv(d.p5), unitM, h('span', {}, [deltaSpan(d.g5 - 1), FA ? ` نسبت به ۱۴۰۳ · ${nf(d.n5)} آگهی` : ` vs 1403 · ${nf(d.n5)} ads`])) :
      kpi(T.k_growth, d.g ? mult(d.g) : T.no_data, '', d.g ? (FA ? `از ${Mv(d.p21)} در حدود ۱۴۰۰ (${nf(d.n21)} آگهی)` : `from ${Mv(d.p21)} M c. 1400 (${nf(d.n21)} ads)`) : (FA ? 'نمونه‌ی قدیمی کمتر از ۱۵ آگهی' : 'older sample under 15 ads')),
      ...common];
  } else if (sc.type === 'hood') {
    const x = HBY[sc.s], d = DBY[x.d];
    tiles = [
      kpi(T.k_ppm2, Mv(x.p), unitM, FA ? `۵۰٪ میانی ${Mv(x.p25)}–${Mv(x.p75)}` : `middle 50%: ${Mv(x.p25)}–${Mv(x.p75)} M`, { hero: true }),
      kpi(FA ? 'نسبت به منطقه' : 'vs its district', spct(x.p / d.p - 1), '', FA ? `${distName(x.d)}: ${Mv(d.p)}` : `${distName(x.d)}: ${Mv(d.p)} M`),
      kpi(T.k_price, Bv(x.pm), unitB, FA ? `متراژ معمول ${nf(x.sz)} متر · ${nf(x.r)} اتاق` : `typical ${nf(x.sz)} m² · ${x.r} bed`),
      kpi(T.k_year, x.by ? yr(x.by) : '–', '', FA ? `آسانسور ${pct(x.el)} · پارکینگ ${pct(x.pk)}` : `elevator ${pct(x.el)} · parking ${pct(x.pk)}`),
      ...common];
  } else if (sc.type === 'province') {
    const p = PBY[sc.iso];
    tiles = [
      kpi(T.k_ppm2, Mv(p.p), unitM, FA ? `رتبه‌ی ${nf(p.rank)} از ۳۱ · ${nf(p.n)} آگهی` : `rank ${p.rank} of 31 · ${nf(p.n)} ads`, { hero: true }),
      kpi(T.k_vsn, spct(p.vs), '', FA ? `میانه‌ی کشور ${Mv(NAT_MED)}` : `national median ${Mv(NAT_MED)} M`),
      kpi(T.k_price, Bv(p.pm), unitB, FA ? `متراژ معمول ${nf(p.sz)} متر` : `typical ${nf(p.sz)} m²`),
      kpi(FA ? 'بزرگ‌ترین بازار استان' : 'Largest market', cityName(CBY[p.big] || { en: p.big }), '', FA ? `${Mv(p.bigp)} ${unitM} · ${pct(p.bigsh)} آگهی‌ها` : `${Mv(p.bigp)} ${unitM} · ${pct(p.bigsh)} of ads`),
      ...common];
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
}
function setScope(sc) {
  S.scope = sc;
  renderKPIs(); renderTehranMap(); renderTehranSide(); renderRank(); renderCatch(); renderIranMap(); renderIranSide();
}

// ================================================================== Tehran map
const T_METRICS = {
  p: { label: T.m_p, ramp: 'blue', fmt: v => Mv(v) + ' ' + T.u_m_short, legend: v => Mv(v), hood: true },
  g: { label: T.m_g, ramp: 'orange', fmt: v => mult(v), legend: v => mult(v, 1), hood: false },
  pm: { label: T.m_pm, ramp: 'blue', fmt: v => Bv(v) + ' ' + unitB, legend: v => Bv(v), hood: true },
  sz: { label: T.m_sz, ramp: 'teal', fmt: v => nf(v) + ' ' + T.u_sqm, legend: v => nf(v), hood: true },
  by: { label: T.m_by, ramp: 'teal', fmt: v => yr(Math.round(v)), legend: v => yr(Math.round(v)), hood: true },
  el: { label: T.m_el, ramp: 'teal', fmt: v => pct(v), legend: v => pct(v), hood: true },
  pk: { label: T.m_pk, ramp: 'teal', fmt: v => pct(v), legend: v => pct(v), hood: true },
  n: { label: T.m_n, ramp: 'teal', fmt: v => nf(v), legend: v => nf(v), hood: true },
};
if (D.meta.has_1405) {   // optional live layer from scripts/collect_divar.py
  T_METRICS.p5 = { label: T.m_p5, ramp: 'blue', fmt: v => Mv(v) + ' ' + T.u_m_short, legend: v => Mv(v), hood: true };
  T_METRICS.g5 = { label: T.m_g5, ramp: 'orange', fmt: v => mult(v), legend: v => mult(v, 2), hood: false };
}
const LIVE = D.meta.divar_1405 || null;
const MONTH_FA = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
const liveDate = () => {
  if (!LIVE) return '';
  const j = LIVE.collected_on_jalali;
  if (FA) return j ? `${nf(j[2])} ${MONTH_FA[j[1] - 1]} ${yr(j[0])}` : LIVE.collected_on;
  return new Date(LIVE.collected_on + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};
const liveLabel = () => LIVE ? (FA ? `دیوار، ${liveDate()}` : `Divar · ${liveDate()}`) : '';
const tSvg = $('#tMap');
tSvg.setAttribute('viewBox', `0 0 ${D.tehran.w} ${D.tehran.h}`);
const tG = svg('g', {}, tSvg);
const tDistG = svg('g', {}, tG), tHoodG = svg('g', {}, tG), tLabG = svg('g', {}, tG);
const tZoom = zoomable(tSvg, tG, $('#tMapBox'), k => {
  tHoodG.querySelectorAll('circle').forEach(c => c.setAttribute('r', +c.dataset.r / Math.pow(k, 0.75)));
  tLabG.querySelectorAll('text').forEach(t => t.setAttribute('font-size', 11 / Math.pow(k, 0.8)));
});
const hoodR = n => 2.2 + Math.sqrt(n) * 0.19;
function hoodPriceFor(x, size) { const A0 = x.sz || 85; return x.p * A0 * Math.exp(V.b_area * (Math.log(size) - Math.log(A0))); }
function affordClass(x) { const p = hoodPriceFor(x, S.bSize); return p <= S.budget ? 0 : p <= S.budget * 1.2 ? 1 : 2; }
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
HOODS.slice().sort((a, b) => b.n - a.n).forEach(x => {
  const c = svg('circle', { cx: x.x, cy: x.y, r: hoodR(x.n), 'data-r': hoodR(x.n), class: 'hood' + (x.q === 'outlier_vs_district' ? ' flag' : ''), 'data-s': x.s }, tHoodG);
  c.addEventListener('pointermove', ev => hoodTip(ev, x));
  c.addEventListener('pointerleave', hideTip);
  c.addEventListener('click', ev => { ev.stopPropagation(); if (!tZoom.moved) setScope({ type: 'hood', s: x.s }); });
});
function distTip(ev, d) {
  const m = T_METRICS[S.tMetric];
  const rows = [{ k: T.k_ppm2, v: Mv(d.p) + ' ' + T.u_m_short }, { k: T.k_vs, v: spct(d.vs) }, { k: T.k_growth, v: d.g ? mult(d.g) : '–' },
    { k: T.k_price, v: Bv(d.pm) + ' ' + unitB }, { k: T.u_list, v: nf(d.n) }];
  if (d.p5) rows.splice(1, 0, { k: liveLabel(), v: `${Mv(d.p5)} ${T.u_m_short} (${spct(d.g5 - 1)})` });
  if (!['p', 'g', 'pm', 'n', 'p5', 'g5'].includes(S.tMetric)) rows.unshift({ k: m.label, v: m.fmt(d[S.tMetric]) });
  showTip(ev, `${distName(d.d)} · ${T.k_rank} ${nf(d.rank)}`, rows);
}
function hoodTip(ev, x) {
  const rows = [{ k: T.k_ppm2, v: Mv(x.p) + ' ' + T.u_m_short }, { k: T.tip_iqr, v: `${Mv(x.p25)}–${Mv(x.p75)}` },
    { k: T.k_price, v: Bv(x.pm) + ' ' + unitB }, { k: T.k_size, v: nf(x.sz) + ' ' + T.u_sqm }, { k: T.u_list, v: nf(x.n) }];
  if (x.p5) rows.splice(1, 0, { k: liveLabel(), v: `${Mv(x.p5)} ${T.u_m_short} (${spct(x.p5 / x.p - 1)})` });
  if (S.budgetOn) rows.unshift({ k: `${nf(S.bSize)} ${T.u_sqm}`, v: Bv(hoodPriceFor(x, S.bSize)) + ' ' + unitB, c: AFF_COL[affordClass(x)] });
  const foot = x.q === 'outlier_vs_district' ? T.tip_flag : x.q === 'thin_sample' ? T.tip_thin : null;
  showTip(ev, `${hoodName(x)} · ${distName(x.d)}`, rows, foot);
}
function tMetricVals(onHoods) {
  const k = S.tMetric;
  return onHoods ? HOODS.filter(x => x.q !== 'outlier_vs_district').map(x => x[k]) : DIST.map(d => d[k]);
}
function renderTehranMap() {
  const onHoods = S.tLayer === 'h' || S.budgetOn;
  let key = S.tMetric; if (onHoods && !T_METRICS[key].hood) key = 'p';
  const m = T_METRICS[key];
  const scale = makeScale(onHoods ? HOODS.filter(x => x.q !== 'outlier_vs_district').map(x => x[key]) : DIST.map(d => d[key]), RAMP[m.ramp]);
  const sc = S.scope;
  const selD = sc.type === 'district' ? sc.d : sc.type === 'hood' ? HBY[sc.s].d : null;
  tDistG.querySelectorAll('path').forEach(p => {
    const d = DBY[+p.dataset.d];
    p.setAttribute('fill', onHoods ? (selD === d.d ? '#e3e1da' : '#efeee9') : scale(d[key]));
    p.classList.toggle('sel', selD === d.d);
    p.classList.toggle('dim', !onHoods && S.legendBin != null && scale.bin(d[key]) !== S.legendBin);
  });
  tHoodG.style.display = onHoods ? '' : 'none';
  if (onHoods) {
    let nFit = 0;
    tHoodG.querySelectorAll('circle').forEach(c => {
      const x = HBY[c.dataset.s];
      let col;
      if (S.budgetOn) { const a = affordClass(x); col = AFF_COL[a]; if (a === 0 && x.q !== 'outlier_vs_district') nFit++; }
      else col = scale(x[key]);
      c.setAttribute('fill', col);
      c.classList.toggle('sel', sc.type === 'hood' && sc.s === x.s);
      const dim = (S.legendBin != null && !S.budgetOn && scale.bin(x[key]) !== S.legendBin) || (!S.budgetOn && selD != null && x.d !== selD);
      c.setAttribute('opacity', dim ? 0.25 : 1);
    });
    $('#bCount').textContent = S.budgetOn ? `${nf(nFit)} ${T.afford_count}` : '';
  }
  // labels: dark ink over light fills, white over dark
  tLabG.querySelectorAll('text').forEach((t, i) => { t.style.display = onHoods ? 'none' : ''; });
  renderLegend($('#tLegend'), S.budgetOn ? null : scale, m, () => renderTehranMap());
}
function renderLegend(box, scale, m, rerender) {
  clear(box);
  if (!scale) {   // budget legend
    box.appendChild(h('span', { cls: 'title', text: `${T.budget}: ${Bv(S.budget)} ${unitB} · ${nf(S.bSize)} ${T.u_sqm}` }));
    [T.within, T.stretch, T.beyond].forEach((l, i) => box.appendChild(h('span', { cls: 'bin' }, [h('i', { cls: 'sw', style: `background:${AFF_COL[i]}` }), l])));
    return;
  }
  box.appendChild(h('span', { cls: 'title', text: m.label }));
  const br = scale.breaks, cols = scale.colors;
  cols.forEach((c, i) => {
    const lo = i === 0 ? null : br[i - 1], hi = i < br.length ? br[i] : null;
    const lab = lo == null ? `< ${m.legend(hi)}` : hi == null ? `≥ ${m.legend(lo)}` : `${m.legend(lo)}–${m.legend(hi)}`;
    const b = h('span', { cls: 'bin' + (S.legendBin === i ? ' on' : ''), role: 'button', tabindex: 0 }, [h('i', { cls: 'sw', style: `background:${c}` }), iso(lab)]);
    b.addEventListener('click', () => { S.legendBin = S.legendBin === i ? null : i; rerender(); });
    box.appendChild(b);
  });
  if (S.tMetric === 'g' && box.id === 'tLegend') box.appendChild(h('span', { cls: 'bin' }, [h('i', { cls: 'sw', style: `background:${NODATA}` }), T.no_data]));
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
  const box = clear($('#tSide')), sc = S.scope;
  if (sc.type === 'district' || sc.type === 'hood') {
    const d = DBY[sc.type === 'district' ? sc.d : HBY[sc.s].d];
    box.appendChild(h('h3', { text: `${distName(d.d)}` }));
    box.appendChild(h('p', { cls: 'note', text: FA ? `رتبه‌ی ${nf(d.rank)} از ۲۲ · ${nf(d.nh)} محله · ${nf(d.n)} آگهی` : `Rank ${d.rank} of 22 · ${d.nh} neighbourhoods · ${nf(d.n)} listings` }));
    box.appendChild(kvBox([[Mv(d.p), T.u_m], [spct(d.vs), T.k_vs], [d.g ? mult(d.g) : '–', T.k_growth]]));
    box.appendChild(kvBox([[nf(d.sz) + ' ' + T.u_sqm, T.k_size], [yr(Math.round(d.by)), T.k_year], [pct(d.el), T.f_elevator]]));
    const hs = HOODS.filter(x => x.d === d.d).sort((a, b) => b.p - a.p);
    const max = Math.max(...hs.map(x => x.p75 || x.p)) * 1.02;
    box.appendChild(h('div', { cls: 'note', text: FA ? 'محله‌ها: میانه (نقطه) و ۵۰٪ میانی (نوار)، میلیون تومان/متر' : 'Neighbourhoods: median (dot) and middle 50% (band), M toman/m²' }));
    const list = h('div', { cls: 'barlist' });
    hs.forEach(x => list.appendChild(barRow(hoodName(x) + (x.q === 'outlier_vs_district' ? ' ⚑' : ''), Mv(x.p), x.p25, x.p75, x.p, max,
      () => setScope({ type: 'hood', s: x.s }), { sel: sc.type === 'hood' && sc.s === x.s, color: x.q === 'ok' ? '#1c5cab' : '#898781' })));
    box.appendChild(list);
    const target = sc.type === 'hood' ? HBY[sc.s] : hs.find(x => x.q === 'ok') || hs[0];
    box.appendChild(h('div', { style: 'margin-top:12px;display:flex;gap:8px;flex-wrap:wrap' }, [
      h('button', { cls: 'chip on', text: (FA ? 'قیمت‌گذاری خانه در ' : 'Price a home in ') + hoodName(target), onclick: () => { pickHood(target.s); location.hash = '#pricing'; } })]));
    return;
  }
  box.appendChild(h('h3', { text: T.tehran_all }));
  box.appendChild(h('p', { cls: 'note', text: FA ? `۲۲ منطقه · ${nf(HOODS.length)} محله روی نقشه · ${nf(D.meta.tehran_listings_located)} آگهی` : `22 districts · ${HOODS.length} neighbourhoods on the map · ${nf(D.meta.tehran_listings_located)} listings` }));
  const m = T_METRICS[S.tMetric];
  const ds = DIST.slice().sort((a, b) => (b[S.tMetric] ?? -1) - (a[S.tMetric] ?? -1));
  const max = Math.max(...ds.map(d => d[S.tMetric] || 0)) * 1.02;
  box.appendChild(h('div', { cls: 'note', text: m.label + (['p'].includes(S.tMetric) ? ` (${T.u_m})` : S.tMetric === 'pm' ? ` (${unitB})` : '') }));
  const list = h('div', { cls: 'barlist' });
  ds.forEach(d => list.appendChild(barRow(distName(d.d), d[S.tMetric] != null ? m.legend(d[S.tMetric]) : '–', null, null, d[S.tMetric] || 0, max,
    () => setScope({ type: 'district', d: d.d }), { hover: on => highlightDist(d.d, on), color: RAMP[m.ramp][4] })));
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
  const el = $('#tRank');
  const ds = DIST.slice().sort((a, b) => b.p - a.p);
  const rowH = 17, f = frame(el, 560, ds.length * rowH + 40, { l: 70, r: 20, t: 14, b: 26 });
  const max = Math.max(...ds.map(d => d.q75)) * 1.05;
  const X = v => f.m.l + v / max * f.iw;
  niceTicks(0, max / 1e6, 5).forEach(t => {
    svg('line', { x1: X(t * 1e6), x2: X(t * 1e6), y1: f.m.t - 4, y2: f.h - f.m.b, class: 'gridl' }, f.s);
    text(f.s, X(t * 1e6), f.h - 8, nf(t), 'axis', { 'text-anchor': 'middle', 'font-size': 11, fill: '#898781' });
  });
  const sel = S.scope.type === 'district' ? S.scope.d : S.scope.type === 'hood' ? HBY[S.scope.s].d : null;
  ds.forEach((d, i) => {
    const y = f.m.t + i * rowH + rowH / 2;
    const g = svg('g', { style: 'cursor:pointer' }, f.s);
    svg('rect', { x: 0, y: y - rowH / 2, width: f.w, height: rowH, fill: sel === d.d ? '#eef5fd' : 'transparent' }, g);
    text(g, f.m.l - 8, y + 4, distName(d.d), 'clabel' + (sel === d.d ? ' b' : ''), { 'text-anchor': 'end' });
    svg('line', { x1: X(d.q25), x2: X(d.q75), y1: y, y2: y, stroke: '#cfe0f7', 'stroke-width': 6, 'stroke-linecap': 'round' }, g);
    if (d.p21 && d.rel21) {
      svg('line', { x1: X(d.p21), x2: X(d.p), y1: y, y2: y, stroke: '#9c9a92', 'stroke-width': 1.2 }, g);
      svg('circle', { cx: X(d.p21), cy: y, r: 4, fill: '#fff', stroke: '#eb6834', 'stroke-width': 1.8 }, g);
    }
    svg('circle', { cx: X(d.p), cy: y, r: 4.6, fill: '#1c5cab', stroke: '#fff', 'stroke-width': 1.5 }, g);
    g.addEventListener('pointermove', ev => showTip(ev, distName(d.d), [
      { k: FA ? '۱۴۰۳ (میانه)' : '1403 median', v: Mv(d.p) + ' ' + T.u_m_short, c: '#1c5cab' },
      { k: T.tip_iqr, v: `${Mv(d.q25)}–${Mv(d.q75)}` },
      { k: FA ? 'حدود ۱۴۰۰' : 'c. 1400', v: d.rel21 ? Mv(d.p21) + ' ' + T.u_m_short : T.no_data, c: '#eb6834' },
      { k: T.k_growth, v: d.g ? mult(d.g) : '–' }]));
    g.addEventListener('pointerleave', hideTip);
    g.addEventListener('pointerenter', () => highlightDist(d.d, true));
    g.addEventListener('pointerout', () => highlightDist(d.d, false));
    g.addEventListener('click', () => setScope({ type: 'district', d: d.d }));
  });
  const key = h('div', { cls: 'keyrow' }, [
    h('span', {}, [h('i', { style: 'background:#1c5cab;width:9px;height:9px;border-radius:50%' }), FA ? '۱۴۰۳ (دیوار، ۹۱ هزار آگهی)' : '1403 (Divar, 91k ads)']),
    h('span', {}, [h('i', { style: 'background:#fff;border:2px solid #eb6834;width:9px;height:9px;border-radius:50%' }), FA ? 'حدود ۱۴۰۰ (۳٬۴۴۷ آگهی)' : 'c. 1400 (3,447 ads)']),
    h('span', {}, [h('i', { cls: 'box', style: 'background:#cfe0f7' }), FA ? '۵۰٪ میانی محله‌ها' : 'middle 50% of neighbourhoods'])]);
  el.insertBefore(key, el.firstChild);
  const axisLab = h('div', { cls: 'note', style: 'text-align:center;margin:0', text: T.u_m });
  el.appendChild(axisLab);
}

// ------------------------------------------------------------------ catch-up scatter
function renderCatch() {
  const el = $('#tCatch');
  const ds = DIST.filter(d => d.g);
  const f = frame(el, 560, 360, { l: 46, r: 16, t: 14, b: 42 });
  const xs = ds.map(d => d.p21 / 1e6), ys = ds.map(d => d.g);
  const x0 = 10, x1 = Math.max(...xs) * 1.08, y0 = Math.min(...ys) * 0.92, y1 = Math.max(...ys) * 1.06;
  const X = v => f.m.l + (Math.log(v) - Math.log(x0)) / (Math.log(x1) - Math.log(x0)) * f.iw;
  const Y = v => f.m.t + (1 - (v - y0) / (y1 - y0)) * f.ih;
  logTicks(x0, x1).forEach(t => { svg('line', { x1: X(t), x2: X(t), y1: f.m.t, y2: f.m.t + f.ih, class: 'gridl' }, f.s); text(f.s, X(t), f.h - 24, nf(t), 'axis', { 'text-anchor': 'middle', 'font-size': 11, fill: '#898781' }); });
  niceTicks(y0, y1, 5).forEach(t => { svg('line', { x1: f.m.l, x2: f.m.l + f.iw, y1: Y(t), y2: Y(t), class: 'gridl' }, f.s); text(f.s, f.m.l - 6, Y(t) + 4, '×' + nf(t, 1), 'axis', { 'text-anchor': 'end', 'font-size': 11, fill: '#898781' }); });
  text(f.s, f.m.l + f.iw / 2, f.h - 6, FA ? 'قیمت هر متر در حدود ۱۴۰۰ (میلیون تومان، مقیاس لگاریتمی)' : 'Price per m² c. 1400 (M toman, log scale)', 'clabel', { 'text-anchor': 'middle' });
  // least-squares fit on logs
  const lx = xs.map(Math.log), ly = ys.map(Math.log), mx = lx.reduce((a, b) => a + b) / lx.length, my = ly.reduce((a, b) => a + b) / ly.length;
  const b = lx.reduce((s, v, i) => s + (v - mx) * (ly[i] - my), 0) / lx.reduce((s, v) => s + (v - mx) ** 2, 0), a = my - b * mx;
  const fx = [Math.min(...xs), Math.max(...xs)];
  svg('path', { d: `M${X(fx[0])},${Y(Math.exp(a + b * Math.log(fx[0])))}L${X(fx[1])},${Y(Math.exp(a + b * Math.log(fx[1])))}`, stroke: '#eb6834', 'stroke-width': 1.5, fill: 'none', opacity: .8 }, f.s);
  const sel = S.scope.type === 'district' ? S.scope.d : S.scope.type === 'hood' ? HBY[S.scope.s].d : null;
  ds.forEach(d => {
    const g = svg('g', { style: 'cursor:pointer' }, f.s);
    const cx = X(d.p21 / 1e6), cy = Y(d.g);
    svg('circle', { cx, cy, r: 12, fill: 'transparent' }, g);
    svg('circle', { cx, cy, r: sel === d.d ? 7.5 : 6, fill: sel === d.d ? '#0d366b' : '#3987e5', stroke: '#fff', 'stroke-width': 2 }, g);
    text(g, cx + 9, cy + 4, nf(d.d), 'clabel' + (sel === d.d ? ' b' : ''));
    g.addEventListener('pointermove', ev => showTip(ev, distName(d.d), [{ k: FA ? 'حدود ۱۴۰۰' : 'c. 1400', v: Mv(d.p21) + ' ' + T.u_m_short }, { k: '1403', v: Mv(d.p) + ' ' + T.u_m_short }, { k: T.k_growth, v: mult(d.g) }]));
    g.addEventListener('pointerleave', hideTip);
    g.addEventListener('click', () => setScope({ type: 'district', d: d.d }));
  });
  text(f.s, f.m.l + f.iw - 4, f.m.t + 12, (FA ? 'همبستگی ' : 'correlation ') + nf(D.meta.growth_corr, 2), 'clabel b', { 'text-anchor': 'end' });
}

// ================================================================== pricing tool
const hoodList = HOODS.filter(x => x.q === 'ok' || x.q === 'thin_sample').sort((a, b) => a.d - b.d || b.p - a.p);
function fillHoodSelect(filter = '') {
  const sel = clear($('#vHood')), f = filter.trim().toLowerCase();
  let lastD = null, grp = null;
  hoodList.forEach(x => {
    if (f && !(x.en.toLowerCase().includes(f) || (x.fa || '').includes(filter.trim()) || x.s.includes(f) || String(x.d) === f)) return;
    if (x.d !== lastD) { grp = h('optgroup', { label: distName(x.d) }); sel.appendChild(grp); lastD = x.d; }
    grp.appendChild(h('option', { value: x.s, text: `${hoodName(x)} — ${Mv(x.p)} ${T.u_m_short}` }));
  });
  sel.value = S.hood;
}
function pickHood(s) { S.hood = s; $('#vSearch').value = ''; fillHoodSelect(); renderValuation(); }
function estimate() {
  const x = HBY[S.hood];
  const A0 = x.sz || 85, R0 = x.r ?? 2, p0 = x.pk ?? .7, s0 = x.st ?? .85, e0 = x.el ?? .7;
  const base = x.p * A0;
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
  return { x, base, steps, price, roll, lo: price * V.interval.q10, hi: price * V.interval.q90, q25: price * V.interval.q25, q75: price * V.interval.q75, ppm2: price / S.area };
}
function renderValuation() {
  const e = estimate(), x = e.x, out = clear($('#vOut'));
  $('#vAreaOut').textContent = `${nf(S.area)} ${T.u_sqm}`;
  $('#vRollOut').textContent = S.roll ? spct(S.roll / 100) : (FA ? 'قیمت‌های ۱۴۰۳' : '1403 prices');
  const card = h('div', { cls: 'estimate' });
  card.appendChild(h('div', { cls: 'note', style: 'margin:0', text: `${T.est_title} · ${hoodName(x)}, ${distName(x.d)}` }));
  card.appendChild(h('div', { cls: 'big' }, [iso(Bv(e.price)), ' ', h('small', { text: unitB })]));
  card.appendChild(h('div', { cls: 'range' }, [T.est_range + ': ', h('b', { text: iso(`${Bv(e.lo)}–${Bv(e.hi)}`) }), ' ' + unitB]));
  card.appendChild(h('div', { cls: 'range' }, [h('b', { text: iso(Mv(e.ppm2)) }), ` ${unitM} (${T.est_ppm2})`]));
  if (x.q === 'thin_sample') card.appendChild(h('div', { cls: 'note', style: 'margin:6px 0 0', text: '⚠ ' + T.tip_thin }));
  out.appendChild(card);

  // position strip inside neighbourhood distribution
  out.appendChild(h('h3', { style: 'margin-top:16px', text: T.est_pos }));
  const pos = h('div', { cls: 'chart' }); out.appendChild(pos);
  const f = frame(pos, 560, 70, { l: 12, r: 12, t: 18, b: 20 });
  const lo = Math.min(x.p25, e.ppm2 / e.roll, x.p) * 0.8, hi = Math.max(x.p75, e.ppm2 / e.roll, x.p) * 1.2;
  const lo2 = Math.min(lo, e.ppm2) , hi2 = Math.max(hi, e.ppm2 * 1.05);
  const X = v => f.m.l + (v - lo2) / (hi2 - lo2) * f.iw;
  svg('line', { x1: f.m.l, x2: f.m.l + f.iw, y1: 36, y2: 36, stroke: '#e1e0d9', 'stroke-width': 8, 'stroke-linecap': 'round' }, f.s);
  svg('line', { x1: X(x.p25 * e.roll), x2: X(x.p75 * e.roll), y1: 36, y2: 36, stroke: '#a9cdf5', 'stroke-width': 8, 'stroke-linecap': 'round' }, f.s);
  svg('line', { x1: X(x.p * e.roll), x2: X(x.p * e.roll), y1: 28, y2: 44, stroke: '#1c5cab', 'stroke-width': 2 }, f.s);
  svg('circle', { cx: X(e.ppm2), cy: 36, r: 7, fill: '#eb6834', stroke: '#fff', 'stroke-width': 2 }, f.s);
  text(f.s, X(e.ppm2), 14, (FA ? 'این خانه ' : 'this home ') + Mv(e.ppm2), 'clabel b', { 'text-anchor': 'middle' });
  text(f.s, X(x.p25 * e.roll), 62, Mv(x.p25 * e.roll), 'clabel', { 'text-anchor': 'middle' });
  text(f.s, X(x.p75 * e.roll), 62, Mv(x.p75 * e.roll), 'clabel', { 'text-anchor': 'middle' });
  out.appendChild(h('div', { cls: 'keyrow' }, [h('span', {}, [h('i', { cls: 'box', style: 'background:#a9cdf5' }), `${T.tip_iqr} (${hoodName(x)})`]), h('span', {}, [h('i', { style: 'background:#1c5cab;width:2px;height:12px' }), FA ? 'میانه‌ی محله' : 'neighbourhood median']), h('span', {}, [h('i', { style: 'background:#eb6834;width:9px;height:9px;border-radius:50%' }), FA ? 'این خانه' : 'this home'])]));

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
    const lab = k === 'base_typ' ? `${T.base_typ} (${nf(x.sz)} ${T.u_sqm})` : T[k];
    text(g.s, g.m.l - 8, y + rh / 2 + 4, lab, 'clabel' + (k === 'result' ? ' b' : ''), { 'text-anchor': 'end' });
    let x0, x1, col;
    if (start == null) { x0 = WX(0); x1 = WX(v); col = k === 'result' ? '#eb6834' : '#3987e5'; }
    else { x0 = WX(Math.min(start, start + v)); x1 = WX(Math.max(start, start + v)); col = v >= 0 ? '#1baf7a' : '#d03b3b'; }
    svg('rect', { x: x0, y: y + 5, width: Math.max(1.5, x1 - x0), height: rh - 10, rx: 3, fill: col }, g.s);
    const vs = start == null ? Bv(v) : (v >= 0 ? '+' : '−') + Bv(Math.abs(v));
    text(g.s, x1 + 6, y + rh / 2 + 4, vs, 'clabel');
  });

  // alternatives + same money elsewhere
  const alt = HOODS.filter(o => o.q === 'ok' && o.d !== x.d && Math.abs(o.p / x.p - 1) < 0.07).sort((a, b) => b.n - a.n).slice(0, 8);
  out.appendChild(h('h3', { style: 'margin-top:14px', text: T.est_alt }));
  out.appendChild(h('div', { cls: 'chips' }, alt.map(o => h('button', { cls: 'chip', text: `${hoodName(o)} · ${nf(o.d)}`, title: `${Mv(o.p)} ${unitM}`, onclick: () => pickHood(o.s) }))));
  const left = clear($('#vLeft'));
  left.appendChild(h('h3', { text: T.est_buy }));
  left.appendChild(h('p', { cls: 'note', text: FA ? `با ${Bv(e.price)} میلیارد تومان، به قیمت میانه‌ی هر منطقه چند متر می‌شود خرید` : `What ${Bv(e.price)} B toman buys at each district's median price per m²` }));
  const buy = h('div', { cls: 'barlist', style: 'max-height:none' }); left.appendChild(buy);
  const ref = [1, 3, 2, 6, 5, 22, 4, 10, 16, 18].map(d => DBY[d]).sort((a, b) => a.p - b.p);
  const sqm = ref.map(d => e.price / (d.p * e.roll)); const mx = Math.max(...sqm) * 1.05;
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
  const box = clear($('#vRollChips')), kil = Math.round(KILID_ROLL * 100);
  [[0, FA ? 'قیمت‌های ۱۴۰۳' : '1403 prices'], [kil, (FA ? 'کیلید مرداد ۱۴۰۵: ' : 'Kilid, Mordad 1405: ') + spct(KILID_ROLL)]].forEach(([v, l]) =>
    box.appendChild(h('button', { cls: 'chip' + (S.roll === v ? ' on' : ''), text: l, onclick: () => { S.roll = v; $('#vRoll').value = v; renderRollChips(); renderValuation(); } })));
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
  e.addEventListener('pointermove', ev => showTip(ev, cityName(c) + ' · ' + provName(PBY[c.iso]), [
    { k: T.k_ppm2, v: Mv(c.p) + ' ' + T.u_m_short }, { k: T.k_price, v: Bv(c.pm) + ' ' + unitB }, { k: T.k_size, v: nf(c.sz) + ' ' + T.u_sqm }, { k: T.u_list, v: nf(c.n) }],
    c.exact ? null : (FA ? 'موقعیت: مرکز شهرستان' : 'Placed at its county centre')));
  e.addEventListener('pointerleave', hideTip);
  e.addEventListener('click', ev => { ev.stopPropagation(); if (!iZoom.moved) setScope({ type: 'province', iso: c.iso }); });
});
PROV.filter(p => p.p != null).forEach(p => { const t = text(iLabG, p.lx, p.ly, provName(p), 'dlabel'); t.setAttribute('font-size', 10.5); t.setAttribute('font-weight', 600); });
function provTip(ev, p) {
  showTip(ev, provName(p) + (p.rank ? ` · ${T.k_rank} ${nf(p.rank)}` : ''), [
    { k: T.k_ppm2, v: Mv(p.p) + ' ' + T.u_m_short }, { k: T.k_vsn, v: spct(p.vs) }, { k: T.k_price, v: Bv(p.pm) + ' ' + unitB },
    { k: T.k_size, v: nf(p.sz) + ' ' + T.u_sqm }, { k: (FA ? 'شهر · آگهی' : 'cities · ads'), v: `${nf(p.c)} · ${nf(p.n)}` }]);
}
let iLegendBin = null;
function renderIranMap() {
  const m = I_METRICS[S.iMetric];
  const sc = makeScale(PROV.map(p => p[S.iMetric]), RAMP[m.ramp]);
  const cityScale = makeScale(CITIES.map(c => c.p), RAMP.blue);
  const sel = S.scope.type === 'province' ? S.scope.iso : null;
  iProvG.querySelectorAll('path').forEach(e => {
    const p = PBY[e.dataset.iso];
    e.setAttribute('fill', S.iCities ? '#efeee9' : sc(p[S.iMetric]));
    if (S.iCities && sel === p.iso) e.setAttribute('fill', '#e3e1da');
    e.classList.toggle('sel', sel === p.iso);
    e.classList.toggle('dim', !S.iCities && iLegendBin != null && sc.bin(p[S.iMetric]) !== iLegendBin);
  });
  iCityG.style.display = S.iCities ? '' : 'none';
  iCityG.querySelectorAll('circle').forEach((e, i) => {
    const c = CITIES.slice().sort((a, b) => b.n - a.n)[i];
    e.setAttribute('fill', cityScale(c.p));
    e.setAttribute('opacity', (sel && c.iso !== sel) || (iLegendBin != null && S.iCities && cityScale.bin(c.p) !== iLegendBin) ? 0.2 : 1);
  });
  iLabG.querySelectorAll('text').forEach(t => t.style.display = S.iCities ? 'none' : '');
  const box = $('#iLegend');
  if (S.iCities) { const save = S.legendBin; S.legendBin = iLegendBin; renderLegend(box, cityScale, { label: FA ? 'قیمت هر متر در شهرها (دایره: تعداد آگهی)' : 'City price per m² (bubble = listings)', legend: v => Mv(v) }, () => {}); S.legendBin = save; }
  else { const save = S.legendBin; S.legendBin = iLegendBin; renderLegend(box, sc, m, () => {}); S.legendBin = save; }
  box.querySelectorAll('.bin[role=button]').forEach((b, i) => b.addEventListener('click', () => { iLegendBin = iLegendBin === i ? null : i; renderIranMap(); }));
}
function renderIranSide() {
  const box = clear($('#iSide')), sc = S.scope;
  if (sc.type === 'province') {
    const p = PBY[sc.iso];
    box.appendChild(h('h3', { text: `${T.province} ${provName(p)}` }));
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
  box.appendChild(h('h3', { text: T.iran_all }));
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
    const r = svg('rect', { x: X(t), y: Math.min(Y(v), Y(0)), width: bw, height: Math.abs(Y(v) - Y(0)), rx: 1.5, fill: '#3987e5' }, f.s);
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
    [nf(D.meta.listings_2024_total), 'آگهی دیوار، ۴۲۰ شهر'], [nf(D.meta.tehran_listings_located), 'آگهی تهران روی نقشه'], [nf(D.meta.listings_2021), 'آگهی تک‌به‌تک برای مدل'],
    ...(LIVE ? [[nf(LIVE.ads_used), `آگهی تازه‌ی تهران، ${liveDate()}`]] : []),
    ['۹۱', 'ماه قیمت رسمی بانک مرکزی'], ['۱۲', 'ماه شاخص کیلید'], ['۰', 'کتابخانه‌ی خارجی']]
    : [[nf(D.meta.listings_2024_total), 'Divar ads, 420 cities'], [nf(D.meta.tehran_listings_located), 'Tehran ads on the map'], [nf(D.meta.listings_2021), 'individual ads for the model'],
      ...(LIVE ? [[nf(LIVE.ads_used), `fresh Tehran ads, ${liveDate()}`]] : []),
      ['91', 'months of Central Bank prices'], ['12', 'months of Kilid indicator'], ['0', 'external libraries']];
  items.forEach(([v, l]) => box.appendChild(h('span', { cls: 'pill' }, [h('b', { text: iso(v) }), ' ' + l])));
}

// ================================================================== wiring
function initControls() {
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
  initControls(); initValuation(); renderPills();
  renderKPIs(); renderTehranMap(); renderTehranSide(); renderRank(); renderCatch();
  renderValuation(); renderIranMap(); renderIranSide(); renderMajor(); renderSat();
  renderForecast(); renderLeaderboard(); renderYoY(); renderModel(); renderData();
}
boot();
})();
