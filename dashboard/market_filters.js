// All plots consume this one selection. Aggregates only fit inside a period that contains
// their entire source interval. A monthly archive observation can never stand in for a day.
const tr = (en, fa) => (FA ? fa : en);
const ledger = Object.fromEntries(
  Object.entries(D.observations.markets).map(([market, records]) => [
    market,
    records.map((values) => Object.fromEntries(D.observations.columns.map((key, i) => [key, values[i]])))
  ])
);
const markets = { sale: T.filter_sale, rent: T.filter_rent, deposit: T.filter_deposit };
const solarFormat = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', {
  year: 'numeric',
  month: '2-digit',
  timeZone: 'UTC'
});
const solarDayFormat = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'UTC'
});
function solarDayKey(day) {
  const parts = Object.fromEntries(solarDayFormat.formatToParts(isoDate(day)).map((p) => [p.type, p.value]));
  return [parts.year, parts.month, parts.day].join('/');
}
function parseSolarInput(input) {
  const latin = input
    .trim()
    .replace(/[۰-۹]/g, (c) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c)))
    .replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)));
  const match = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(latin);
  if (!match) return '';
  const [y, m, d] = match.slice(1).map(Number);
  if (y < 1200 || y > 1600 || m < 1 || m > 12 || d < 1 || d > 31) return '';
  const key = [y, String(m).padStart(2, '0'), String(d).padStart(2, '0')].join('/');
  const near =
    Date.UTC(y + 621, 2, 20) + (Math.min(6, m - 1) * 31 + Math.max(0, m - 7) * 30 + d - 1) * 86400000;
  for (let offset = -3; offset <= 3; offset++) {
    const day = new Date(near + offset * 86400000).toISOString().slice(0, 10);
    if (solarDayKey(day) === key) return day;
  }
  return '';
}
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
  if (kind === 'd') return start === value && end === value;
  if (kind === 'm') return start.slice(0, 7) === value && end.slice(0, 7) === value;
  const length = kind === 'y' ? 4 : 7;
  return ['j', 'y'].includes(kind) && [start, end].every((d) => solarMonth(d).slice(0, length) === value);
}
const knownDays = [
  ...new Set(
    Object.values(ledger)
      .flat()
      .filter((r) => r.period_start === r.period_end)
      .map((r) => r.period_start)
  )
]
  .sort()
  .reverse();
const selectedMarket = { kind: 'sale', period: knownDays.length ? 'd:' + knownDays[0] : 'all', geo: 'all' };
const palette = ['#1765a3', '#087a63', '#ab4e13', '#855192', '#b13e59', '#57772d', '#176b80', '#805f40'];
const amount = (n) => Mv(n, 2);
const cityIndex = {
  ...CBY,
  ...Object.fromEntries(
    [...(D.city_monthly?.cities || []), ...(D.city_rentals?.cities || [])].map((c) => [c.s, c])
  ),
  ...Object.fromEntries(Object.entries(D.city_weekly || {}).map(([s, c]) => [s, { s, ...c }]))
};
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
  if (!v) return T.choose_day;
  if (mode === 'd') return dayLabel(v);
  if (mode === 'm') return monthLabel(v + '-01');
  if (mode === 'y') return tr('Solar year ', 'سال ') + yr(+v);
  return mLabel(...v.split('-').map(Number));
}
const isOverview = () =>
  selectedMarket.kind === 'sale' && selectedMarket.period === 'all' && selectedMarket.geo === 'all';
