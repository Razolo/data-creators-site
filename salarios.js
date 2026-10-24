// ========================================
// Data Creators - Salários
// Reads the "Respostas" tab of the salary sheet (filled by a Google Form)
// ========================================

const SHEET_ID = '1pHDKC5Pj2KrhqquEskscExpMmNArob74HD9Q4vGOrIo';
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Respostas`;
// Google Form where members add their salary
const FORM_URL = '';

// Form question titles → field names (order in the sheet doesn't matter)
const COLUMNS = {
  cargo: 'Cargo',
  senioridade: 'Senioridade',
  area: 'Área',
  empresa: 'Empresa',
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
  search: $('salSearch'), sen: $('fSen'), area: $('fArea'), regime: $('fRegime'), mode: $('fMode'),
  clear: $('salClear'), form: $('formLink'),
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
      empresa: get(r, 'empresa'), setor: get(r, 'setor'), cidade: get(r, 'cidade'),
      modalidade: get(r, 'modalidade'), regime: get(r, 'regime'), bonus: get(r, 'bonus'),
      salario, exp: expRaw === '' ? NaN : parseFloat(expRaw.replace(',', '.')),
    };
    row.local = row.cidade;
    row.search = norm([row.cargo, row.senioridade, row.area, row.empresa, row.setor, row.cidade, row.modalidade, row.regime].join(' '));
    return row;
  }).filter(r => r.cargo && Number.isFinite(r.salario) && r.salario > 0);
}

// ========== Init ==========
async function init() {
  $('year').textContent = new Date().getFullYear();
  if (FORM_URL) els.form.href = FORM_URL; else els.form.parentElement.hidden = true;

  els.body.innerHTML = `<tr><td colspan="7" class="sal-empty">Carregando...</td></tr>`;
  try {
    const res = await fetch(SHEET_CSV_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    rows = toRows(parseCSV(await res.text()));
  } catch (err) {
    console.error('Salary sheet failed to load:', err);
    els.body.innerHTML = `<tr><td colspan="7" class="sal-empty">Não foi possível carregar os salários agora. Recarrega a página em alguns instantes.</td></tr>`;
    return;
  }

  fillSelect(els.sen, rows.map(r => r.senioridade), SENIORITY_ORDER);
  fillSelect(els.area, rows.map(r => r.area));
  fillSelect(els.regime, rows.map(r => r.regime));
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
  const f = { senioridade: els.sen.value, area: els.area.value, regime: els.regime.value, modalidade: els.mode.value };

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
  renderTable();
}

function median(list) {
  const s = [...list].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function renderStats() {
  const companies = new Set(view.map(r => norm(r.empresa)).filter(Boolean)).size;
  const byRegime = ['CLT', 'PJ'].map(reg => {
    const vals = view.filter(r => r.regime === reg).map(r => r.salario);
    return { reg, n: vals.length, med: vals.length >= MIN_FOR_MEDIAN ? median(vals) : null };
  });
  els.stats.innerHTML = `
    <div><dd>${view.length}</dd><dt>${view.length === 1 ? 'resposta' : 'respostas'}</dt></div>
    <div><dd>${companies}</dd><dt>${companies === 1 ? 'empresa' : 'empresas'}</dt></div>
    ${byRegime.map(b => `
      <div><dd>${b.med ? brl(b.med) : '·'}</dd><dt>mediana ${b.reg}${b.med ? '' : ` <small>(aparece com ${MIN_FOR_MEDIAN}+ respostas)</small>`}</dt></div>`).join('')}`;
}

function renderTable() {
  els.count.textContent = view.length;
  els.countLabel.textContent = view.length === 1 ? 'resposta' : 'respostas';

  if (!view.length) {
    els.body.innerHTML = `<tr><td colspan="7" class="sal-empty">Nenhuma resposta com esses filtros.</td></tr>`;
    return;
  }

  const cell = (label, html, cls = '') => `<td data-label="${label}"${cls ? ` class="${cls}"` : ''}><div>${html}</div></td>`;
  els.body.innerHTML = view.map(r => `
    <tr>
      ${cell('Cargo', `<strong>${esc(r.cargo)}</strong>${r.area ? `<span class="sub">${esc(r.area)}</span>` : ''}`)}
      ${cell('Senioridade', esc(r.senioridade) || '·')}
      ${cell('Empresa', `${esc(r.empresa) || '·'}${r.setor ? `<span class="sub">${esc(r.setor)}</span>` : ''}`)}
      ${cell('Local', `${esc(r.cidade) || '·'}${r.modalidade ? `<span class="sub">${esc(r.modalidade)}</span>` : ''}`)}
      ${cell('Regime', r.regime ? `<span class="pill">${esc(r.regime)}</span>` : '·')}
      ${cell('Exp.', Number.isFinite(r.exp) ? `${r.exp} ${r.exp === 1 ? 'ano' : 'anos'}` : '·', 'num')}
      ${cell('Salário', `<span class="money">${brl(r.salario)}</span>${r.bonus ? `<span class="sub">${esc(r.bonus)}</span>` : ''}`, 'num')}
    </tr>`).join('');
}

function bind() {
  let t;
  els.search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(apply, 150); });
  [els.sen, els.area, els.regime, els.mode].forEach(s => s.addEventListener('change', apply));
  els.clear.addEventListener('click', () => {
    els.search.value = '';
    [els.sen, els.area, els.regime, els.mode].forEach(s => { s.value = ''; });
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
