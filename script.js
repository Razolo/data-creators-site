// ========================================
// Data Creators - Banco de Talentos
// Google Sheets live data + JSON fallback
// ========================================

const SHEETS_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRlL30U3GNC8XDriVPwmUjbLlClozuWISNq7winR0b_sU4G3WyT7LAf_fukQzGMAoNUbIPJ3_HMM9a_/pub?output=csv';

// LinkedIn can't prefill a message, so "Solicitar indicação" copies it and opens the profile
const LINKEDIN_URL = 'https://www.linkedin.com/in/heitorsasaki/';

const SITE_URL = 'https://data-creators-site.vercel.app/';
const SHORTLIST_KEY = 'dc-shortlist';

// ========== Taxonomies ==========
const AREAS = [
  { key: 'analise', label: 'Análise de Dados', re: /analista|analyst|analise de dados/ },
  { key: 'engenharia', label: 'Engenharia de Dados', re: /engenheir[oa] de dados|engenharia de dados|data engineer/ },
  { key: 'ae', label: 'Analytics Engineering', re: /analytics engineer|engenheir[oa] de analytics/ },
  { key: 'ciencia', label: 'Ciência de Dados e IA', re: /cientista|ciencia de dados|data scien|machine learning|engenheir[oa] de (ml|ia)|\bml\b/ },
  { key: 'bi', label: 'BI', re: /\bbi\b|business intelligence/ },
  { key: 'negocios', label: 'Negócios e Finanças', re: /negocio|business analyst|fp&a|pricing|financeir|economista|revops|growth|crm|mercado|marketing/ },
  { key: 'governanca', label: 'Governança e Qualidade', re: /governanca|data quality|qualidade de dados/ },
  { key: 'lideranca', label: 'Liderança', re: /coordena|gestor|gerente|tech lead|head/ },
];

// rank: used for sorting ("mais experientes primeiro")
const LEVELS = [
  { key: 'junior', label: 'Júnior', rank: 1, re: /junior|\bjr\b|estagi/ },
  { key: 'pleno', label: 'Pleno', rank: 2, re: /pleno/ },
  { key: 'senior', label: 'Sênior', rank: 3, re: /senior|\bsr\b/ },
  { key: 'especialista', label: 'Especialista / Liderança', rank: 4, re: /especialista|coordena|gestor|tech lead/ },
];

const MODES = [
  { key: 'remoto', label: 'Remoto', re: /remot/ },
  { key: 'hibrido', label: 'Híbrido', re: /hibrid/ },
  { key: 'presencial', label: 'Presencial', re: /presencial/ },
];

// Spelling fixes applied to free text coming from the form
const TYPO_FIXES = [
  [/enginner/gi, 'Engineer'],
  [/ci[eê]ntista/gi, 'Cientista'],
  [/markting/gi, 'Marketing'],
  [/neg[oó]cios/gi, 'Negócios'],
  [/opera?[cç][oõ]es/gi, 'Operações'],
  [/e-?commecer/gi, 'E-commerce'],
];

// ========== State ==========
let people = [];
let filtered = [];
const state = {
  query: '',
  areas: new Set(),
  levels: new Set(),
  cities: new Set(),
  skills: new Set(),
  modes: new Set(),
  immediate: false,
  sort: 'relevancia',
};
let shortlist = loadShortlist();
let lastFocus = null;
let modalPushed = false;

// ========== DOM ==========
const $ = (id) => document.getElementById(id);
const els = {
  search: $('searchInput'),
  sort: $('sortSelect'),
  areaChips: $('areaChips'),
  immediate: $('immediateToggle'),
  clear: $('clearFilters'),
  grid: $('cardsGrid'),
  count: $('resultsCount'),
  countLabel: $('resultsLabel'),
  overlay: $('modalOverlay'),
  modalContent: $('modalContent'),
  modalClose: $('modalClose'),
  bar: $('shortlistBar'),
  barCount: $('shortlistCount'),
  barLabel: $('shortlistLabel'),
  barToggle: $('shortlistToggle'),
  barList: $('shortlistList'),
  barClear: $('shortlistClear'),
  barSend: $('shortlistSend'),
  toast: $('toast'),
};

