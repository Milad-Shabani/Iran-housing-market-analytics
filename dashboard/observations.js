// All plots consume this one selection. Aggregates only fit inside a period that contains
// their entire source interval. A monthly archive observation can never stand in for a day.
const tr = (en, fa) => (FA ? fa : en);
const ledger = Object.fromEntries(
  Object.entries(D.observations.markets).map(([market, records]) => [
    market,
    records.map((values) => Object.fromEntries(D.observations.columns.map((key, i) => [key, values[i]])))
  ])
);
const markets = {sale:T.ob_sale, rent:T.ob_rent, deposit:T.ob_deposit};
const sources = {archive: tr('Divar monthly archive','آرشیو ماهانهٔ دیوار'), panel: tr('Weekly city survey','نمونهٔ هفتگی شهرها'), tehran_map: tr('Tehran district survey','برداشت مناطق تهران')};
const selectedMarket = {kind: 'sale', period: 'y:' + S.year};
const solarFormat = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', {
  year: 'numeric',
  month: '2-digit',
  timeZone: 'UTC'
});
const dayFormat = new Intl.DateTimeFormat(LOC, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC'
});
const gregMonthFormat = new Intl.DateTimeFormat(FA ? 'fa-IR-u-ca-gregory' : 'en-GB', {
  year: 'numeric',
  month: 'long',
  timeZone: 'UTC'
});
const isoDate = (value) => new Date(value + 'T12:00:00Z');
const solarCache = new Map();
function solarMonth(day) {
  if (!solarCache.has(day)) {
    const parts = Object.fromEntries(solarFormat.formatToParts(isoDate(day)).map((p) => [p.type, p.value]));
    solarCache.set(day, parts.year + '-' + parts.month);
  }
  return solarCache.get(day);
}
function inPeriod(start, end, period) {
  if (period === 'all') return true;
  const [kind, value] = period.split(':');
  if (!value) return false;
  if (kind === 'r') {
    const [from,to] = value.split('/');
    return !!from && !!to && from <= start && end <= to;
  }
  if (kind === 'd') return start === value && end === value;
  if (kind === 'm') return start.slice(0, 7) === value && end.slice(0, 7) === value;
  const length = kind === 'y' ? 4 : 7;
  return ['j', 'y'].includes(kind) && [start, end].every((d) => solarMonth(d).slice(0, length) === value);
}
const coverageByYear = Object.fromEntries(Object.entries(ledger).map(([market,rows]) => {
  const years = {};
  for (const r of rows) {
    const y = solarMonth(r.period_start).slice(0,4);
    if (!inPeriod(r.period_start,r.period_end,'y:' + y)) continue;
    const c = years[y] ||= {t:false,i:false,c:false,k:false};
    if (r.area_level === 'district') c.t = true;
    else c.i = true;
  }
  return [market,years];
}));
const palette = ['#1765a3', '#087a63', '#ab4e13', '#855192', '#b13e59', '#57772d', '#176b80', '#805f40'];
const amount = (n) => Mv(n, 2);
const cityIndex = {...Object.fromEntries(D.city_monthly.cities.map(c => [c.s,c])), ...CBY};
const areaName = (r) =>
  r.area_level === 'district'
    ? distName(+r.area)
    : r.area_level === 'province'
      ? provName(PBY[r.area])
      : cityName(cityIndex[r.area] || { en: r.area });
const unitName = (u) =>
  ({
    toman_per_m2: tr('million toman per m²', 'میلیون تومان برای هر متر مربع'),
    toman_per_apartment: tr('million toman per apartment', 'میلیون تومان برای هر آپارتمان'),
    source_units_per_m2: tr('million archive units per m²', 'میلیون واحد منبع آرشیو برای هر متر مربع'),
    source_units_per_apartment: tr(
      'million archive units per apartment',
      'میلیون واحد منبع آرشیو برای هر آپارتمان'
    )
  })[u];
const dayLabel = (day) => dayFormat.format(isoDate(day));
const monthLabel = (day) => gregMonthFormat.format(isoDate(day));
const stamp = (r) =>
  r.period_start === r.period_end ? dayLabel(r.period_start) : monthLabel(r.period_start);
