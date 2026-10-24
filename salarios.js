// ========================================
// Data Creators - Salários
// Reads the "Respostas" tab of the salary sheet (filled by a Google Form)
// ========================================

const SHEET_ID = '1pHDKC5Pj2KrhqquEskscExpMmNArob74HD9Q4vGOrIo';
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Respostas`;
// Google Form where members add their salary
const FORM_URL = 'https://docs.google.com/forms/d/132VAAhVx4sU6kDf5mtXzMscL9uQYWGDCvSS6LUP8XJA/viewform';

// Form question titles → field names (order in the sheet doesn't matter)
const COLUMNS = {
  cargo: 'Cargo',
  senioridade: 'Senioridade',
  area: 'Área',
  setor: 'Setor',
  cidade: 'Cidade/UF',
  modalidade: 'Modalidade',
  regime: 'Regime',
  salario: 'Salário mensal bruto (R$)',
  bonus: 'Bônus ou benefícios relevantes',
  exp: 'Anos de experiência em dados',
};

const SENIORITY_ORDER = ['Júnior', 'Pleno', 'Sênior', 'Especialista', 'Coordenação / Gestão'];
const MIN_FOR_MEDIAN = 3;

let rows = [];
let view = [];
const sort = { key: 'salario', dir: -1 };

const $ = (id) => document.getElementById(id);
const els = {
  body: $('salBody'), stats: $('salStats'), count: $('salCount'), countLabel: $('salCountLabel'),
  search: $('salSearch'), sen: $('fSen'), area: $('fArea'), setor: $('fSetor'), regime: $('fRegime'), mode: $('fMode'),
  clear: $('salClear'), form: $('formLink'),
  groupBy: $('groupBy'), mySalary: $('mySalary'), compare: $('vizCompare'),
  dist: $('distPlot'), distTitle: $('distTitle'), scatter: $('scatterPlot'), tip: $('vizTip'),
};

function esc(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const brl = (n) => 'R$ ' + Math.round(n).toLocaleString('pt-BR');

// ========== CSV ==========
function parseCSV(text) {
  const out = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (q) {
      if (c === '"' && n === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || (c === '\r' && n === '\n')) {
      row.push(cur); out.push(row); row = []; cur = '';
      if (c === '\r') i++;
    } else cur += c;
  }
  if (cur || row.length) { row.push(cur); out.push(row); }
  return out.filter(r => r.some(v => v.trim()));
}

// "12000", "12.000", "12.000,50", "12k", "R$ 12 mil" → 12000
function parseMoney(raw) {
  let s = norm(raw).replace(/r\$|\s/g, '');
  if (!s) return NaN;
  const mult = /k|mil/.test(s) ? 1000 : 1;
  s = s.replace(/k|mil/g, '');
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/[.,](?=\d{3}(\D|$))/g, '').replace(',', '.');
  const v = parseFloat(s) * mult;
  return Number.isFinite(v) ? v : NaN;
}

function toRows(table) {
  const header = table[0].map(h => h.trim());
  const idx = {};
  Object.entries(COLUMNS).forEach(([k, title]) => { idx[k] = header.findIndex(h => norm(h) === norm(title)); });
  const get = (r, k) => (idx[k] >= 0 ? (r[idx[k]] || '').trim() : '');

  return table.slice(1).map(r => {
    const salario = parseMoney(get(r, 'salario'));
    const expRaw = get(r, 'exp');
    const row = {
      cargo: get(r, 'cargo'), senioridade: get(r, 'senioridade'), area: get(r, 'area'),
      setor: get(r, 'setor'), cidade: get(r, 'cidade'),
      modalidade: get(r, 'modalidade'), regime: get(r, 'regime'), bonus: cleanBonus(get(r, 'bonus')),
      salario, exp: expRaw === '' ? NaN : parseFloat(expRaw.replace(',', '.')),
    };
    row.local = row.cidade;
    row.search = norm([row.cargo, row.senioridade, row.area, row.setor, row.cidade, row.modalidade, row.regime, row.bonus].join(' '));
    return row;
  }).filter(r => r.cargo && Number.isFinite(r.salario) && r.salario > 0);
}

// "Não", "-", "nenhum" are answers to the question, not benefits
function cleanBonus(raw) {
  const t = (raw || '').trim();
  return /^(n[aã]o|nao tem|nenhum|nenhuma|-+|n\/a|na|sem)\.?$/i.test(t) ? '' : t;
}

// ========== Init ==========
async function init() {
  $('year').textContent = new Date().getFullYear();
  if (FORM_URL) els.form.href = FORM_URL; else els.form.parentElement.hidden = true;

  els.body.innerHTML = `<tr><td colspan="8" class="sal-empty">Carregando...</td></tr>`;
  try {
    const res = await fetch(SHEET_CSV_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    rows = toRows(parseCSV(await res.text()));
  } catch (err) {
    console.error('Salary sheet failed to load:', err);
    els.body.innerHTML = `<tr><td colspan="8" class="sal-empty">Não foi possível carregar os salários agora. Recarrega a página em alguns instantes.</td></tr>`;
    return;
  }

  fillSelect(els.sen, rows.map(r => r.senioridade), SENIORITY_ORDER);
  fillSelect(els.area, rows.map(r => r.area));
  fillSelect(els.regime, rows.map(r => r.regime));
  fillSelect(els.setor, rows.map(r => r.setor));
  fillSelect(els.mode, rows.map(r => r.modalidade));
  bind();
  apply();
}

function fillSelect(sel, values, order) {
  const uniq = [...new Set(values.filter(Boolean))];
  uniq.sort((a, b) => order ? (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) || a.localeCompare(b) : a.localeCompare(b, 'pt-BR'));
  sel.insertAdjacentHTML('beforeend', uniq.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join(''));
  sel.hidden = uniq.length === 0;
}

// ========== Filter / sort / render ==========
function apply() {
  const q = norm(els.search.value.trim());
  const f = { senioridade: els.sen.value, area: els.area.value, setor: els.setor.value, regime: els.regime.value, modalidade: els.mode.value };

  view = rows.filter(r =>
    (!q || q.split(/\s+/).every(t => r.search.includes(t))) &&
    Object.entries(f).every(([k, v]) => !v || r[k] === v));

  const { key, dir } = sort;
  view.sort((a, b) => {
    const x = a[key], y = b[key];
    if (typeof x === 'number' || typeof y === 'number') {
      const nx = Number.isFinite(x) ? x : -Infinity, ny = Number.isFinite(y) ? y : -Infinity;
      return (nx - ny) * dir;
    }
    if (key === 'senioridade') return ((SENIORITY_ORDER.indexOf(x) + 1 || 99) - (SENIORITY_ORDER.indexOf(y) + 1 || 99)) * dir;
    return String(x).localeCompare(String(y), 'pt-BR') * dir;
  });

  els.clear.hidden = !(q || Object.values(f).some(Boolean));
  renderStats();
  renderCharts();
  renderTable();
}

function median(list) {
  const s = [...list].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function renderStats() {
  const sectors = new Set(view.map(r => r.setor).filter(Boolean)).size;
  const byRegime = ['CLT', 'PJ'].map(reg => {
    const vals = view.filter(r => r.regime === reg).map(r => r.salario);
    return { reg, n: vals.length, med: vals.length >= MIN_FOR_MEDIAN ? median(vals) : null };
  });
  els.stats.innerHTML = `
    <div><dd>${view.length}</dd><dt>${view.length === 1 ? 'resposta' : 'respostas'}</dt></div>
    <div><dd>${sectors}</dd><dt>${sectors === 1 ? 'setor' : 'setores'}</dt></div>
    ${byRegime.map(b => `
      <div><dd>${b.med ? brl(b.med) : '·'}</dd><dt>mediana ${b.reg}${b.med ? '' : ` <small>(aparece com ${MIN_FOR_MEDIAN}+ respostas)</small>`}</dt></div>`).join('')}`;
}

function renderTable() {
  els.count.textContent = view.length;
  els.countLabel.textContent = view.length === 1 ? 'resposta' : 'respostas';

  if (!view.length) {
    els.body.innerHTML = `<tr><td colspan="8" class="sal-empty">Nenhuma resposta com esses filtros.</td></tr>`;
    return;
  }

  const cell = (label, html, cls = '') => `<td data-label="${label}"${cls ? ` class="${cls}"` : ''}><div>${html}</div></td>`;
  els.body.innerHTML = view.map(r => `
    <tr>
      ${cell('Cargo', `<strong>${esc(r.cargo)}</strong>${r.area ? `<span class="sub">${esc(r.area)}</span>` : ''}`)}
      ${cell('Senioridade', esc(r.senioridade) || '·')}
      ${cell('Setor', esc(r.setor) || '·')}
      ${cell('Local', `${esc(r.cidade) || '·'}${r.modalidade ? `<span class="sub">${esc(r.modalidade)}</span>` : ''}`)}
      ${cell('Regime', r.regime ? `<span class="pill">${esc(r.regime)}</span>` : '·')}
      ${cell('Exp.', Number.isFinite(r.exp) ? `${r.exp} ${r.exp === 1 ? 'ano' : 'anos'}` : '·', 'num')}
      ${cell('Salário', `<span class="money">${brl(r.salario)}</span>`, 'num')}
      ${cell('Benefícios', r.bonus ? `<span class="bonus" title="${esc(r.bonus)}">${esc(r.bonus)}</span>` : '·', 'col-bonus')}
    </tr>`).join('');
}

// ========== Charts ==========
const SVGNS = 'http://www.w3.org/2000/svg';
const GROUP_LABELS = { senioridade: 'senioridade', area: 'área', setor: 'setor', regime: 'regime', modalidade: 'modalidade' };

function svgEl(tag, attrs = {}, parent) {
  const el = document.createElementNS(SVGNS, tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  if (parent) parent.appendChild(el);
  return el;
}

function regimeClass(r) {
  if (r.regime === 'CLT') return 'dot-clt';
  if (r.regime === 'PJ') return 'dot-pj';
  return 'dot-other';
}

const compactBRL = (n) => n >= 1000 ? `R$ ${(n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k` : `R$ ${Math.round(n)}`;

// Clean tick values covering [0, max]
function niceTicks(max, count = 5) {
  if (max <= 0) return [0];
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(st => st >= raw);
  const ticks = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

function mySalaryValue() {
  const v = parseMoney(els.mySalary.value);
  return Number.isFinite(v) && v > 0 ? v : null;
}

// Deterministic jitter so dots in the same group don't sit on one line
function jitter(i) {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) - 0.5;
}

function showTip(evt, r) {
  const tip = els.tip;
  tip.replaceChildren();
  const strong = document.createElement('strong');
  strong.textContent = brl(r.salario);
  const line1 = document.createElement('span');
  line1.textContent = [r.cargo, r.senioridade].filter(Boolean).join(' · ');
  const line2 = document.createElement('span');
  line2.textContent = [r.setor, r.regime, Number.isFinite(r.exp) ? `${r.exp} ${r.exp === 1 ? 'ano' : 'anos'}` : ''].filter(Boolean).join(' · ');
  tip.append(strong, line1, line2);
  tip.hidden = false;
  const host = tip.parentElement.getBoundingClientRect();
  const target = evt.currentTarget.getBoundingClientRect();
  let x = target.left + target.width / 2 - host.left;
  const y = target.top - host.top;
  const w = tip.offsetWidth;
  x = Math.max(w / 2 + 4, Math.min(host.width - w / 2 - 4, x));
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
}
function hideTip() { els.tip.hidden = true; }

function addDot(g, r, cx, cy) {
  const hit = svgEl('g', { class: `dot ${regimeClass(r)}`, tabindex: '0', role: 'img', 'aria-label': `${r.cargo}, ${brl(r.salario)}` }, g);
  svgEl('circle', { cx, cy, r: 12, class: 'dot-hit' }, hit);
  svgEl('circle', { cx, cy, r: 5.5, class: 'dot-mark' }, hit);
  hit.addEventListener('pointerenter', e => showTip(e, r));
  hit.addEventListener('pointerleave', hideTip);
  hit.addEventListener('focus', e => showTip(e, r));
  hit.addEventListener('blur', hideTip);
}

function emptyPlot(host, msg) {
  host.replaceChildren();
  const p = document.createElement('p');
  p.className = 'viz-empty';
  p.textContent = msg;
  host.appendChild(p);
}

function renderCharts() {
  hideTip();
  const mine = mySalaryValue();
  renderCompare(mine);
  renderDistribution(mine);
  renderScatter(mine);
}

function renderCompare(mine) {
  if (!mine || !view.length) { els.compare.hidden = true; return; }
  const below = view.filter(r => r.salario < mine).length;
  const pct = Math.round((below / view.length) * 100);
  els.compare.hidden = false;
  els.compare.textContent = `${brl(mine)} fica acima de ${pct}% das ${view.length} ${view.length === 1 ? 'resposta' : 'respostas'} desse filtro. O valor fica só no teu navegador, não vai pra planilha.`;
}

function renderDistribution(mine) {
  const key = els.groupBy.value;
  els.distTitle.textContent = `Salário por ${GROUP_LABELS[key]}`;
  if (!view.length) return emptyPlot(els.dist, 'Nenhuma resposta com esses filtros.');

  const groups = new Map();
  view.forEach(r => {
    const k = r[key] || 'Não informado';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  });
  let entries = [...groups.entries()].map(([name, list]) => ({ name, list, med: median(list.map(r => r.salario)) }));
  if (key === 'senioridade') {
    entries.sort((a, b) => (SENIORITY_ORDER.indexOf(a.name) + 1 || 99) - (SENIORITY_ORDER.indexOf(b.name) + 1 || 99));
  } else {
    entries.sort((a, b) => b.med - a.med);
  }

  const width = Math.max(els.dist.clientWidth, 280);
  const labelW = Math.min(150, width * 0.34);
  const pad = { top: 8, right: 16, bottom: 30, left: labelW };
  const rowH = 46;
  const height = pad.top + entries.length * rowH + pad.bottom;
  const max = Math.max(...view.map(r => r.salario), mine || 0) * 1.05;
  const ticks = niceTicks(max, width < 420 ? 3 : 5);
  const xMax = ticks[ticks.length - 1];
  const x = v => pad.left + (v / xMax) * (width - pad.left - pad.right);

  const svg = svgEl('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'group', 'aria-label': `Salário por ${GROUP_LABELS[key]}` });
  const grid = svgEl('g', { class: 'grid' }, svg);
  ticks.forEach(t => {
    svgEl('line', { x1: x(t), x2: x(t), y1: pad.top, y2: height - pad.bottom }, grid);
    const tx = svgEl('text', { x: x(t), y: height - pad.bottom + 18, class: 'tick', 'text-anchor': 'middle' }, grid);
    tx.textContent = compactBRL(t);
  });

  entries.forEach((e, gi) => {
    const yMid = pad.top + gi * rowH + rowH / 2;
    if (gi > 0) svgEl('line', { x1: 0, x2: width - pad.right, y1: pad.top + gi * rowH, y2: pad.top + gi * rowH, class: 'row-rule' }, svg);
    const name = svgEl('text', { x: 0, y: yMid - 2, class: 'row-label' }, svg);
    name.textContent = e.name.length > 22 ? e.name.slice(0, 21) + '…' : e.name;
    const n = svgEl('text', { x: 0, y: yMid + 13, class: 'row-sub' }, svg);
    n.textContent = `${e.list.length} ${e.list.length === 1 ? 'pessoa' : 'pessoas'}${e.list.length >= 2 ? ` · med. ${compactBRL(e.med)}` : ''}`;

    if (e.list.length >= 2) {
      svgEl('line', { x1: x(e.med), x2: x(e.med), y1: yMid - 14, y2: yMid + 14, class: 'median' }, svg);
    }
    const g = svgEl('g', {}, svg);
    e.list.forEach((r, i) => addDot(g, r, x(r.salario), yMid + (e.list.length > 1 ? jitter(i + gi * 31) * 18 : 0)));
  });

  if (mine) drawMine(svg, x(mine), pad.top, height - pad.bottom);
  els.dist.replaceChildren(svg);
}

function renderScatter(mine) {
  const pts = view.filter(r => Number.isFinite(r.exp));
  if (pts.length < 2) {
    return emptyPlot(els.scatter, pts.length
      ? 'Só 1 resposta com anos de experiência nesse filtro. O gráfico aparece a partir de 2.'
      : 'Ainda não tem resposta com anos de experiência nesse filtro.');
  }
  const width = Math.max(els.scatter.clientWidth, 280);
  const height = 300;
  const pad = { top: 12, right: 16, bottom: 40, left: 56 };
  const yTicks = niceTicks(Math.max(...pts.map(r => r.salario), mine || 0) * 1.05, 4);
  const xTicks = niceTicks(Math.max(...pts.map(r => r.exp), 1), width < 420 ? 4 : 6);
  const yMax = yTicks[yTicks.length - 1], xMax = xTicks[xTicks.length - 1];
  const x = v => pad.left + (v / xMax) * (width - pad.left - pad.right);
  const y = v => height - pad.bottom - (v / yMax) * (height - pad.top - pad.bottom);

  const svg = svgEl('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'group', 'aria-label': 'Salário por anos de experiência' });
  const grid = svgEl('g', { class: 'grid' }, svg);
  yTicks.forEach(t => {
    svgEl('line', { x1: pad.left, x2: width - pad.right, y1: y(t), y2: y(t) }, grid);
    const tx = svgEl('text', { x: pad.left - 8, y: y(t) + 4, class: 'tick', 'text-anchor': 'end' }, grid);
    tx.textContent = compactBRL(t);
  });
  xTicks.forEach(t => {
    const tx = svgEl('text', { x: x(t), y: height - pad.bottom + 18, class: 'tick', 'text-anchor': 'middle' }, grid);
    tx.textContent = t;
  });
  const xl = svgEl('text', { x: (pad.left + width - pad.right) / 2, y: height - 4, class: 'axis-label', 'text-anchor': 'middle' }, svg);
  xl.textContent = 'anos de experiência em dados';

  if (mine) {
    svgEl('line', { x1: pad.left, x2: width - pad.right, y1: y(mine), y2: y(mine), class: 'mine' }, svg);
    const lt = svgEl('text', { x: width - pad.right, y: y(mine) - 6, class: 'mine-label', 'text-anchor': 'end' }, svg);
    lt.textContent = `teu salário · ${compactBRL(mine)}`;
  }
  const g = svgEl('g', {}, svg);
  pts.forEach(r => addDot(g, r, x(r.exp), y(r.salario)));
  els.scatter.replaceChildren(svg);
}

function drawMine(svg, xPos, y1, y2) {
  svgEl('line', { x1: xPos, x2: xPos, y1, y2, class: 'mine' }, svg);
  const flip = xPos > Number(svg.getAttribute('width')) * 0.7;
  const t = svgEl('text', { x: flip ? xPos - 6 : xPos + 6, y: y1 + 10, class: 'mine-label', 'text-anchor': flip ? 'end' : 'start' }, svg);
  t.textContent = 'teu salário';
}

function bind() {
  let t;
  els.search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(apply, 150); });
  [els.sen, els.area, els.setor, els.regime, els.mode].forEach(s => s.addEventListener('change', apply));
  // Long benefit lists are clamped to 3 lines; click the row to read all of it
  els.body.addEventListener('click', e => {
    const tr = e.target.closest('tr');
    if (tr && tr.querySelector('.bonus')) tr.classList.toggle('is-open');
  });
  els.groupBy.addEventListener('change', renderCharts);
  els.mySalary.addEventListener('input', () => { clearTimeout(t); t = setTimeout(renderCharts, 150); });
  if (window.ResizeObserver) new ResizeObserver(() => { clearTimeout(t); t = setTimeout(renderCharts, 100); }).observe(els.dist);
  els.clear.addEventListener('click', () => {
    els.search.value = '';
    [els.sen, els.area, els.setor, els.regime, els.mode].forEach(s => { s.value = ''; });
    apply();
  });
  document.querySelectorAll('.sal-table th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      sort.dir = sort.key === key ? -sort.dir : (key === 'salario' || key === 'exp' ? -1 : 1);
      sort.key = key;
      document.querySelectorAll('.sal-table th').forEach(h => { h.classList.remove('is-sorted'); h.removeAttribute('aria-sort'); });
      th.classList.add('is-sorted');
      th.setAttribute('aria-sort', sort.dir === 1 ? 'ascending' : 'descending');
      apply();
    });
  });
}

document.addEventListener('DOMContentLoaded', init);