// ========== Helpers ==========
function esc(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function slugify(s) {
  return norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function fixTypos(s) {
  return TYPO_FIXES.reduce((acc, [re, to]) => acc.replace(re, to), s || '');
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function plural(n, one, many) {
  return n === 1 ? one : many;
}

function icon(id) {
  return `<svg class="icon" aria-hidden="true"><use href="#${id}"/></svg>`;
}

function getInitials(name) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function safeUrl(url) {
  return /^https?:\/\//i.test(url || '') ? url : '';
}

// ========== CSV Parser ==========
function parseCSV(text) {
  const rows = [];
  let current = '';
  let inQuotes = false;
  let row = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        current += '"';
        i++; // skip escaped quote
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(current.trim());
        current = '';
      } else if (ch === '\n' || (ch === '\r' && next === '\n')) {
        row.push(current.trim());
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
        current = '';
        if (ch === '\r') i++; // skip \n after \r
      } else {
        current += ch;
      }
    }
  }
  if (current || row.length > 0) {
    row.push(current.trim());
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }

  return rows;
}

// ========== Smart split: detect delimiter and split respecting parentheses ==========
function smartSplit(raw) {
  if (!raw) return { parts: [], mainDelimiter: ',' };

  let slashCount = 0;
  let pipeCount = 0;
  let depth = 0;
  for (const ch of raw) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (depth === 0) {
      if (ch === '/') slashCount++;
      else if (ch === '|') pipeCount++;
    }
  }

  // Priority: pipe > slash > comma
  let mainDelimiter;
  if (pipeCount >= 2) mainDelimiter = '|';
  else if (slashCount >= 2) mainDelimiter = '/';
  else mainDelimiter = ',';

  const parts = [];
  let current = '';
  let parenDepth = 0;
  for (const ch of raw) {
    if (ch === '(') parenDepth++;
    else if (ch === ')') parenDepth--;

    if (ch === mainDelimiter && parenDepth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);

  return { parts, mainDelimiter };
}

// ========== Parse habilidades string ==========
function parseHabilidades(raw) {
  if (!raw) return [];

  const { parts, mainDelimiter } = smartSplit(raw);
  const skills = [];

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // "Python(Pandas, Matplotlib)" expands only when the main delimiter is "/"
    const parenMatch = trimmed.match(/^([^(]+)\(([^)]+)\)$/);
    if (parenMatch && mainDelimiter === '/') {
      const main = parenMatch[1].trim();
      if (main) skills.push(main);
      skills.push(...parenMatch[2].split(',').map(s => s.trim()).filter(Boolean));
    } else {
      // "Machine Learning (ML)" → "Machine Learning"
      const cleaned = trimmed.replace(/\s*\([^)]*\)\s*$/, '').trim();
      if (cleaned) skills.push(cleaned);
    }
  }

  return skills.filter(Boolean);
}