function periodLabel(period) {
  if (period === 'all') return tr('All periods', 'همهٔ دوره‌ها');
  const [mode, v] = period.split(':');
  if (!v) return tr('Choose a date','تاریخ را انتخاب کنید');
  if (mode === 'r') {
    const [from,to] = v.split('/');
    return from && to ? dayLabel(from) + ' – ' + dayLabel(to) : tr('Choose both dates','ابتدا و انتهای بازه را انتخاب کنید');
  }
  if (mode === 'd') return dayLabel(v);
  if (mode === 'm') return monthLabel(v + '-01');
  if (mode === 'y') return tr('Solar year ', 'سال ') + yr(+v);
  return mLabel(...v.split('-').map(Number));
}
const isOverview = () => selectedMarket.kind === 'sale' && selectedMarket.period === 'all';
const nativeTehran = () => selectedMarket.kind === 'sale' && (selectedMarket.period === 'y:1400' || selectedMarket.period === 'y:1403' || (LIVE && inPeriod(LIVE.collected_on,LIVE.collected_on,selectedMarket.period)));
const labelMetric = () => markets[selectedMarket.kind];
const pick = r => inPeriod(r.period_start, r.period_end, selectedMarket.period);
const option = (box, value, label) => box.appendChild(h('option', {value, text: label}));
const absence = () => tr('No observation for ', 'داده‌ای ثبت نشده برای ') + labelMetric() + ' · ' + periodLabel(selectedMarket.period);
function lastSlice(rows) {
  const last = rows.reduce((m, r) => (r.period_start > m ? r.period_start : m), '');
  return rows.filter((r) => r.period_start === last);
}
function note(box, message) {
  box.appendChild(h('p', { cls: 'note', text: message }));
}
function drawSeries(box, groups, labelAt, format, gap) {
  const all = groups.flatMap((g) => g.points);
  const dates = [...new Set(all.map((v) => v.x))].sort((a, b) => a - b);
  if (!dates.length) return;
  const key = h('div', { cls: 'keyrow' }),
    chart = h('div', {
      cls: 'chart',
      role: 'img',
      'aria-label': box.closest('.card')?.querySelector('h3')?.textContent || labelMetric()
    });
  box.append(key, chart);
  const series = groups.map((g, i) => {
    const color = palette[i % palette.length];
    key.appendChild(h('span', {}, [h('i', { style: 'background:' + color }), g.name]));
    const pts = [],
      sorted = g.points.slice().sort((a, b) => a.x - b.x);
    sorted.forEach((p, j) => {
      if (j && (g.gap || gap) && p.x - sorted[j - 1].x > (g.gap || gap)) pts.push([p.x - 0.1, null]);
      pts.push([p.x, p.y]);
    });
    return { pts, color, dots: true };
  });
  const vals = all.map((p) => p.y),
    lo = Math.min(0, ...vals),
    hi = Math.max(0, ...vals);
  const margin = Math.max(1, (dates.at(-1) - dates[0]) * 0.035);
  lineChart(chart, {
    w: 720,
    h: 210,
    m: { l: 59, r: 32, t: 13, b: 40 },
    xMin: dates[0] - margin,
    xMax: dates.at(-1) + margin,
    yMin: lo - (lo ? (hi - lo) * 0.04 : 0),
    yMax: hi + (hi - lo || 1) * 0.12,
    yFmt: format,
    xTicks: dates.filter((_, i) => i % Math.max(1, Math.ceil(dates.length / 5)) === 0),
    xFmt: labelAt,
    series,
    crosshair: (x) =>
      dates.includes(x)
        ? {
            title: labelAt(x),
            rows: groups.flatMap((g, i) => {
              const p = g.points.find((p) => p.x === x);
              return p ? [{ k: g.name, v: format(p.y), c: palette[i % palette.length] }] : [];
            })
          }
        : null
  });
}
function drawRange(box, rows) {
  const sorted = rows.slice().sort((a, b) => b.median - a.median);
  const chart = h('div', { cls: 'chart', role: 'img', 'aria-label': labelMetric() });
  box.appendChild(chart);
  const f = frame(chart, 720, 28 * sorted.length + 42, { l: 96, r: 38, t: 12, b: 24 });
  const right = Math.max(...sorted.map((r) => r.p75)) * 1.06;
  const X = (v) => f.m.l + (v / right) * f.iw;
  for (const v of niceTicks(0, right)) {
    svg('line', { x1: X(v), x2: X(v), y1: f.m.t, y2: f.h - f.m.b, class: 'gridl' }, f.s);
    text(f.s, X(v), f.h - 6, Mv(v, 0), 'axis', { 'text-anchor': 'middle' });
  }
  sorted.forEach((r, i) => {
    const y = 24 + 28 * i;
    text(f.s, f.m.l - 8, y + 4, areaName(r), 'clabel', { 'text-anchor': 'end' });
    const group = svg('g', {}, f.s);
    svg(
      'line',
      {
        x1: X(r.p25),
        x2: X(r.p75),
        y1: y,
        y2: y,
        stroke: '#b8d7e6',
        'stroke-width': 7,
        'stroke-linecap': 'round'
      },
      group
    );
    svg('circle', { cx: X(r.median), cy: y, r: 5, fill: '#1765a3' }, group);
    const title = svg('title', {}, group);
    title.textContent = areaName(r) + ' · ' + amount(r.median) + ' · ' + stamp(r);
  });
}
const dayNumber = (s) => Math.round(Date.parse(s + 'T00:00:00Z') / 86400000);
const numberDay = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
function drawOfficial(box, official, tehran) {
  const charts = [];
  for (const [key, name] of [
    ['cbi', T.cbi],
    ['kil', T.kilid]
  ]) {
    const series = official.filter((r) => r[key] != null);
    if (series.length)
      charts.push({ name, points: series.map((r) => ({ x: dayNumber(r.date), y: r[key] })) });
  }
  if (tehran.length)
    charts.push({
      name: tr('Divar asking prices', 'قیمت پیشنهادی دیوار'), gap: 8,
      points: tehran.map((r) => ({ x: dayNumber(r.period_start), y: r.median }))
    });
  note(
    box,
    tr(
      'Published observations in this period · million toman per m²',
      'مشاهده‌های منتشرشدهٔ همین دوره · میلیون تومان برای هر متر مربع'
    )
  );
  const dates = new Map(official.map((r) => [dayNumber(r.date), mLabel(r.y, r.m)]));
  drawSeries(box, charts, (x) => dates.get(x) || dayLabel(numberDay(x)), amount, 32);
}