const pick = (r, period = selectedMarket.period) => inPeriod(r.period_start, r.period_end, period);
const option = (box, value, label) => box.appendChild(h('option', { value, text: label }));
const slots = new Map();
function registerPanel(key, selector, title) {
  const node = $(selector).closest('.card');
  const holder = h('div', { cls: 'scope-slot', 'data-panel': key });
  node.before(holder);
  holder.appendChild(node);
  const scoped = h('div', { cls: 'card scope-result' }),
    empty = h('div', { cls: 'card scope-empty' });
  holder.append(scoped, empty);
  slots.set(key, { node, scoped, empty, holder, title });
}
function setPanel(key, mode, draw, reason) {
  const { node, scoped, empty, holder, title } = slots.get(key);
  holder.dataset.state = mode;
  holder.setAttribute('aria-disabled', String(mode === 'empty'));
  for (const [name, el] of [
    ['native', node],
    ['scoped', scoped],
    ['empty', empty]
  ]) {
    el.hidden = name !== mode;
    el.inert = el.hidden;
  }
  clear(scoped);
  clear(empty);
  if (mode === 'scoped') {
    scoped.appendChild(h('h3', { text: title }));
    draw(scoped);
  }
  if (mode === 'empty') {
    empty.append(
      h('h3', { text: title }),
      h('p', {
        text:
          reason ||
          tr('No published observations for this selection.', 'برای این انتخاب داده‌ای منتشر نشده است.')
      })
    );
  }
}
function tableRows(box, headers, rows) {
  const table = h('table', { cls: 't' }),
    body = h('tbody');
  table.append(
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        headers.map((v) => h('th', { scope: 'col', text: v }))
      )
    ),
    body
  );
  rows.forEach((values) =>
    body.appendChild(
      h(
        'tr',
        {},
        values.map((v) => h('td', { text: String(v) }))
      )
    )
  );
  box.appendChild(h('div', { cls: 'scoped-table' }, table));
}
function writeCSV(rows, label) {
  if (!rows.length) return;
  const columns = D.observations.columns;
  const escape = (value) =>
    '"' +
    (typeof value === 'boolean' ? (value ? 'True' : 'False') : String(value ?? '')).replaceAll('"', '""') +
    '"';
  const csv = [columns, ...rows.map((r) => columns.map((c) => r[c]))]
    .map((r) => r.map(escape).join(','))
    .join('\r\n');
  const url = URL.createObjectURL(new Blob([csv + '\r\n'], { type: 'text/csv;charset=utf-8' }));
  const link = h('a', {
    href: url,
    download:
      [label, selectedMarket.kind, selectedMarket.geo, selectedMarket.period.replace(':', '-')].join('_') +
      '.csv'
  });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
const labelMetric = () => markets[selectedMarket.kind];
const absence = () =>
  tr('No data for ', 'داده‌ای برای ') +
  labelMetric() +
  ' · ' +
  periodLabel(selectedMarket.period) +
  (selectedMarket.geo === 'gilan' ? ' · ' + T.gilan : '') +
  tr('.', ' ثبت نشده است.');
const datedRows = () =>
  ledger[selectedMarket.kind].filter((r) => pick(r) && (selectedMarket.geo === 'all' || r.gilan));
function lastSlice(rows) {
  const last = rows.reduce((m, r) => (r.period_start > m ? r.period_start : m), '');
  return rows.filter((r) => r.period_start === last);
}
function note(box, message) {
  box.appendChild(h('p', { cls: 'note', text: message }));
}
function measureTable(box, rows) {
  const headers = [T.geography, T.global_period, labelMetric(), T.ch_iqr, T.ch_ads];
  const periodIndex = (r) => {
    if (r.source === 'archive') return +r.period_start.slice(0, 4) * 12 + +r.period_start.slice(5, 7);
    return Math.floor((dayNumber(r.period_start) + 5) / 7); // weeks start on Saturday
  };
  const seriesKey = (r, t) => [r.source, r.area_level, r.area, r.unit, t].join('|');
  const byPeriod = new Map(rows.map((r) => [seriesKey(r, periodIndex(r)), r]));
  const previous = (r) => byPeriod.get(seriesKey(r, periodIndex(r) - 1));
  const hasChange = rows.some((r) => previous(r));
  if (hasChange) headers.push(tr('Change from preceding period', 'تغییر نسبت به دورهٔ قبل'));
  const hasCoverage = rows.some((r) => r.areas_covered != null);
  if (hasCoverage)
    headers.push(rows[0].area_level === 'province' ? tr('Covered cities', 'شهر دارای آگهی') : T.cw_hoods);
  tableRows(
    box,
    headers,
    rows
      .slice()
      .sort((a, b) => b.period_start.localeCompare(a.period_start) || b.median - a.median)
      .map((r) => {
        const cells = [
          areaName(r),
          stamp(r),
          amount(r.median),
          iso(amount(r.p25) + ' – ' + amount(r.p75)),
          nf(r.listings)
        ];
        if (hasChange) cells.push(previous(r) ? spct(r.median / previous(r).median - 1, 1) : '–');
        if (hasCoverage) cells.push(r.areas_covered == null ? '–' : nf(r.areas_covered));
        return cells;
      })
  );
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
      if (j && gap && p.x - sorted[j - 1].x > gap) pts.push([p.x - 0.1, null]);
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
function observationsChart(box, rows) {
  note(box, labelMetric() + ' · ' + unitName(rows[0].unit));
  if (new Set(rows.map((r) => r.period_start)).size === 1) drawRange(box, rows);
  else {
    const names = [...new Set(rows.map((r) => r.area))];
    const groups = names.map((area) => {
      const series = rows.filter((r) => r.area === area);
      return {
        name: areaName(series[0]),
        points: series.map((r) => ({ x: dayNumber(r.period_start), y: r.median }))
      };
    });
    const archive = rows[0].source === 'archive';
    drawSeries(
      box,
      groups,
      (x) => (archive ? monthLabel(numberDay(x)) : dayLabel(numberDay(x))),
      amount,
      archive ? 32 : 10
    );
  }
  measureTable(box, rows);
}
function drawMap(box, rows, level) {
  const tehran = level === 'district',
    map = tehran ? D.tehran : D.iran;
  const by = new Map(rows.map((r) => [r.area, r])),
    scale = makeScale(
      rows.map((r) => r.median),
      RAMP.blue
    );
  note(box, stamp(rows[0]) + ' · ' + labelMetric() + ' · ' + unitName(rows[0].unit));
  const graphic = svg(
    'svg',
    {
      viewBox: '0 0 ' + map.w + ' ' + map.h,
      class: 'scoped-map',
      role: 'img',
      'aria-label': tehran ? T.s1_title : T.s3_title
    },
    box
  );
  (tehran ? DIST : PROV).forEach((shape) => {
    const row = by.get(tehran ? String(shape.d) : shape.iso);
    const el = svg(
      'path',
      { d: shape.path, fill: row ? scale(row.median) : NODATA, stroke: 'white', 'stroke-width': 1 },
      graphic
    );
    if (!row) return;
    el.dataset.area = row.area;
    const name = areaName(row),
      details = [
        { k: labelMetric(), v: amount(row.median) + ' ' + unitName(row.unit) },
        { k: T.ch_ads, v: nf(row.listings) }
      ];
    const title = svg('title', {}, el);
    title.textContent = name + ' · ' + details[0].v;
    el.setAttribute('tabindex', '0');
    el.addEventListener('pointermove', (ev) => showTip(ev, name, details, stamp(row)));
    el.addEventListener('pointerleave', hideTip);
    focusTip(el, (ev) => showTip(ev, name, details, stamp(row)));
  });
  note(
    box,
    tr(
      'Darker areas have higher medians. Grey areas have no observation.',
      'رنگ تیره‌تر میانهٔ بالاتر را نشان می‌دهد. محدوده‌های خاکستری داده ندارند.'
    )
  );
}
let archiveChoices = [],
  currentCities = [];
function renderChosenCities() {
  const chosen = [$('#chCity1'), $('#chCity2'), $('#chCity3')].map((s) => s.value).filter(Boolean);
  currentCities = archiveChoices.filter((r) => chosen.includes(r.area));
  const body = clear($('#historyBody'));
  $('#chCSV').disabled = !currentCities.length;
  if (currentCities.length) {
    observationsChart(body, currentCities);
    note(body, T.ch_limits);
    const source = h('p', { cls: 'note' });
    source.append(
      tr('The archive does not specify the currency denomination. ', 'واحد پول در آرشیو مشخص نشده است. '),
      h('a', {
        href: 'https://huggingface.co/datasets/divarofficial/real_estate_ads',
        target: '_blank',
        rel: 'noopener',
        text: T.ch_source
      })
    );
    body.appendChild(source);
  }
}
function renderArchive(rows) {
  archiveChoices = rows;
  const ids = [...new Set(rows.map((r) => r.area))].sort((a, b) =>
    areaName({ area: a }).localeCompare(areaName({ area: b }), LOC)
  );
  const defaults =
    selectedMarket.geo === 'gilan' ? ['rasht', 'lahijan', 'bandar-anzali'] : ['tehran', 'mashhad', 'isfahan'];
  const used = new Set();
  [$('#chCity1'), $('#chCity2'), $('#chCity3')].forEach((s, i) => {
    const prior = s.value;
    clear(s);
    if (i) option(s, '', T.ch_none);
    ids.forEach((id) => option(s, id, areaName({ area: id })));
    const preferred =
      s.dataset.geo === selectedMarket.geo && (prior === '' || ids.includes(prior)) ? prior : defaults[i];
    s.value = ids.includes(preferred) && !used.has(preferred) ? preferred : i ? '' : ids[0];
    used.add(s.value);
    s.dataset.geo = selectedMarket.geo;
  });
  renderChosenCities();
}
function renderFilteredSummary(rows, official) {
  const target = clear($('#kpis'));
  const tiles = [];
  if (rows.length) {
    const cities = rows.filter((r) => r.area_level === 'city'),
      provinces = rows.filter((r) => r.area_level === 'province');
    if (cities.length) {
      const latest = lastSlice(cities);
      const counts = new Map(latest.map((r) => [r.area, r.listings]));
      const count = [...counts.values()].reduce((sum, n) => sum + n, 0);
      tiles.push([
        tr('Listings with this amount in the latest city sample', 'آگهی دارای این مبلغ در آخرین نمونهٔ شهری'),
        nf(count),
        stamp(latest[0])
      ]);
      tiles.push([T.ch_city, nf(new Set(cities.map((r) => r.area)).size)]);
    }
    if (provinces.length) {
      tiles.push([
        tr('Provinces with a published aggregate', 'استان با آمار تجمیعی'),
        nf(new Set(provinces.map((r) => r.area)).size)
      ]);
    }
    const days = rows.filter((r) => r.period_start === r.period_end),
      months = rows.filter((r) => r.period_start !== r.period_end);
    if (days.length)
      tiles.push([
        tr('Most recent survey in this period', 'آخرین روز پایش در این دوره'),
        stamp(lastSlice(days)[0])
      ]);
    if (months.length)
      tiles.push([
        tr('Latest archive month in this period', 'آخرین ماه آرشیو در این دوره'),
        stamp(lastSlice(months)[0])
      ]);
  }
  if (official.length)
    tiles.push([
      tr('Published Tehran indicator months', 'ماه دارای شاخص منتشرشدهٔ تهران'),
      nf(official.length)
    ]);
  if (!tiles.length) tiles.push([labelMetric(), tr('No data', 'بدون داده')]);
  for (const [label, value, observed] of tiles)
    target.appendChild(kpi(label, value, '', '', { when: observed || periodLabel(selectedMarket.period) }));
}
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
      name: tr('Divar asking prices', 'قیمت پیشنهادی دیوار'),
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
function drawListingSources(box, rows) {
  // Source currency in the archive is undocumented. Keep each source on its own axis.
  for (const source of ['archive', 'panel', 'tehran_map']) {
    const sample = rows.filter((row) => row.source === source);
    if (!sample.length) continue;
    note(
      box,
      source === 'archive'
        ? tr('Divar monthly archive', 'آرشیو ماهانهٔ دیوار')
        : tr('Divar map survey', 'پایش نقشهٔ دیوار')
    );
    observationsChart(box, sample);
  }
}
function renderSelectedSources(rows, official) {
  const sources = clear($('#dSrc'));
  const limits = clear($('#dLim'));
  function source(label, href) {
    sources.appendChild(h('li', {}, h('a', { text: label, href, target: '_blank', rel: 'noopener' })));
  }
  const limit = (message) => limits.appendChild(h('li', { text: message }));
  if (rows.some((r) => r.source === 'archive')) {
    source(T.ch_source, 'https://huggingface.co/datasets/divarofficial/real_estate_ads');
    limit(
      tr(
        'Archive amounts use the original currency unit. Each area-month has at least 50 eligible apartments.',
        'مبلغ‌های آرشیو با واحد اصلی منبع نمایش داده می‌شوند. هر محدوده در هر ماه حداقل ۵۰ آپارتمان واجد شرایط دارد.'
      )
    );
  }
  if (rows.some((r) => r.source !== 'archive')) {
    source(tr('Divar map listings', 'آگهی‌های نقشهٔ دیوار'), 'https://divar.ir/');
    limit(
      tr(
        'The collection day identifies when an asking amount was observed. Some listings can remain active on later dates.',
        'روز پایش زمان مشاهدهٔ مبلغ پیشنهادی است. یک آگهی ممکن است در روزهای بعد هم فعال بماند.'
      )
    );
  }
  if (rows.length && selectedMarket.kind !== 'sale') {
    limit(
      tr(
        'Only specified positive amounts enter this measure. A listing can contribute to both rent and deposit.',
        'فقط مبلغ مشخص و مثبت همان شاخص وارد محاسبه می‌شود. یک آگهی می‌تواند هم در سری اجاره و هم در سری ودیعه حضور داشته باشد.'
      )
    );
  }
  if (official.some((r) => r.cbi != null))
    source(
      T.cbi,
      'https://github.com/Milad-Shabani/Iran-housing-market-analytics/blob/main/data/raw/official/cbi_tehran_monthly.csv'
    );
  if (official.some((r) => r.kil != null)) source(T.kilid, 'https://kilid.com/house-prices/tehran');
  if (official.length)
    limit(
      tr(
        'Official indicators are published by Solar Hijri month.',
        'شاخص‌های تهران به تفکیک ماه شمسی منتشر می‌شوند.'
      )
    );
  if (!sources.childElementCount) sources.appendChild(h('li', { text: absence() }));
  if (!limits.childElementCount)
    limit(
      tr(
        'Only dated observations fully within the period are eligible.',
        'هر مشاهده باید به‌طور کامل در محدودهٔ تاریخ انتخابی باشد.'
      )
    );
}
function renderMarketView() {
  hideTip();
  const rows = datedRows(),
    full = isOverview(),
    tehranSale = selectedMarket.kind === 'sale' && selectedMarket.geo === 'all';
  const scoped = (key, data, render, reason) =>
    setPanel(key, data.length ? 'scoped' : 'empty', (target) => render(target, data), reason || absence());
  const native = (key, active, reason) =>
    setPanel(key, active ? 'native' : 'empty', null, reason || absence());
  const historic = rows.filter((r) => r.source === 'archive' && r.area_level === 'city');
  const weekly = rows.filter((r) => r.source === 'panel'),
    gilan = rows.filter((r) => r.source === 'archive' && r.area === 'IR-01');
  const provinces = lastSlice(rows.filter((r) => r.area_level === 'province'));
  const districts = rows.filter((r) => r.area_level === 'district'),
    lastDistricts = lastSlice(districts);
  const tehran = rows.filter((r) => r.area === 'tehran' && r.area_level === 'city');
  const official = tehranSale
    ? MONTHS.filter((m) => (m.cbi != null || m.kil != null) && inPeriod(m.date, m.end, selectedMarket.period))
    : [];
  const multiOnly =
    selectedMarket.kind === 'sale' && selectedMarket.geo === 'all'
      ? tr(
          'This analysis uses several periods. Select All periods to see it.',
          'این تحلیل چند دوره را با هم مقایسه می‌کند. در «همهٔ دوره‌ها» می‌توانید آن را ببینید.'
        )
      : absence();
  const undated = tehranSale
    ? tr(
        'The training sample has no exact dates. Available under All periods.',
        'تاریخ دقیق آگهی‌های نمونهٔ آموزش ثبت نشده است. مدل در «همهٔ دوره‌ها» قابل مشاهده است.'
      )
    : absence();

  native('weekly', weekly.length);
  const weekBox = clear($('#weeklyBody'));
  if (weekly.length) {
    note(
      weekBox,
      tr(
        'Fixed neighbourhood samples. The date is the observation day.',
        'نمونه‌گیری از محله‌های ثابت. تاریخ هر ردیف روز گردآوری آگهی‌هاست.'
      )
    );
    observationsChart(weekBox, weekly);
  }
  native('archive', historic.length);
  if (historic.length) renderArchive(historic);
  else {
    archiveChoices = [];
    currentCities = [];
    clear($('#historyBody'));
    $('#chCSV').disabled = true;
  }
  native('gilan', gilan.length);
  const gilanBox = clear($('#gilanBody'));
  if (gilan.length) {
    note(
      gilanBox,
      tr(
        'Pooled listing amounts across covered cities in Gilan. The coverage column counts contributing cities each month.',
        'مبلغ آگهی‌های شهرهای گیلان برای محاسبهٔ میانهٔ استان تجمیع شده است. تعداد شهرهای دارای آگهی در هر ماه در جدول آمده است.'
      )
    );
    observationsChart(gilanBox, gilan);
  }
  $('#marketCSV').disabled = !rows.length;
  $('#kpis').setAttribute('aria-disabled', String(!full && !rows.length && !official.length));
  const status =
    labelMetric() +
    ' · ' +
    periodLabel(selectedMarket.period) +
    ' · ' +
    (selectedMarket.geo === 'gilan' ? T.gilan : T.all_areas);
  $('#marketStatus').textContent =
    status +
    ' — ' +
    (rows.length || official.length
      ? tr(
          'Only observations fully inside the selected period are included.',
          'فقط مشاهده‌هایی که کاملاً در دورهٔ انتخاب‌شده قرار می‌گیرند نمایش داده می‌شوند.'
        )
      : absence());
  $('#pills').hidden = !full;
  $('.hero .eyebrow').hidden = !full;
  if (full) renderData();
  else renderSelectedSources(rows, official);
  $('.scopebar').hidden = !full;
  $('#kpis').classList.toggle('filtered', !full);
  $('#tehran > .controls').hidden = !full;
  $('#tBudget').hidden = !full;
  $('#iran > .controls').hidden = !full;
  $('#forecast > .controls').hidden = !full;
  for (const el of $$('.block .sec-head p')) el.hidden = !full && el.closest('section').id !== 'data';
  const supportsPrice =
    tehranSale && LIVE && inPeriod(LIVE.collected_on, LIVE.collected_on, selectedMarket.period);
  const usePrice = full || supportsPrice;
  S.year = full ? 1403 : liveYear;
  if (usePrice) {
    S.roll = 0;
    $('#vRoll').value = 0;
    fillHoodSelect();
    renderRollChips();
    renderValuation();
    $('#vRoll').closest('.field').hidden = !full;
    // Scenario presets also change the estimate, so they belong to the same hidden field.
  }
  native('price-input', usePrice);
  native('valuation', usePrice);
  if (full) {
    renderKPIs();
    renderTehranMap();
    renderTehranSide();
    renderRank();
    renderCatch();
    renderIranMap();
    renderIranSide();
    renderForecast();
    renderYoY();
    for (const id of [
      'tehran-map',
      'tehran-table',
      'rank',
      'changes',
      'iran-map',
      'iran-table',
      'cities-index',
      'forecast',
      'yoy'
    ])
      native(id, true);
  } else {
    renderFilteredSummary(rows, official);
    scoped('tehran-map', lastDistricts, (box, rs) => drawMap(box, rs, 'district'));
    scoped('tehran-table', lastDistricts, (box, rs) => {
      note(box, unitName(rs[0].unit));
      measureTable(box, rs);
    });
    scoped('rank', lastDistricts, (box, rs) => {
      note(box, stamp(rs[0]) + ' · ' + unitName(rs[0].unit));
      drawRange(box, rs);
    });
    const comparable = districts.filter(
      (r) => r.source === lastDistricts[0]?.source && r.unit === lastDistricts[0]?.unit
    );
    const first = Array.from(new Set(comparable.map((r) => r.period_start))).sort()[0];
    const base = new Map(comparable.filter((r) => r.period_start === first).map((r) => [r.area, r]));
    const changes = lastDistricts.filter((r) => r.period_start !== first && base.has(r.area));
    scoped(
      'changes',
      changes,
      (box, rs) => {
        note(box, stamp(base.get(rs[0].area)) + ' → ' + stamp(rs[0]));
        const ordered = rs
          .map((r) => [areaName(r), r.median / base.get(r.area).median - 1])
          .sort((a, b) => b[1] - a[1]);
        const chart = h('div', { cls: 'chart' });
        box.appendChild(chart);
        const f = frame(chart, 560, 24 * ordered.length + 28, { l: 97, r: 58, t: 8, b: 8 });
        const extent = Math.max(0.01, ...ordered.map((x) => Math.abs(x[1]))),
          mid = f.m.l + f.iw / 2;
        ordered.forEach(([name, v], i) => {
          const y = 18 + 24 * i,
            w = ((Math.abs(v) / extent) * f.iw) / 2;
          text(f.s, f.m.l - 8, y + 4, name, 'clabel', { 'text-anchor': 'end' });
          svg(
            'rect',
            { x: v < 0 ? mid - w : mid, y: y - 6, width: w, height: 12, fill: v < 0 ? '#b84d33' : '#267ca6' },
            f.s
          );
          text(f.s, f.w - 5, y + 4, spct(v, 1), 'axis', { 'text-anchor': 'end' });
        });
      },
      selectedMarket.geo === 'all'
        ? tr(
            'Two comparable Tehran observations within the period are needed.',
            'این مقایسه به دو مشاهدهٔ قابل‌مقایسه از مناطق تهران در همان دوره نیاز دارد.'
          )
        : absence()
    );
    scoped('iran-map', provinces, (box, rs) => drawMap(box, rs, 'province'));
    scoped('iran-table', provinces, (box, rs) => {
      note(box, unitName(rs[0].unit));
      measureTable(box, rs);
    });
    const major = tehranSale
      ? D.major.filter((r) => {
          const first = r.month + '-01';
          const last = new Date(Date.UTC(+r.month.slice(0, 4), +r.month.slice(5), 0))
            .toISOString()
            .slice(0, 10);
          return r.n >= 500 && inPeriod(first, last, selectedMarket.period);
        })
      : [];
    const bigCities = rows.filter((r) => r.area_level === 'city' && Object.hasOwn(CITY_COL, r.area));
    scoped('cities-index', [...major, ...bigCities], (box) => {
      if (major.length) {
        const names = [...new Set(major.map((r) => r.city))];
        note(
          box,
          tr(
            'Published sale index · median asking price in million toman per m² · Gregorian months',
            'سری منتشرشدهٔ فروش · میانهٔ قیمت پیشنهادی، میلیون تومان برای هر متر مربع · ماه‌های میلادی'
          )
        );
        drawSeries(
          box,
          names.map((city) => ({
            name: cityName(cityIndex[city]),
            points: major
              .filter((r) => r.city === city)
              .map((r) => ({ x: dayNumber(r.month + '-01'), y: r.p }))
          })),
          (n) => monthLabel(numberDay(n)),
          amount,
          32
        );
      }
      drawListingSources(
        box,
        bigCities.filter((r) => !major.length || r.source !== 'archive')
      );
    });
    scoped('forecast', [...official, ...tehran], (box) => {
      const live = tehran.filter((r) => r.source === 'tehran_map');
      if (official.length || live.length) drawOfficial(box, official, live);
      drawListingSources(
        box,
        tehran.filter((r) => r.source !== 'tehran_map')
      );
    });
    const yoy = official.filter((r) => cbiYoY(r.t) != null);
    scoped('yoy', yoy, (box, rs) =>
      drawSeries(
        box,
        [{ name: T.yoy_title, points: rs.map((r) => ({ x: r.t, y: cbiYoY(r.t) })) }],
        tLabel,
        (v) => spct(v, 1),
        1
      )
    );
  }
  for (const id of ['satellites', 'outlook', 'reality', 'backtest', 'findings']) native(id, full, multiOnly);
  for (const id of ['model-scores', 'coefficients', 'scatter', 'importance']) native(id, full, undated);
  const params = new URLSearchParams({
    market: selectedMarket.kind,
    period: selectedMarket.period,
    geo: selectedMarket.geo
  });
  $('.lang').href = T.lang_href + '?' + params.toString();
  try {
    const url = new URL(location.href);
    url.search = params.toString();
    history.replaceState(null, '', url);
  } catch {
    /* file viewers may keep a read-only URL */
  }
}
function chooseGlobalPeriod(value) {
  const date = $('#marketDay'),
    select = $('#marketPeriod');
  if (value === 'custom') value = date.value ? 'd:' + date.value : 'd:';
  selectedMarket.period = value;
  const day = value.startsWith('d:');
  if (day) date.value = value.slice(2);
  select.value = Array.from(select.options).some((o) => o.value === value) ? value : 'custom';
  $('#dayField').hidden = !day;
  $('#solarDayField').hidden = !day || !FA;
  if (day && date.value) {
    $('#solarDay').value = solarDayKey(date.value);
    $('#solarDay').setCustomValidity('');
  }
  $('#playYears').hidden = value !== 'all' && !value.startsWith('y:');
  renderMarketView();
}
function initMarketFilters() {
  const definitions = [
    ['weekly', '#cityWeekly', T.weekly_title],
    ['archive', '#cityHistory', T.history_title],
    ['gilan', '#gilanHistory', T.gilan_history],
    ['tehran-map', '#tMap', T.s1_title],
    ['tehran-table', '#tSide', tr('Tehran district details', 'جزئیات مناطق تهران')],
    ['rank', '#tRank', tr('District price ranking', 'رتبه‌بندی قیمت مناطق')],
    ['changes', '#tCatch', tr('District price changes', 'تغییر قیمت مناطق')],
    ['price-input', '#vSearch', T.s2_title],
    ['valuation', '#vOut', T.est_title],
    ['iran-map', '#iMap', T.s3_title],
    ['iran-table', '#iSide', tr('Province observations', 'آمار استان‌ها')],
    ['cities-index', '#mChart', T.major_title],
    ['satellites', '#satChart', T.sat_title],
    ['forecast', '#fChart', tr('Tehran prices over time', 'روند قیمت تهران')],
    ['outlook', '#fOut', T.fc_out_title],
    ['reality', '#fReal', T.reality_title],
    ['yoy', '#yoyChart', T.yoy_title],
    ['backtest', '#fLb', T.lb_title],
    ['model-scores', '#mCv', T.s5_title],
    ['coefficients', '#coefChart', T.coef_title],
    ['scatter', '#scChart', T.scatter_title],
    ['importance', '#impChart', T.imp_title],
    ['findings', '#dFind', T.findings]
  ];
  definitions.forEach(([key, selector, title]) => registerPanel(key, selector, title));
  const select = $('#marketPeriod'),
    group = (label, values) => {
      const el = h('optgroup', { label });
      select.appendChild(el);
      values.forEach((v) => option(el, v, periodLabel(v)));
    };
  option(select, 'all', periodLabel('all'));
  option(select, 'custom', tr('Choose another day…', 'انتخاب روز دلخواه…'));
  group(
    tr('Survey dates', 'روزهای پایش'),
    knownDays.map((v) => 'd:' + v)
  );
  const allRows = Object.values(ledger).flat(),
    solar = new Set(MONTHS.map((m) => solarMonth(m.date)));
  allRows.forEach((r) => {
    solar.add(solarMonth(r.period_start));
    solar.add(solarMonth(r.period_end));
  });
  const solarKeys = [...solar].sort().reverse();
  group(tr('Solar years', 'سال‌های شمسی'), [...new Set(solarKeys.map((s) => 'y:' + s.slice(0, 4)))]);
  group(
    tr('Solar months', 'ماه‌های شمسی'),
    solarKeys.map((v) => 'j:' + v)
  );
  group(
    tr('Gregorian months', 'ماه‌های میلادی'),
    [...new Set(allRows.map((r) => r.period_start.slice(0, 7)))]
      .sort()
      .reverse()
      .map((v) => 'm:' + v)
  );
  const params = new URLSearchParams(location.search),
    kind = params.get('market'),
    geo = params.get('geo'),
    period = params.get('period');
  if (Object.hasOwn(markets, kind)) selectedMarket.kind = kind;
  if (geo === 'gilan') selectedMarket.geo = geo;
  $('#marketKind').value = selectedMarket.kind;
  $('#marketGeo').value = selectedMarket.geo;
  $('#marketDay').value = knownDays[0] || '';
  let playback = null;
  function stopPlayback() {
    clearInterval(playback);
    playback = null;
    $('#playYears').setAttribute('aria-pressed', 'false');
    $('#playYears').textContent = T.play_years;
  }
  $('#playYears').addEventListener('click', () => {
    if (playback) {
      stopPlayback();
      return;
    }
    const years = [...new Set(solarKeys.map((v) => v.slice(0, 4)))].sort();
    let index = years.indexOf(selectedMarket.period.slice(2)) + 1;
    if (index >= years.length) index = 0;
    const next = () => {
      if (index >= years.length) {
        stopPlayback();
        return;
      }
      chooseGlobalPeriod('y:' + years[index++]);
    };
    $('#playYears').textContent = tr('Pause', 'توقف');
    $('#playYears').setAttribute('aria-pressed', 'true');
    next();
    playback = setInterval(next, 1900);
  });
  select.addEventListener('change', stopPlayback);
  $('#marketKind').addEventListener('change', (e) => {
    selectedMarket.kind = e.target.value;
    renderMarketView();
  });
  $('#marketGeo').addEventListener('change', (e) => {
    selectedMarket.geo = e.target.value;
    renderMarketView();
  });
  select.addEventListener('change', (e) => {
    if (e.target.value === 'custom') {
      $('#dayField').hidden = false;
      $('#marketDay').focus();
      chooseGlobalPeriod('d:' + $('#marketDay').value);
    } else chooseGlobalPeriod(e.target.value);
  });
  $('#marketDay').addEventListener('change', (e) => {
    if ($('#dayField').hidden) return;
    if (!e.target.value) $('#solarDay').value = '';
    chooseGlobalPeriod('d:' + e.target.value);
  });
  $('#solarDay').addEventListener('change', (e) => {
    if ($('#solarDayField').hidden) return;
    const day = parseSolarInput(e.target.value);
    e.target.setCustomValidity(day ? '' : 'تاریخ شمسی معتبر وارد کنید');
    chooseGlobalPeriod('d:' + day);
    if (!day) e.target.reportValidity();
  });
  $('#marketCSV').addEventListener('click', () => writeCSV(datedRows(), 'divar'));
  $('#chCSV').addEventListener('click', () => writeCSV(currentCities, 'divar-cities'));
  const selectors = [$('#chCity1'), $('#chCity2'), $('#chCity3')];
  selectors.forEach((s, i) =>
    s.addEventListener('change', () => {
      selectors.forEach((other, j) => {
        if (i !== j && s.value && s.value === other.value) (j === 0 ? s : other).value = '';
      });
      renderChosenCities();
    })
  );
  const validDay =
    period &&
    /^d:\d{4}-\d{2}-\d{2}$/.test(period) &&
    Number.isFinite(+isoDate(period.slice(2))) &&
    isoDate(period.slice(2)).toISOString().slice(0, 10) === period.slice(2);
  chooseGlobalPeriod(
    validDay || (period !== 'custom' && Array.from(select.options).some((o) => o.value === period))
      ? period
      : selectedMarket.period
  );
}