// Roles come as "A / B | C", ". " or one per line
function parseCargos(raw) {
  const text = fixTypos(raw || '').replace(/\r?\n/g, ' / ').replace(/\.\s+(?=[A-ZÀ-Ú])/g, ' / ');
  const seen = new Set();
  return text.split(/\s*[\/|]\s*/)
    .map(s => capitalize(s.trim().replace(/[.,;]+$/, '')))
    .filter(s => s && s.length > 1)
    .filter(s => {
      const k = norm(s);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

function normalizeCity(raw) {
  // "São Paulo / SP", "Itajaí, SC", "Sorocaba - SP" → "Cidade/UF"
  let c = (raw || '').trim().replace(/\s*[,\-–]\s*/g, '/').replace(/\s*\/\s*/g, '/');
  if (!c) return '';
  if (!c.includes('/') && norm(c) === 'sao paulo') c = 'São Paulo/SP';
  return c;
}

// ========== Row → person ==========
function buildPerson(raw) {
  const nome = (raw.nome || '').trim();
  if (!nome) return null;

  const cargos = Array.isArray(raw.cargos) ? raw.cargos.flatMap(parseCargos) : parseCargos(raw.cargos);
  const habilidades = Array.isArray(raw.habilidades) ? raw.habilidades : parseHabilidades(raw.habilidades);
  const senioridadeRaw = (raw.senioridade || '').trim();
  const experiencia = fixTypos((raw.experiencia || '').trim());
  const modalidadeRaw = (raw.modalidade || '').trim();
  const disponibilidade = (raw.disponibilidade || '').trim();

  const roleText = norm(cargos.join(' '));
  const levelText = norm(senioridadeRaw) + ' ' + roleText;
  const levels = LEVELS.filter(l => l.re.test(levelText)).map(l => l.key);
  const maxRank = Math.max(0, ...LEVELS.filter(l => levels.includes(l.key)).map(l => l.rank));

  const areas = AREAS.filter(a => a.re.test(roleText)).map(a => a.key);
  const modes = MODES.filter(m => m.re.test(norm(modalidadeRaw))).map(m => m.key);

  let linkedin = (raw.linkedin || '').trim();
  if (linkedin && !/^https?:\/\//i.test(linkedin)) linkedin = 'https://' + linkedin;
  if (!/linkedin\.com/i.test(linkedin)) linkedin = '';

  let portfolio = (raw.portfolio || '').trim();
  if (portfolio && !/^https?:\/\//i.test(portfolio)) portfolio = 'https://' + portfolio;
  if (!/\.[a-z]{2,}/i.test(portfolio)) portfolio = '';

  const avail = parseAvailability(disponibilidade);

  const completeness =
    (experiencia.length > 150 ? 2 : experiencia ? 1 : 0) +
    (linkedin ? 1 : 0) +
    (portfolio ? 1 : 0) +
    (levels.length ? 1 : 0);

  return {
    nome,
    slug: slugify(nome),
    linkedin,
    portfolio,
    cidade: normalizeCity(raw.cidade),
    modalidade: modes.length ? modes.map(k => MODES.find(m => m.key === k).label).join(' · ') : modalidadeRaw,
    modes,
    formacao: (raw.formacao || '').trim(),
    habilidades,
    experiencia,
    cargos,
    role: cargos[0] || '',
    levels,
    maxRank,
    levelLabel: levels.length ? levelLabelFor(senioridadeRaw, levels) : '',
    levelShort: levels.length ? levelShortFor(senioridadeRaw, levels) : '',
    areas,
    avail,
    completeness,
    searchText: norm([nome, raw.cidade, raw.formacao, experiencia, senioridadeRaw, ...habilidades, ...cargos].join(' ')),
  };
}

function levelLabelFor(raw, levels) {
  // Prefer what the person wrote ("Pleno/Senior"), with accents fixed
  if (raw) {
    return raw.split(/\s*[\/|,]\s*/).map(part => {
      const lv = LEVELS.find(l => l.re.test(norm(part)));
      if (!lv) return capitalize(part);
      return lv.key === 'especialista' ? capitalize(part) : lv.label;
    }).join(' / ');
  }
  const top = LEVELS.filter(l => levels.includes(l.key)).pop();
  return top.key === 'especialista' ? 'Especialista' : top.label;
}

// Card badge: keep "Pleno / Sênior", collapse longer lists to the highest level
function levelShortFor(raw, levels) {
  const full = levelLabelFor(raw, levels);
  if (full.split(' / ').length <= 2 && full.length <= 22) return full;
  const top = LEVELS.filter(l => levels.includes(l.key)).pop();
  return top.key === 'especialista' ? 'Especialista' : top.label;
}

function parseAvailability(raw) {
  const a = norm(raw);
  if (!a) return { label: '', days: 999, tone: 'gray' };
  if (/imediat/.test(a)) return { label: 'Início imediato', days: 0, tone: 'green' };
  const weeks = a.match(/(\d+|uma|duas|tres)\s*semana/);
  if (weeks) {
    const n = { uma: 1, duas: 2, tres: 3 }[weeks[1]] || parseInt(weeks[1], 10);
    return { label: `Início em ${n} ${plural(n, 'semana', 'semanas')}`, days: n * 7, tone: 'amber' };
  }
  const days = a.match(/(\d+)\s*dias/);
  if (days) return { label: `Início em ${days[1]} dias`, days: parseInt(days[1], 10), tone: 'amber' };
  if (/negocia/.test(a)) return { label: 'Início a combinar', days: 60, tone: 'gray' };
  return { label: capitalize(raw), days: 90, tone: 'gray' };
}

// Same skill written differently ("python", "Python ", "PowerBI") collapses into one
function canonicalizeSkills(list) {
  const variants = {};
  list.forEach(p => p.habilidades.forEach(s => {
    const k = norm(s).replace(/[\s.\-_]/g, '');
    if (!k) return;
    variants[k] = variants[k] || {};
    variants[k][s] = (variants[k][s] || 0) + 1;
  }));
  const display = {};
  Object.entries(variants).forEach(([k, v]) => {
    display[k] = Object.entries(v).sort((a, b) => b[1] - a[1] || /[A-Z]/.test(b[0]) - /[A-Z]/.test(a[0]))[0][0];
  });
  list.forEach(p => {
    const seen = new Set();
    p.skillKeys = [];
    p.habilidades = p.habilidades.map(s => {
      const k = norm(s).replace(/[\s.\-_]/g, '');
      return { k, label: display[k] || s };
    }).filter(({ k }) => k && !seen.has(k) && seen.add(k)).map(({ k, label }) => {
      p.skillKeys.push(k);
      return label;
    });
  });
  return display;
}

// ========== Fetch data ==========
async function fetchRows() {
  try {
    const res = await fetch(SHEETS_CSV_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = parseCSV(await res.text());
    if (rows.length < 2) throw new Error('No data rows');
    // Columns: Nome, E-mail, Linkedin, Cidade/Estado, Modalidade, Formação, Habilidades, Experiência, Cargos, Portfólio, Disponibilidade, Senioridade
    return rows.slice(1).map(r => ({
      nome: r[0], linkedin: r[2], cidade: r[3], modalidade: r[4], formacao: r[5],
      habilidades: r[6], experiencia: r[7], cargos: r[8], portfolio: r[9],
      disponibilidade: r[10], senioridade: r[11],
    }));
  } catch (err) {
    console.warn('Google Sheets fetch failed, falling back to data.json:', err.message);
  }
  const res = await fetch('./data.json');
  return res.json();
}

// ========== Init ==========
async function init() {
  $('year').textContent = new Date().getFullYear();
  renderSkeleton();

  try {
    const rows = await fetchRows();
    const slugCount = {};
    people = rows.map(buildPerson).filter(Boolean);
    people.forEach(p => {
      slugCount[p.slug] = (slugCount[p.slug] || 0) + 1;
      if (slugCount[p.slug] > 1) p.slug += '-' + slugCount[p.slug];
    });
    const skillDisplay = canonicalizeSkills(people);

    shortlist = shortlist.filter(s => people.some(p => p.slug === s));
    renderStats();
    buildAreaChips();
    buildDropdowns(skillDisplay);
    bindEvents();
    applyFilters();
    renderShortlist();
    openFromHash();
  } catch (err) {
    console.error('Error loading data:', err);
    els.grid.innerHTML = `<div class="no-results"><h3>Não foi possível carregar os perfis</h3><p>A página pode ser recarregada em alguns instantes. Se o problema continuar, entre em contato pelo LinkedIn.</p></div>`;
  }
}

function renderSkeleton() {
  els.grid.innerHTML = Array.from({ length: 6 }, () => '<div class="skeleton"></div>').join('');
}

function renderStats() {
  const set = (k, v) => { const el = document.querySelector(`[data-stat="${k}"]`); if (el) el.textContent = v; };
  set('total', people.length);
  set('imediata', people.filter(p => p.avail.days === 0).length);
  set('areas', AREAS.filter(a => people.some(p => p.areas.includes(a.key))).length);
  set('cidades', new Set(people.map(p => p.cidade).filter(Boolean)).size);
}

// ========== Filters UI ==========
function buildAreaChips() {
  const counts = {};
  people.forEach(p => p.areas.forEach(a => { counts[a] = (counts[a] || 0) + 1; }));
  els.areaChips.innerHTML = AREAS.filter(a => counts[a.key]).map(a => `
    <button type="button" class="chip" data-area="${a.key}" aria-pressed="false">
      ${esc(a.label)} <span class="chip-count">${counts[a.key]}</span>
    </button>`).join('');
}

const dropdowns = {};

function buildDropdowns(skillDisplay) {
  const count = (fn) => {
    const c = {};
    people.forEach(p => fn(p).forEach(v => { if (v) c[v] = (c[v] || 0) + 1; }));
    return c;
  };

  const levelCounts = count(p => p.levels);
  const cityCounts = count(p => [p.cidade]);
  const skillCounts = count(p => p.skillKeys);
  const modeCounts = count(p => p.modes);

  dropdowns.seniority = makeDropdown('seniority', 'Senioridade', state.levels,
    LEVELS.filter(l => levelCounts[l.key]).map(l => ({ value: l.key, label: l.label, count: levelCounts[l.key] })));

  dropdowns.city = makeDropdown('city', 'Cidade', state.cities,
    Object.entries(cityCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([v, n]) => ({ value: v, label: v, count: n })), { searchable: true, placeholder: 'Buscar cidade...' });

  dropdowns.skill = makeDropdown('skill', 'Ferramentas', state.skills,
    Object.entries(skillCounts).sort((a, b) => b[1] - a[1]).slice(0, 60)
      .map(([k, n]) => ({ value: k, label: skillDisplay[k], count: n })), { searchable: true, placeholder: 'Buscar ferramenta...' });

  dropdowns.mode = makeDropdown('mode', 'Modalidade', state.modes,
    MODES.filter(m => modeCounts[m.key]).map(m => ({ value: m.key, label: m.label, count: modeCounts[m.key] })));
}

function makeDropdown(name, label, set, options, opts = {}) {
  const root = document.querySelector(`[data-ms="${name}"]`);
  root.innerHTML = `
    <button type="button" class="chip ms-btn" aria-haspopup="true" aria-expanded="false">
      <span class="ms-label">${esc(label)}</span>${icon('i-chev')}
    </button>
    <div class="ms-panel" role="group" aria-label="${esc(label)}">
      ${opts.searchable ? `<div class="ms-search"><input type="text" placeholder="${esc(opts.placeholder)}" aria-label="${esc(opts.placeholder)}"></div>` : ''}
      <div class="ms-options">
        ${options.map(o => `
          <label class="ms-option" data-label="${esc(norm(o.label))}">
            <input type="checkbox" value="${esc(o.value)}">
            <span>${esc(o.label)}</span>
            <span class="ms-count">${o.count}</span>
          </label>`).join('')}
      </div>
    </div>`;

  const btn = root.querySelector('.ms-btn');
  const labelEl = root.querySelector('.ms-label');
  const search = root.querySelector('.ms-search input');

  const sync = () => {
    root.querySelectorAll('.ms-option input').forEach(cb => { cb.checked = set.has(cb.value); });
    root.classList.toggle('has-value', set.size > 0);
    if (set.size === 0) labelEl.textContent = label;
    else if (set.size === 1) labelEl.textContent = options.find(o => o.value === [...set][0])?.label || label;
    else labelEl.textContent = `${label} (${set.size})`;
  };

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = !root.classList.contains('open');
    closeDropdowns();
    root.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', open);
    if (open && search) {
      search.value = '';
      filterOptions('');
      if (window.matchMedia('(min-width: 721px)').matches) search.focus();
    }
  });

  const filterOptions = (q) => {
    const nq = norm(q);
    root.querySelectorAll('.ms-option').forEach(o => { o.hidden = !o.dataset.label.includes(nq); });
  };
  if (search) search.addEventListener('input', () => filterOptions(search.value));

  root.querySelector('.ms-panel').addEventListener('click', (e) => e.stopPropagation());
  root.querySelector('.ms-options').addEventListener('change', (e) => {
    if (e.target.type !== 'checkbox') return;
    if (e.target.checked) set.add(e.target.value); else set.delete(e.target.value);
    sync();
    applyFilters();
  });

  return { sync };
}

function closeDropdowns() {
  document.querySelectorAll('.ms.open').forEach(ms => {
    ms.classList.remove('open');
    ms.querySelector('.ms-btn').setAttribute('aria-expanded', 'false');
  });
}

function syncFilterUI() {
  els.areaChips.querySelectorAll('[data-area]').forEach(b => b.setAttribute('aria-pressed', state.areas.has(b.dataset.area)));
  els.immediate.setAttribute('aria-pressed', state.immediate);
  Object.values(dropdowns).forEach(d => d.sync());
  const active = state.query || state.areas.size || state.levels.size || state.cities.size ||
    state.skills.size || state.modes.size || state.immediate;
  els.clear.hidden = !active;
}

// ========== Filtering & sorting ==========
function applyFilters() {
  const q = norm(state.query.trim());

  filtered = people.filter(p => {
    if (q && !q.split(/\s+/).every(t => p.searchText.includes(t))) return false;
    if (state.areas.size && !p.areas.some(a => state.areas.has(a))) return false;
    if (state.levels.size && !p.levels.some(l => state.levels.has(l))) return false;
    if (state.cities.size && !state.cities.has(p.cidade)) return false;
    if (state.skills.size && ![...state.skills].every(k => p.skillKeys.includes(k))) return false;
    if (state.modes.size && !p.modes.some(m => state.modes.has(m))) return false;
    if (state.immediate && p.avail.days !== 0) return false;
    return true;
  });

  const byName = (a, b) => a.nome.localeCompare(b.nome, 'pt-BR');
  if (state.sort === 'nome') filtered.sort(byName);
  else if (state.sort === 'inicio') filtered.sort((a, b) => a.avail.days - b.avail.days || b.maxRank - a.maxRank || byName(a, b));
  else filtered.sort((a, b) => b.maxRank - a.maxRank || b.completeness - a.completeness || byName(a, b));

  syncFilterUI();
  renderCards();
}

function clearAll() {
  state.query = '';
  els.search.value = '';
  ['areas', 'levels', 'cities', 'skills', 'modes'].forEach(k => state[k].clear());
  state.immediate = false;
  applyFilters();
}

// ========== Render cards ==========
function renderCards() {
  els.count.textContent = filtered.length;
  els.countLabel.textContent = plural(filtered.length, 'perfil', 'perfis');

  if (!filtered.length) {
    els.grid.innerHTML = `
      <div class="no-results">
        <h3>Nenhum perfil encontrado com esses filtros</h3>
        <p>Nem todos os membros da comunidade estão listados aqui. Se você precisa de outro tipo de indicação, fale diretamente com Heitor Sasaki.</p>
        <div class="no-results-actions">
          <button type="button" class="btn btn-outline" data-action="clear">Limpar filtros</button>
          <a class="btn btn-li" href="${LINKEDIN_URL}" target="_blank" rel="noopener">${icon('i-in')}Falar com Heitor no LinkedIn</a>
        </div>
      </div>`;
    return;
  }

  els.grid.innerHTML = filtered.map((p, i) => {
    const selected = shortlist.includes(p.slug);
    const skills = p.habilidades.slice(0, 5);
    const extra = p.habilidades.length - skills.length;
    return `
      <article class="card${selected ? ' is-selected' : ''}" data-slug="${esc(p.slug)}" style="animation-delay:${Math.min(i * 0.025, 0.25)}s">
        <div class="card-top">
          <div class="avatar" aria-hidden="true">${esc(getInitials(p.nome))}</div>
          <div class="card-id">
            <h3><button type="button" class="card-name" data-action="open">${esc(p.nome)}</button></h3>
            <p class="card-role">${esc(p.role || 'Profissional de dados')}${p.levelShort ? `<span class="badge">${esc(p.levelShort)}</span>` : ''}</p>
          </div>
        </div>
        <div class="card-meta">
          ${p.cidade ? `<span>${icon('i-pin')}${esc(p.cidade)}</span>` : ''}
          ${p.modalidade ? `<span>${esc(p.modalidade)}</span>` : ''}
        </div>
        ${p.experiencia ? `<p class="card-summary">${esc(p.experiencia)}</p>` : ''}
        <div class="tags">
          ${skills.map(s => `<span class="tag">${esc(s)}</span>`).join('')}
          ${extra > 0 ? `<span class="tag-more">+${extra}</span>` : ''}
        </div>
        <div class="card-foot">
          <span class="avail">${p.avail.label ? `<span class="dot dot-${p.avail.tone}"></span>${esc(p.avail.label)}` : ''}</span>
          ${selectButton(p, selected)}
        </div>
      </article>`;
  }).join('');
}

function selectButton(p, selected) {
  return `<button type="button" class="select-btn" data-action="toggle" data-slug="${esc(p.slug)}" aria-pressed="${selected}" aria-label="${selected ? 'Tirar' : 'Adicionar'} ${esc(p.nome)} ${selected ? 'da' : 'na'} lista">
    ${icon(selected ? 'i-check' : 'i-plus')}${selected ? 'Na lista' : 'Adicionar à lista'}
  </button>`;
}

// ========== Shortlist ==========
function loadShortlist() {
  try {
    const v = JSON.parse(localStorage.getItem(SHORTLIST_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

function saveShortlist() {
  try { localStorage.setItem(SHORTLIST_KEY, JSON.stringify(shortlist)); } catch { /* private mode */ }
}

function toggleShortlist(slug) {
  const i = shortlist.indexOf(slug);
  if (i >= 0) shortlist.splice(i, 1); else shortlist.push(slug);
  saveShortlist();
  renderShortlist();

  const selected = shortlist.includes(slug);
  document.querySelectorAll(`.card[data-slug="${CSS.escape(slug)}"]`).forEach(card => {
    card.classList.toggle('is-selected', selected);
    const p = people.find(x => x.slug === slug);
    card.querySelector('.select-btn').outerHTML = selectButton(p, selected);
  });
  const modalBtn = els.modalContent.querySelector('[data-action="toggle"]');
  if (modalBtn && modalBtn.dataset.slug === slug) {
    modalBtn.classList.toggle('is-on', selected);
    modalBtn.innerHTML = `${icon(selected ? 'i-check' : 'i-plus')}${selected ? 'Na lista' : 'Adicionar à lista'}`;
  }
}

function renderShortlist() {
  const items = shortlist.map(s => people.find(p => p.slug === s)).filter(Boolean);
  els.bar.hidden = items.length === 0;
  if (!items.length) {
    els.barList.hidden = true;
    els.barToggle.setAttribute('aria-expanded', 'false');
    return;
  }
  els.barCount.textContent = items.length;
  els.barLabel.textContent = plural(items.length, 'perfil na lista', 'perfis na lista');
  els.barList.innerHTML = items.map(p => `
    <li>
      <span>${esc(p.nome)} <span class="sl-role">· ${esc(p.role)}</span></span>
      <button type="button" data-action="toggle" data-slug="${esc(p.slug)}" aria-label="Tirar ${esc(p.nome)} da lista">${icon('i-x')}</button>
    </li>`).join('');
}

// ========== Indication request (LinkedIn) ==========
function profileUrl(p) {
  return `${SITE_URL}#perfil/${p.slug}`;
}

function personLine(p) {
  return `${p.nome}${p.role ? ` (${p.role})` : ''}`;
}

function singleMessage(p) {
  return `Olá, Heitor. Vi o perfil de ${personLine(p)} no banco de talentos da Data Creators e gostaria de solicitar uma indicação.\n${profileUrl(p)}`;
}

function shortlistMessage(items) {
  if (items.length === 1) return singleMessage(items[0]);
  const lines = items.map(p => `• ${personLine(p)}\n${profileUrl(p)}`).join('\n');
  return `Olá, Heitor. Selecionei alguns perfis no banco de talentos da Data Creators e gostaria de solicitar a indicação destes profissionais:\n\n${lines}`;
}

// The <a> opens LinkedIn in a new tab; the copy runs inside the same click
async function copyRequest(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Mensagem copiada. Basta colar no chat do LinkedIn.', 4000);
  } catch {
    toast('Não foi possível copiar a mensagem. Os nomes podem ser enviados no chat do LinkedIn.', 4000);
  }
}

// ========== Modal ==========
function openModal(slug, { push = true } = {}) {
  const p = people.find(x => x.slug === slug);
  if (!p) return;
  lastFocus = document.activeElement;
  const selected = shortlist.includes(p.slug);
  const linkedin = safeUrl(p.linkedin);
  const portfolio = safeUrl(p.portfolio);

  els.modalContent.innerHTML = `
    <div class="m-head">
      <div class="avatar" aria-hidden="true">${esc(getInitials(p.nome))}</div>
      <div>
        <h2 class="m-name" id="modalName">${esc(p.nome)}</h2>
        <p class="m-role">${esc(p.role || 'Profissional de dados')}${p.levelLabel ? `<span class="badge">${esc(p.levelLabel)}</span>` : ''}</p>
      </div>
    </div>
    <div class="m-meta">
      ${p.cidade ? `<span>${icon('i-pin')}${esc(p.cidade)}</span>` : ''}
      ${p.modalidade ? `<span>${esc(p.modalidade)}</span>` : ''}
      ${p.avail.label ? `<span><span class="dot dot-${p.avail.tone}"></span>${esc(p.avail.label)}</span>` : ''}
    </div>

    <div class="m-actions">
      <a class="btn btn-li" href="${LINKEDIN_URL}" target="_blank" rel="noopener" data-action="request" data-slug="${esc(p.slug)}">${icon('i-in')}Solicitar indicação</a>
      <button type="button" class="btn btn-outline${selected ? ' is-on' : ''}" data-action="toggle" data-slug="${esc(p.slug)}">${icon(selected ? 'i-check' : 'i-plus')}${selected ? 'Na lista' : 'Adicionar à lista'}</button>
      ${linkedin ? `<a class="btn btn-outline" href="${esc(linkedin)}" target="_blank" rel="noopener">${icon('i-in')}Perfil no LinkedIn</a>` : ''}
      ${portfolio ? `<a class="btn btn-outline" href="${esc(portfolio)}" target="_blank" rel="noopener">${icon('i-ext')}Portfólio</a>` : ''}
      <button type="button" class="btn btn-outline" data-action="copy" data-slug="${esc(p.slug)}">${icon('i-link')}Copiar link</button>
    </div>

    ${p.experiencia ? `
      <div class="m-section">
        <p class="m-label">Experiência</p>
        <p>${esc(p.experiencia)}</p>
      </div>` : ''}

    ${p.habilidades.length ? `
      <div class="m-section">
        <p class="m-label">Ferramentas</p>
        <div class="tags">${p.habilidades.map(s => `<span class="tag">${esc(s)}</span>`).join('')}</div>
      </div>` : ''}

    <div class="m-section">
      <p class="m-label">Detalhes</p>
      <dl class="m-grid">
        ${p.cargos.length ? `<div><dt>Cargos de interesse</dt><dd>${esc(p.cargos.join(', '))}</dd></div>` : ''}
        ${p.formacao ? `<div><dt>Formação</dt><dd>${esc(p.formacao)}</dd></div>` : ''}
      </dl>
    </div>`;

  els.overlay.hidden = false;
  document.body.classList.add('no-scroll');
  els.modalClose.focus();
  modalPushed = false;
  if (push && location.hash !== `#perfil/${p.slug}`) {
    history.pushState(null, '', `#perfil/${p.slug}`);
    modalPushed = true;
  }
}

function closeModal({ pop = true } = {}) {
  if (els.overlay.hidden) return;
  els.overlay.hidden = true;
  document.body.classList.remove('no-scroll');
  // Opened from a click: go back so the browser back button stays clean.
  // Opened from a shared link: just drop the hash.
  if (pop && location.hash.startsWith('#perfil/')) {
    if (modalPushed) history.back();
    else history.replaceState(null, '', location.pathname + location.search);
  }
  modalPushed = false;
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
}

function openFromHash() {
  const m = location.hash.match(/^#perfil\/(.+)$/);
  if (m) openModal(decodeURIComponent(m[1]), { push: false });
  else closeModal({ pop: false });
}

async function copyProfileLink(slug) {
  const p = people.find(x => x.slug === slug);
  if (!p) return;
  try {
    await navigator.clipboard.writeText(profileUrl(p));
    toast('Link copiado');
  } catch {
    toast(profileUrl(p));
  }
}

let toastTimer;
function toast(msg, ms = 2200) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, ms);
}

// ========== Events ==========
function bindEvents() {
  let debounce;
  els.search.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { state.query = els.search.value; applyFilters(); }, 200);
  });

  els.sort.addEventListener('change', () => { state.sort = els.sort.value; applyFilters(); });

  els.areaChips.addEventListener('click', (e) => {
    const b = e.target.closest('[data-area]');
    if (!b) return;
    const k = b.dataset.area;
    if (state.areas.has(k)) state.areas.delete(k); else state.areas.add(k);
    applyFilters();
  });

  els.immediate.addEventListener('click', () => { state.immediate = !state.immediate; applyFilters(); });
  els.clear.addEventListener('click', clearAll);

  els.grid.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]');
    if (action?.dataset.action === 'toggle') return toggleShortlist(action.dataset.slug);
    if (action?.dataset.action === 'clear') return clearAll();
    const card = e.target.closest('.card');
    if (card) openModal(card.dataset.slug);
  });

  els.modalContent.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]');
    if (!action) return;
    if (action.dataset.action === 'toggle') toggleShortlist(action.dataset.slug);
    if (action.dataset.action === 'copy') copyProfileLink(action.dataset.slug);
    if (action.dataset.action === 'request') {
      const p = people.find(x => x.slug === action.dataset.slug);
      if (p) copyRequest(singleMessage(p));
    }
  });

  els.modalClose.addEventListener('click', () => closeModal());
  els.overlay.addEventListener('click', (e) => { if (e.target === els.overlay) closeModal(); });

  els.barToggle.addEventListener('click', () => {
    const open = els.barList.hidden;
    els.barList.hidden = !open;
    els.barToggle.setAttribute('aria-expanded', open);
  });
  els.barList.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action="toggle"]');
    if (b) toggleShortlist(b.dataset.slug);
  });
  els.barSend.addEventListener('click', () => {
    const items = shortlist.map(s => people.find(p => p.slug === s)).filter(Boolean);
    copyRequest(shortlistMessage(items));
  });
  els.barClear.addEventListener('click', () => {
    const slugs = [...shortlist];
    slugs.forEach(toggleShortlist);
  });

  document.addEventListener('click', closeDropdowns);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!els.overlay.hidden) closeModal();
    else closeDropdowns();
  });
  window.addEventListener('popstate', openFromHash);
}

document.addEventListener('DOMContentLoaded', init);