const measureNames = {
  median: tr('Median asking amount', 'میانهٔ مبلغ پیشنهادی'),
  median_per_apartment: tr('Median per apartment', 'میانه برای هر آپارتمان'),
  median_per_m2: tr('Median per m²', 'میانه برای هر متر مربع'),
  median_area_m2: tr('Median floor area (m²)', 'میانهٔ متراژ (متر مربع)'),
  rooms: tr('Two-bedroom share', 'سهم دوخوابه‌ها'),
  listings: tr('Listings in sample', 'تعداد آگهی در نمونه'),
  iqr: tr('Middle 50%', 'بازهٔ ۵۰٪ میانی'),
  coverage: tr('Areas covered', 'تعداد محدوده‌های نمونه')
};
const roomShare = r => r?.rooms_reported > 0 ? pct(r.two_bedroom_listings / r.rooms_reported, 1) : '—';
const numberOrDash = v => v == null ? '—' : nf(v, Number.isInteger(v) ? 0 : 1);
const marketUnit = r => r.source === 'archive' ? tr('archive units','واحد منبع آرشیو') : tr('toman','تومان');
const measureTitle = () => labelMetric() + ' · ' + (selectedMarket.kind === 'sale' ? measureNames.median_per_m2 : measureNames.median_per_apartment);
const surveyMarkers = svg('g', {}, iG);
let districtRows = new Map(), provinceRows = new Map();
const dateIndex = m => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;
const dateValue = r => r.source === 'archive' ? dateIndex(r.period_start) : dayNumber(r.period_start);
const sourceDate = r => r.source === 'archive' ? r.period_start.slice(0, 7) : r.period_start;
const unique = list => [...new Set(list)];
const mapByArea = rows => new Map(rows.map(r => [r.area, r]));
const localKey = r => r.area_level === 'province' ? 'p:' + r.area : r.area;
function table(box, headers, rows) {
  const body = h('tbody');
  const tab = h('table', {cls:'t'}, [h('thead', {}, h('tr', {}, headers.map(text => h('th', {scope:'col', text})))), body]);
  for (const row of rows) body.append(h('tr', {}, row.map(text => h('td', {text}))));
  box.append(h('div', {cls:'obs-table'}, tab));
}
function profileTable(box, rows, withCoverage = false) {
  if (!rows.length) return;
  const complement = selectedMarket.kind === 'sale' ? 'median_per_apartment' : 'median_per_m2';
  const headers = [tr('Area','محدوده'), measureTitle(), measureNames.iqr, measureNames[complement],
    measureNames.median_area_m2, measureNames.rooms, tr('Two-bedroom / known rooms', 'دوخوابه / آگهی با اتاق مشخص'), measureNames.listings];
  if (withCoverage) headers.push(measureNames.coverage);
  table(box, headers, rows.map(r => {
    const cells = [areaName(r), numberOrDash(r.median), numberOrDash(r.p25) + ' – ' + numberOrDash(r.p75),
      numberOrDash(r[complement]), numberOrDash(r.median_area_m2), roomShare(r),
      r.rooms_reported == null ? '—' : nf(r.two_bedroom_listings) + ' / ' + nf(r.rooms_reported), nf(r.listings)];
    if (withCoverage) cells.push(numberOrDash(r.areas_covered));
    return cells;
  }));
}
function explainSource(source) {
  if (source === 'archive') return tr('Calendar months from Divar’s apartment archive. Each published area/month has at least 50 eligible ads. The source currency is undocumented. Province figures pool individual listings.',
    'ماه‌های میلادی آرشیو آپارتمان دیوار. هر محدوده در هر ماه دست‌کم ۵۰ آگهی واجد شرایط دارد. واحد پول آرشیو مستند نشده است. میانهٔ استان از خود آگهی‌های شهرهای آن محاسبه شده است.');
  if (source === 'panel') return tr('Amounts in toman from fixed neighbourhood samples on the recorded day. A city sample describes its surveyed areas. A listing may report both a rent and a deposit.',
    'مبلغ‌ها به تومان و مربوط به محله‌های نمونه در روز برداشت‌اند. نمونهٔ هر شهر فقط محله‌های بررسی‌شده را پوشش می‌دهد. یک آگهی می‌تواند هم اجاره و هم ودیعهٔ مشخص داشته باشد.');
  return tr('The Tehran district survey uses listing-weighted neighbourhood medians for its per-m² benchmark. Only accepted collection dates are included.',
    'شاخص قیمت هر متر تهران از میانهٔ محله‌ها با وزن تعداد آگهی محاسبه می‌شود. فقط تاریخ‌های دارای پوشش کافی در جدول آمده‌اند.');
}
function exportObservations(rows) {
  const columns = D.observations.columns.filter(c => c !== 'area');
  const values = [['area','period',...columns], ...rows.map(r => [r.area, sourceDate(r), ...columns.map(c => r[c])])];
  const csv = values.map(row => row.map(v => '"' + String(v ?? '').replaceAll('"', '""') + '"').join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF' + csv + '\r\n'], {type:'text/csv;charset=utf-8'}));
  const a = h('a', {href:url, download:'divar-' + selectedMarket.kind + '-' + rows[0].source + '.csv'});
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const selectors = ['#chCity1','#chCity2','#chCity3'].map(s => $(s));
let cityPool = [], visibleCityRows = [], rangeKey = '';
function citySeries(box, rows) {
  if (!rows.length) return;
  const monthly = rows[0].source === 'archive';
  const groups = [...new Map(rows.map(r => [localKey(r), areaName(r)]))].map(([key,name]) => ({
    name: unique(rows.map(r => r.source)).length > 1 ? name + ' · ' + sources[rows.find(r => localKey(r) === key).source] : name, points: rows.filter(r => localKey(r) === key).map(r => ({x:dateValue(r), y:r.median}))
  }));
  const labels = new Map(rows.map(r => [dateValue(r), stamp(r)]));
  drawSeries(box, groups, x => labels.get(x), amount, monthly ? 1 : 8);
}
function renderCityTable() {
  const box = clear($('#chTable')), val = $('#chMonth').value;
  const rows = visibleCityRows.filter(r => String(dateValue(r)) === val);
  if (rows.length) profileTable(box, rows, rows.some(r => r.areas_covered != null));
  else note(box, absence());
}
function fillDates(select, dates, labels, value, fallback) {
  clear(select);
  for (const d of dates) option(select, d, labels.get(d));
  select.value = dates.includes(+value) && value !== '' ? value : fallback ?? '';
  select.disabled = !dates.length;
}
function renderCityChart() {
  const keys = selectors.map(sel => sel.value).filter(Boolean);
  const rows = cityPool.filter(r => keys.includes(localKey(r)));
  const labels = new Map(rows.map(r => [dateValue(r), stamp(r)]));
  const dates = [...labels.keys()].sort((a,b) => a-b);
  const from = $('#chFrom'), to = $('#chTo'), month = $('#chMonth');
  fillDates(from, dates, labels, from.value, dates[0]);
  fillDates(to, dates, labels, to.value, dates.at(-1));
  if (+from.value > +to.value) to.value = from.value;
  const span = dates.filter(t => t >= +from.value && t <= +to.value);
  visibleCityRows = rows.filter(r => span.includes(dateValue(r)));
  fillDates(month, span, labels, month.value, span.at(-1));
  const chart = clear($('#chChart'));
  if (visibleCityRows.length) citySeries(chart, visibleCityRows);
  else note(chart, absence());
  $('#chCSV').disabled = !visibleCityRows.length;
  $('#cityHistory').setAttribute('aria-disabled',String(!cityPool.length));
  for (const select of selectors) select.disabled = !cityPool.length;
  $('#chChart').setAttribute('aria-disabled', String(!visibleCityRows.length));
  renderCityTable();
}
function updateCities(rows) {
  const eligible = rows.filter(r => r.area_level === 'city' || r.area_level === 'province');
  const useArchive = isOverview() || lastSlice(eligible)[0]?.source === 'archive';
  cityPool = eligible.filter(r => (r.source === 'archive') === useArchive);
  const families = unique(cityPool.map(r => r.source));
  const active = families.join('/');
  const key = [selectedMarket.kind,selectedMarket.period,active].join('/');
  if (key !== rangeKey) {
    for (const s of ['#chFrom','#chTo','#chMonth']) clear($(s));
    rangeKey = key;
  }
  // Keep explicit area choices across dates, including when their observations are missing.
  const src = cityPool[0];
  $('#chCoverage').textContent = src ? [labelMetric(), families.map(f => sources[f]).join(' / '), nf(unique(cityPool.map(localKey)).length) + ' ' + tr('areas','محدوده')].join(' · ') : absence();
  $('#chDesc').textContent = tr('Compare up to three cities or provinces. Table values and sample sizes describe the selected observation date.', 'تا سه شهر یا استان را مقایسه کنید. مبلغ‌ها و تعداد آگهی‌های جدول مربوط به تاریخ همان ردیف‌اند.');
  $('#chUnits').textContent = src ? tr('Chart in ', 'محور نمودار به ') + unitName(src.unit) + tr('. Table amounts in ', '؛ مبلغ‌های جدول به ') + marketUnit(src) + '.' : '';
  const limits = clear($('#chLimits'));
  if (src) {
    limits.append(document.createTextNode(families.map(explainSource).join(' ') + ' '));
    const address = useArchive ? 'https://huggingface.co/datasets/divarofficial/real_estate_ads' : 'https://divar.ir/';
    limits.append(h('a', {text:T.ob_source, href:address, target:'_blank', rel:'noopener'}));
  }
  renderCityChart();
}

function observedTip(ev, row, name) {
  if (!row) return showTip(ev, name, [], absence());
  const pairs = [
    [measureTitle(), numberOrDash(row.median) + ' ' + marketUnit(row)],
    [measureNames.median_area_m2, numberOrDash(row.median_area_m2)],
    [measureNames.rooms, roomShare(row)], [measureNames.listings, nf(row.listings)]
  ];
  showTip(ev, name + ' · ' + stamp(row), pairs.map(([k,v]) => ({k,v})), sources[row.source]);
}
function latestMapRows(region, rows) {
  if (region === 'tehran') return lastSlice(rows.filter(r => r.area_level === 'district'));
  // Select a single comparable survey for a map, without substituting a stale province value for a city.
  const available = rows.filter(r => r.area_level !== 'district');
  const latest = lastSlice(available);
  const source = ['panel','archive','tehran_map'].find(s => latest.some(r => r.source === s));
  if (source === 'archive') {
    // Map one common month. A thin final month can cover just Tehran.
    const counts = new Map();
    for (const r of available.filter(r => r.area_level === 'province')) counts.set(r.period_start,(counts.get(r.period_start) || 0)+1);
    const best = [...counts].sort(([a,n],[b,m]) => m-n || b.localeCompare(a))[0];
    if (best) return available.filter(r => r.source === source && r.period_start === best[0]);
  }
  return latest.filter(r => r.source === source);

}
function overviewCityMap() {
  return isOverview() && S.year !== 1403 && overviewCities().length > 0;
}
function overviewCities() {
  return latestMapRows('iran', ledger.sale.filter(r => r.source === 'panel' && solarMonth(r.period_start).startsWith(String(S.year) + '-')));
}
const metricFields = {p:'median', pm:'median_per_apartment', sz:'median_area_m2', n:'listings', rooms:'rooms'};
const metricLabel = k => k === 'p' ? measureTitle() : measureNames[metricFields[k]];
function metricValue(r, k) {
  if (!r) return null;
  if (k === 'rooms') return r.rooms_reported ? r.two_bedroom_listings / r.rooms_reported : null;
  return r[metricFields[k]];
}
const mapMetrics = {iran:'p', tehran:'p'};
const originalOptions = {};
function mapOptions(region, rows, useObserved) {
  const sel = $(region === 'iran' ? '#iMetric' : '#tMetric');
  if (!originalOptions[region]) originalOptions[region] = [...sel.options].map(o => [o.value, o.text]);
  if (!useObserved && sel.dataset.observed !== 'true') return;
  clear(sel);
  if (!useObserved) {
    for (const [value,label] of originalOptions[region]) option(sel,value,label);
    sel.value = region === 'iran' ? S.iMetric : S.tMetric;
    sel.dataset.observed = 'false';
    sel.disabled = false;
    return;
  }
  for (const key of Object.keys(metricFields)) {
    if (key === 'pm' && selectedMarket.kind !== 'sale') continue;
    if (key !== 'p' && !rows.some(r => metricValue(r,key) != null)) continue;
    option(sel,key,metricLabel(key));
  }
  if (![...sel.options].some(o => o.value === mapMetrics[region])) mapMetrics[region] = 'p';
  sel.value = mapMetrics[region];
  sel.disabled = !rows.length;
  sel.dataset.observed = 'true';
}
function renderObservedMap(region, rows) {
  const iran = region === 'iran', prefix = iran ? 'i' : 't';
  const snapshot = latestMapRows(region, rows);
  const province = snapshot.filter(r => r.area_level === 'province');
  const cities = snapshot.filter(r => r.area_level === 'city' && CBY[r.area]);
  const cityLayer = iran && cities.length > 0 && (!province.length || S.iCities);
  const shapes = iran ? province : snapshot, units = cityLayer ? cities : shapes;
  const byCode = mapByArea(shapes);
  if (iran) provinceRows = byCode;
  else districtRows = byCode;
  mapOptions(region, units, true);
  const k = mapMetrics[region], values = units.map(r => metricValue(r,k)).filter(v => v != null);
  const scale = makeScale(values, k === 'p' || k === 'pm' ? RAMP.blue : RAMP.teal);
  const active = values.length > 0;
  const shapeGroup = iran ? iProvG : tDistG;
  for (const path of shapeGroup.querySelectorAll('path')) {
    const code = iran ? path.dataset.iso : path.dataset.d, v = metricValue(byCode.get(code),k);
    path.setAttribute('fill', cityLayer || v == null ? NODATA : scale(v));
    path.classList.remove('dim');
    path.classList.toggle('sel', iran ? S.scope.iso === code : String(S.scope.d) === code);
    path.setAttribute('tabindex', active ? '0' : '-1');
  }
  if (iran) {
    clear(surveyMarkers); iCityG.style.display = 'none';
    $('#iCities').checked = !!cityLayer;
    $('#iCities').disabled = !cities.length || !province.length;
    for (const label of iLabG.children) label.style.display = cityLayer ? 'none' : '';
    if (cityLayer) {
      for (const r of cities) {
        const c = CBY[r.area], v = metricValue(r,k), rad = Math.min(8, Math.max(3,cityR(r.listings)));
        const dot = svg('circle',{cx:c.x,cy:c.y,r:rad / Math.pow(iZoom.k || 1,.75),'data-r':rad,'data-city':r.area,
          fill:v == null ? NODATA : scale(v),class:'survey-marker', tabindex:0, role:'button','aria-label':areaName(r)},surveyMarkers);
        const tipFn = ev => observedTip(ev,r,areaName(r));
        dot.addEventListener('pointermove',tipFn); dot.addEventListener('pointerleave',hideTip); focusTip(dot,tipFn);
        const choose = () => setScope({type:'province',iso:c.iso});
        dot.addEventListener('click',() => { if (!iZoom.moved) choose(); });
        dot.addEventListener('keydown',ev => { if (ev.key === 'Enter') choose(); });
      }
    }
  } else {
    tHoodG.style.display = 'none'; for (const el of tLabG.children) el.style.display = '';
  }
  const overlay = $('#' + prefix + 'NA');
  overlay.hidden = active; clear(overlay); if (!active) note(overlay,absence());
  const card = overlay.closest('.card');
  card.setAttribute('aria-disabled',String(!active));
  for (const btn of card.querySelectorAll('[data-z]')) btn.disabled = !active;
  const legend = clear($('#' + prefix + 'Legend'));
  if (!active) return;
  const r = units[0], money = ['p','pm'].includes(k);
  const title = [metricLabel(k), money ? (k === 'p' ? unitName(r.unit) : tr('million ','میلیون ') + marketUnit(r)) : '',
    stamp(r), sources[r.source]].filter(Boolean).join(' · ');
  legend.append(h('span',{cls:'title',text:title}));
  const fmt = v => money ? amount(v) : k === 'rooms' ? pct(v) : numberOrDash(v);
  if (new Set(values).size === 1) {
    legend.append(h('span',{cls:'bin'},[h('i',{cls:'sw',style:'background:' + scale(values[0])}),fmt(values[0])]));
  } else {
    scale.colors.forEach((color,i) => {
      const a = scale.breaks[i-1], b = scale.breaks[i];
      const range = a == null ? '< ' + fmt(b) : b == null ? '≥ ' + fmt(a) : fmt(a) + '–' + fmt(b);
      legend.append(h('span',{cls:'bin'}, [h('i',{cls:'sw',style:'background:'+color}),iso(range)]));
    });
  }
}
function renderPlaceSide(region, rows) {
  const iran = region === 'iran', box = clear($(iran ? '#iSide' : '#tSide'));
  const snapshot = latestMapRows(region, rows);
  const scoped = iran && S.scope.type === 'province' ? S.scope.iso : !iran && S.scope.type === 'district' ? String(S.scope.d) : null;
  let areas = snapshot.filter(r => iran ? r.area_level === 'province' : true);
  if (iran && (!areas.length || scoped)) {
    areas = snapshot.filter(r => scoped ? (r.area === scoped || (r.area_level === 'city' && CBY[r.area]?.iso === scoped)) : r.area_level === 'city');
  } else if (scoped) areas = areas.filter(r => r.area === scoped);
  const heading = scoped ? (iran ? provName(PBY[scoped]) : distName(+scoped)) : (iran ? T.iran_all : T.tehran_all);
  box.append(h('h3',{text:heading}));
  box.setAttribute('aria-disabled',String(!areas.length));
  if (!areas.length) return note(box,absence());
  const first = areas[0];
  if (iran && first.source === 'archive') note(box,tr('Common month with the widest provincial coverage in this period.', 'ماه مشترک با بیشترین پوشش استان‌ها در این دوره.'));
  note(box,[measureTitle(),unitName(first.unit),stamp(first),sources[first.source]].join(' · '));
  if (scoped) {
    const list = areas.sort((a,b) => (b.area_level === 'province') - (a.area_level === 'province') || b.listings - a.listings);
    table(box,[tr('Area','محدوده'),tr('Median (millions)','میانه (میلیون)'),measureNames.median_area_m2,measureNames.listings],
      list.map(r => [areaName(r),amount(r.median),numberOrDash(r.median_area_m2),nf(r.listings)]));
    if (iran && scoped === 'IR-01' && first.source === 'panel') note(box,tr('These are separate city samples in Gilan.', 'هر ردیف نمونهٔ یک شهر گیلان در روز برداشت است.'));
  } else {
    areas.sort((a,b) => b.median-a.median);
    const max = Math.max(...areas.map(r => r.p75));
    const list = h('div',{cls:'barlist'}); box.append(list);
    for (const r of areas) {
      const choose = () => setScope(iran ? {type:'province',iso:r.area_level === 'province' ? r.area : CBY[r.area].iso} : {type:'district',d:+r.area});
      list.append(barRow(areaName(r),amount(r.median),r.p25,r.p75,r.median,max,choose));
    }
  }
}
function observedKPIs(rows, official) {
  const box = clear($('#kpis')), sc = S.scope;
  const geo = sc.type === 'province' ? ['province',sc.iso] : sc.type === 'district' ? ['district',String(sc.d)] : ['city','tehran'];
  const candidates = sc.type === 'hood' ? [] : rows.filter(r => r.area_level === geo[0] && r.area === geo[1]);
  const r = lastSlice(candidates)[0];
  const when = r ? stamp(r) : periodLabel(selectedMarket.period);
  renderScopeChip(); $('#scopeWhen').textContent = labelMetric() + ' · ' + periodLabel(selectedMarket.period);
  const tile = (label,value,unit,explain) => box.append(kpi(label,value,unit,explain,{when,na:value === '—'}));
  if (!r) {
    const cities = sc.type === 'province' ? lastSlice(rows.filter(v => v.area_level === 'city' && CBY[v.area]?.iso === sc.iso)) : [];
    if (cities.length) {
      box.setAttribute('aria-disabled','false');
      for (const city of cities) box.append(kpi(areaName(city),amount(city.median),unitName(city.unit),
        nf(city.listings) + ' ' + T.u_list,{when:stamp(city)}));
      return;
    }
    box.setAttribute('aria-disabled',String(!(sc.type === 'tehran' && official.length)));
    if (sc.type === 'tehran' && official.length) {
      for (const [k,name] of [['cbi',T.cbi],['kil',T.kilid]]) {
        const m = official.filter(v => v[k] != null).at(-1);
        if (m) box.append(kpi(name,Mv(m[k]),unitM,null,{when:mLabel(m.y,m.m)}));
      }
    } else tile(measureTitle(),'—','',absence());
    return;
  }
  box.setAttribute('aria-disabled','false');
  tile(measureTitle(),amount(r.median),unitName(r.unit),sources[r.source]);
  tile(measureNames.median_area_m2,numberOrDash(r.median_area_m2),'',areaName(r));
  tile(measureNames.rooms,roomShare(r),'',r.rooms_reported == null ? '' : nf(r.two_bedroom_listings) + ' / ' + nf(r.rooms_reported));
  tile(measureNames.listings,nf(r.listings),'',r.areas_covered != null ? measureNames.coverage + ' · ' + nf(r.areas_covered) : areaName(r));
}

const nativePanels = [
  ['#pricing .form', 'valuation'], ['#vOut','valuation'], ['#satChart','multi'],
  ['#fOut','multi'], ['#fReal','multi'], ['#fLb','multi'], ['#mCv','model'],
  ['#coefChart','model'], ['#scChart','model'], ['#impChart','model'], ['#dFind','multi']
];
function nativeAvailability(valuation) {
  for (const [sel,kind] of nativePanels) {
    const card = $(sel).closest('.card');
    const outlook = (sel === '#fOut' || sel === '#fReal') && selectedMarket.kind === 'sale' && inPeriod(lastKil.date,lastKil.end,selectedMarket.period);
    const on = isOverview() || outlook || (kind === 'valuation' && valuation);
    card.classList.toggle('obs-off',!on);
    card.setAttribute('aria-disabled', String(!on));
    card.querySelector(':scope > .obs-unavailable')?.remove();
    for (const element of card.children) if (element.tagName !== 'H3') element.inert = !on;
    if (!on) {
      const why = selectedMarket.kind !== 'sale' ? absence() : kind === 'model' ?
        tr('The training sample has no exact date. Click the selected year again to view all years.', 'تاریخ دقیق نمونهٔ آموزش مشخص نیست. برای دیدن همهٔ سال‌ها، دوباره روی سال انتخاب‌شده بزنید.') :
        kind === 'multi' ? tr('This comparison spans several periods. Click the selected year again to view all years.', 'این مقایسه چند دوره را پوشش می‌دهد. برای دیدن همهٔ سال‌ها، دوباره روی سال انتخاب‌شده بزنید.') : absence();
      card.append(h('p',{cls:'note obs-unavailable',text:why}));
    }
  }
}
const chartLabels = new Map();
function caption(selector, heading, description) {
  const card = $(selector).closest('.card');
  if (!chartLabels.has(selector)) chartLabels.set(selector,[card.querySelector('h3')?.textContent,card.querySelector(':scope > .note')?.textContent]);
  const [originalTitle,originalDesc] = chartLabels.get(selector);
  const title = card.querySelector('h3'), noteEl = card.querySelector(':scope > .note');
  if (title) title.textContent = heading ?? originalTitle;
  if (noteEl) noteEl.textContent = description ?? originalDesc;
}
function panelChart(selector, rows, draw, reason) {
  const box = clear($(selector));
  box.closest('.card').setAttribute('aria-disabled',String(!rows.length));
  if (rows.length) draw(box,rows);
  else note(box,reason || absence());
}
function growthChart(box, changes) {
  const sorted = changes.slice().sort((a,b) => b.value-a.value);
  const f = frame(box,620,sorted.length * 24 + 22,{l:97,r:72,t:8,b:8});
  const lim = Math.max(.01,...sorted.map(r => Math.abs(r.value))), center = f.m.l + f.iw / 2;
  sorted.forEach(({row,value},i) => {
    const y = 16 + i * 24, width = Math.abs(value) * f.iw / (2*lim);
    text(f.s,f.m.l-8,y+4,areaName(row),'clabel',{'text-anchor':'end'});
    svg('rect',{x:value < 0 ? center-width : center,y:y-5,width,height:10,fill:value<0?'#b84d33':'#267ca6'},f.s);
    text(f.s,f.w-5,y+4,spct(value,1),'axis',{'text-anchor':'end'});
  });
}
function publishedCityIndex() {
  if (selectedMarket.kind !== 'sale') return [];
  return D.major.filter(r => {
    const [y,m] = r.month.split('-').map(Number);
    const end = new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);
    return r.n >= 500 && inPeriod(r.month + '-01',end,selectedMarket.period);
  });
}
function chooseChartSource(rows) {
  const last = lastSlice(rows);
  const source = ['panel','tehran_map','archive'].find(s => last.some(r => r.source === s));
  return rows.filter(r => r.source === source);
}
function renderSelection() {
  hideTip();
  const rental = selectedMarket.kind === 'rent';
  const sale = selectedMarket.kind === 'sale';
  $('.hero h1').textContent = sale ? T.h1 : rental ? tr('How much is the monthly rent for an apartment?', 'اجارهٔ ماهانهٔ آپارتمان در هر شهر چقدر است؟') :
    tr('How much deposit do apartment listings ask for?', 'رهن پیشنهادی آپارتمان در هر شهر چقدر است؟');
  $('.hero .lede').textContent = sale ? T.lede : rental ?
    tr('Compare fixed monthly rents on Divar. Each area shows the sample size, median floor area and share of two-bedroom listings for the selected period.',
       'اجارهٔ ماهانهٔ آگهی‌های دیوار را برای دورهٔ انتخابی مقایسه کنید. تعداد آگهی، میانهٔ متراژ و سهم دوخوابه‌ها برای هر محدوده مشخص است.') :
    tr('Compare fixed deposits for full-deposit and mixed rent/deposit apartments on Divar. Each area shows the asking amount and the size of the sample.',
       'مبلغ ودیعهٔ آگهی‌های رهن کامل و رهن همراه اجاره را برای دورهٔ انتخابی مقایسه کنید. مبلغ پیشنهادی و تعداد آگهی‌های هر محدوده کنار هم آمده‌اند.');
  $('.hero .eyebrow').textContent = sale ? T.eyebrow : tr('Divar apartment listings','آگهی‌های آپارتمان دیوار') + ' · ' + labelMetric();
  const rows = ledger[selectedMarket.kind].filter(pick);
  const official = selectedMarket.kind === 'sale' ? MONTHS.filter(m => (m.cbi != null || m.kil != null) && inPeriod(m.date,m.end,selectedMarket.period)) : [];
  renderYearBar();
  renderData();
  if (!sale) {
    const src = clear($('#dSrc')), limits = clear($('#dLim'));
    for (const key of unique(rows.map(r => r.source))) {
      const address = key === 'archive' ? 'https://huggingface.co/datasets/divarofficial/real_estate_ads' : 'https://divar.ir/';
      src.append(h('li',{},[h('a',{href:address,target:'_blank',rel:'noopener',text:sources[key]}),h('div',{cls:'muted',text:explainSource(key)})]));
    }
    if (!src.children.length) src.append(h('li',{text:absence()}));
    limits.append(h('li',{text:tr('Rent and deposit use independent positive fixed amounts. A listing can qualify for both.',
      'اجاره و رهن هر کدام از آگهی‌های دارای مبلغ قطعی و مثبت همان شاخص محاسبه می‌شوند. یک آگهی می‌تواند در هر دو نمونه باشد.')}));
    limits.append(h('li',{text:tr('The two-bedroom share uses only ads with a reported room count.', 'سهم دوخوابه‌ها از آگهی‌هایی محاسبه می‌شود که تعداد اتاقشان مشخص است.')}));
  }
  updateCities(rows);
  $('#pills').hidden = false;
  if (isOverview()) renderPills();
  else {
    const pills = clear($('#pills'));
    for (const text of [labelMetric(),periodLabel(selectedMarket.period),...unique(rows.map(r => sources[r.source]))]) pills.append(h('span',{cls:'pill',text}));
  }
  for (const el of $$('.block .sec-head p')) el.hidden = !isOverview() && el.closest('section').id !== 'data';
  $('#tehran #tLayer').closest('.ctl').hidden = !isOverview() && !nativeTehran();
  $('#tBudgetOn').closest('label').hidden = !isOverview() && !nativeTehran();
  $('#tBudget').hidden = !isOverview() && !nativeTehran();
  $('#forecast > .controls').hidden = !isOverview();
  $('#mMode').closest('.controls').hidden = !isOverview();
  $('#vRoll').closest('.field').hidden = !isOverview();
  if (isOverview()) {
    mapOptions('tehran', [], false);
    if (!overviewCityMap()) mapOptions('iran', [], false);
    for (const sel of ['#tRank','#tCatch','#mChart','#fChart','#yoyChart']) {
      caption(sel); $(sel).closest('.card').removeAttribute('aria-disabled');
    }
    for (const sel of ['#tMapBox','#iMapBox']) {
      $(sel).closest('.card').removeAttribute('aria-disabled');
      for (const btn of $(sel).querySelectorAll('[data-z]')) btn.disabled = false;
    }
    for (const path of [...tDistG.children,...iProvG.children]) path.setAttribute('tabindex','0');
    $('#iCities').disabled = false;
    for (const ctl of $('#forecast > .controls').children) ctl.hidden = false;
    nativeAvailability(true);
    renderNativeYear(LIVE ? 1405 : 1403);
    renderMajor(); renderSat(); renderLeaderboard(); renderModel(); renderData();
    $('#scopeWhen').textContent = labelMetric() + ' · ' + pLab(S.year);
    if (overviewCityMap()) {
      const status = $('#ybStatus .yb-s:nth-child(2)'), sample = overviewCities();
      if (status) { status.classList.remove('off'); status.textContent = sources.panel + ' · ' + stamp(sample[0]); }
    }
    return;
  }
  const period = selectedMarket.period;
  const vintage1403 = selectedMarket.kind === 'sale' && period === 'y:1403';
  const datedLive = selectedMarket.kind === 'sale' && LIVE && inPeriod(LIVE.collected_on,LIVE.collected_on,period);
  const valuation = vintage1403 || datedLive;
  if (valuation) {
    S.year = vintage1403 ? 1403 : (LIVE.collected_on_jalali?.[0] || 1405);
    fillHoodSelect($('#vSearch').value); renderRollChips(); renderValuation();
  }
  const outlook = selectedMarket.kind === 'sale' && inPeriod(lastKil.date,lastKil.end,period);
  const forecastControls = $('#forecast > .controls');
  forecastControls.hidden = !outlook;
  for (const ctl of forecastControls.children) ctl.hidden = !isOverview() && (ctl.contains($('#fScale')) || ctl.contains($('#fMethod')));
  if (outlook) renderForecast();
  nativeAvailability(valuation);
  if (nativeTehran() && S.scope.type !== 'province') {
    $('#kpis').removeAttribute('aria-disabled'); renderKPIs();
  } else observedKPIs(rows,official);
  $('#ybStatus').textContent = [labelMetric(),periodLabel(period), rows.length || official.length || nativeTehran() ?
    tr('Only fully dated observations inside this period','فقط مشاهده‌های کاملاً داخل این دوره') : absence()].join(' · ');
  if (nativeTehran()) {
    mapOptions('tehran',[],false);
    for (const btn of $('#tMapBox').querySelectorAll('[data-z]')) btn.disabled = false;
    for (const path of tDistG.children) path.setAttribute('tabindex','0');
    $('#tMapBox').closest('.card').removeAttribute('aria-disabled');
    $('#tSide').removeAttribute('aria-disabled');
    renderTehranMap(); renderTehranSide();
  } else {
    renderObservedMap('tehran',rows); renderPlaceSide('tehran',rows);
  }
  renderObservedMap('iran',rows); renderPlaceSide('iran',rows);
  const districts = latestMapRows('tehran',rows);
  const reason = tr('This comparison needs two dates from the same survey within the selected period.','این مقایسه به دو تاریخ از یک منبع در دورهٔ انتخاب‌شده نیاز دارد.');
  const comparable = rows.filter(r => r.area_level === 'district' && r.source === districts[0]?.source);
  const earliest = comparable.reduce((v,r) => !v || r.period_start < v ? r.period_start : v,'');
  const base = mapByArea(comparable.filter(r => r.period_start === earliest));
  const changes = districts.filter(r => base.has(r.area) && r.period_start !== earliest).map(row => ({row,value:row.median/base.get(row.area).median-1}));
  if (nativeTehran()) {
    for (const sel of ['#tRank','#tCatch']) { caption(sel); $(sel).closest('.card').removeAttribute('aria-disabled'); }
    renderRank(); renderCatch();
    if (!prevYear(S.year)) panelChart('#tCatch',[],() => {},reason);
  } else {
    caption('#tRank',tr('District ranking','رتبه‌بندی مناطق'),districts.length ? [measureTitle(),unitName(districts[0].unit),stamp(districts[0])].join(' · ') : '');
    panelChart('#tRank',districts,drawRange);
    caption('#tCatch',tr('Change within the period','تغییر در دورهٔ انتخابی'),changes.length ? [stamp(base.get(changes[0].row.area)),stamp(changes[0].row),sources[changes[0].row.source]].join(' → ') : '');
    panelChart('#tCatch',changes,growthChart,rows.length ? reason : absence());
  }
  clear($('#mKey')); clear($('#fKey'));
  if (publishedCityIndex().length) {
    $('#mMode').closest('.controls').hidden = false;
    caption('#mChart'); $('#mChart').closest('.card').setAttribute('aria-disabled','false'); renderMajor();
  } else {
    const big = chooseChartSource(rows.filter(r => r.area_level === 'city' && Object.hasOwn(CITY_COL,r.area)));
    caption('#mChart',tr('Major cities','شهرهای بزرگ'),big.length ? [measureTitle(),unitName(big[0].unit),sources[big[0].source]].join(' · ') : '');
    panelChart('#mChart',big,citySeries);
  }
  const tehran = rows.filter(r => r.area_level === 'city' && r.area === 'tehran');
  const live = tehran.filter(r => r.source === 'tehran_map');
  const priceSeries = official.length || live.length ? [] : chooseChartSource(tehran);
  caption('#fChart',null,priceSeries.length ? [T.tehran_all,measureTitle(),unitName(priceSeries[0].unit),sources[priceSeries[0].source]].join(' · ') : '');
  panelChart('#fChart',[...official,...live,...priceSeries],box => {
    if (official.length || live.length) drawOfficial(box,official,live);
    else citySeries(box,priceSeries);
  });
  const yoy = official.filter(m => cbiYoY(m.t) != null);
  caption('#yoyChart',null,'');
  panelChart('#yoyChart',yoy,box => drawSeries(box,[{name:T.yoy_title,points:yoy.map(m => ({x:m.t,y:cbiYoY(m.t)}))}],tLabel,v => spct(v,1),1));
}

function selectPeriod(period) {
  selectedMarket.period = period;
  if (period.startsWith('y:')) S.year = +period.slice(2);
  else if (period === 'all') S.year = LIVE ? 1405 : 1403;
  else if (/^[md]:\d{4}-\d{2}/.test(period)) S.year = +solarMonth((period.slice(2) + '-01').slice(0,10)).slice(0,4);
  S.roll = 0; $('#vRoll').value = 0;
  for (const btn of $('#obKind').querySelectorAll('button')) btn.setAttribute('aria-pressed',String(btn.dataset.v === selectedMarket.kind));
  renderSelection();
  const params = new URLSearchParams({market:selectedMarket.kind, period});
  $('.lang').href = T.lang_href + '?' + params;
  try { const url = new URL(location.href); url.search = params; history.replaceState(null,'',url); } catch { /* Local viewers may not allow URL changes. */ }
}
function initObservations() {
  const root = $('#cityHistory'); root.hidden = false;
  const allRows = Object.values(ledger).flat();
  const areas = new Map(allRows.filter(r => r.area_level !== 'district').map(r => [localKey(r),r]));
  selectors.forEach((sel,i) => {
    if (i) option(sel,'',T.ch_none);
    for (const [level,label] of [['city',tr('Cities','شهرها')],['province',tr('Provinces','استان‌ها')]]) {
      const g = h('optgroup',{label}); sel.append(g);
      const list = [...areas.entries()].filter(([,r]) => r.area_level === level).sort((a,b) => areaName(a[1]).localeCompare(areaName(b[1]),LOC));
      for (const [v,r] of list) option(g,v,(level === 'province' ? T.province + ' ' : '') + areaName(r));
    }
    sel.value = ['tehran','mashhad','rasht'][i];
    sel.addEventListener('change',() => {
      for (const other of selectors) {
        if (other === sel || !sel.value || other.value !== sel.value) continue;
        if (other === selectors[0]) sel.value = ''; else other.value = '';
      }
      renderCityChart();
    });
  });
  $('#chFrom').addEventListener('change',() => { if (+$('#chFrom').value > +$('#chTo').value) $('#chTo').value=$('#chFrom').value; renderCityChart(); });
  $('#chTo').addEventListener('change',() => { if (+$('#chTo').value < +$('#chFrom').value) $('#chFrom').value=$('#chTo').value; renderCityChart(); });
  $('#chMonth').addEventListener('change',renderCityTable);
  $('#chCSV').addEventListener('click',() => { if (visibleCityRows.length) exportObservations(visibleCityRows); });
  seg($('#obKind'),v => { stopPlay(); selectedMarket.kind = v; selectPeriod(selectedMarket.period); });
  const params = new URLSearchParams(location.search), wanted = params.get('period');
  if (Object.hasOwn(markets,params.get('market'))) selectedMarket.kind = params.get('market');
  if (wanted === 'all' || YEARS.some(y => wanted === 'y:' + y)) selectedMarket.period = wanted;
  // Dated links can also point directly at an observation or an archive month.
  if (wanted && /^[dm]:[0-9]{4}-[0-9]{2}(-[0-9]{2})?$/.test(wanted)) {
    const value = wanted.slice(2), day = wanted[0] === 'm' ? value + '-01' : value;
    if (day.length === 10 && !isNaN(isoDate(day)) && isoDate(day).toISOString().slice(0,10) === day) selectedMarket.period = wanted;
  }
}
