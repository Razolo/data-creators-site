// ========================================
// Data Creators - Main Script
// Google Sheets live data + JSON fallback
// ========================================

const SHEETS_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRlL30U3GNC8XDriVPwmUjbLlClozuWISNq7winR0b_sU4G3WyT7LAf_fukQzGMAoNUbIPJ3_HMM9a_/pub?output=csv';

let allData = [];
let filteredData = [];
let selectedSkills = [];

// DOM elements
const searchInput = document.getElementById('searchInput');
const filterMode = document.getElementById('filterMode');
const filterAvail = document.getElementById('filterAvail');
const clearFilters = document.getElementById('clearFilters');
const cardsGrid = document.getElementById('cardsGrid');
const resultsCount = document.getElementById('resultsCount');
const modalOverlay = document.getElementById('modalOverlay');
const modalContent = document.getElementById('modalContent');
const modalClose = document.getElementById('modalClose');

// Multi-select elements
const skillSelectBtn = document.getElementById('skillSelectBtn');
const skillDropdown = document.getElementById('skillDropdown');
const skillOptions = document.getElementById('skillOptions');
const skillSearchInput = document.getElementById('skillSearchInput');
const selectedSkillsTags = document.getElementById('selectedSkillsTags');

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
  // Last row
  if (current || row.length > 0) {
    row.push(current.trim());
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }

  return rows;
}

// ========== Parse habilidades string ==========
function parseHabilidades(raw) {
  if (!raw) return [];
  // Split by "/" but not inside parentheses
  // "Excel/Python(Pandas, Matplotlib)/SQL" → ["Excel", "Python", "Pandas", "Matplotlib", "SQL"]
  const skills = [];
  const parts = raw.split('/');

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // Check for parenthetical sub-skills: "Python(Pandas, Matplotlib, Seaborn)"
    const parenMatch = trimmed.match(/^([^(]+)\(([^)]+)\)$/);
    if (parenMatch) {
      const main = parenMatch[1].trim();
      if (main) skills.push(main);
      const subs = parenMatch[2].split(',').map(s => s.trim()).filter(Boolean);
      skills.push(...subs);
    } else {
      skills.push(trimmed);
    }
  }

  return skills.filter(s => s.length > 0);
}

// ========== CSV row → person object ==========
function csvRowToPerson(row) {
  // Columns: Nome, E-mail, Linkedin, Cidade/Estado, Modalidade, Formação, Habilidades, Experiência, Cargos, Portfólio, Disponibilidade
  const nome = (row[0] || '').trim();
  if (!nome) return null;

  const linkedin = (row[2] || '').trim();
  const cidade = (row[3] || '').trim();
  const modalidade = (row[4] || '').trim();
  const formacao = (row[5] || '').trim();
  const habilidades = parseHabilidades(row[6] || '');
  const experiencia = (row[7] || '').trim();
  const cargos = (row[8] || '').split('/').map(s => s.trim()).filter(Boolean);
  const portfolio = (row[9] || '').trim();
  const disponibilidade = (row[10] || '').trim();

  // Ensure linkedin is a full URL
  let linkedinUrl = linkedin;
  if (linkedin && !linkedin.startsWith('http')) {
    linkedinUrl = 'https://' + linkedin;
  }

  // Ensure portfolio is a full URL
  let portfolioUrl = portfolio;
  if (portfolio && !portfolio.startsWith('http')) {
    portfolioUrl = 'https://' + portfolio;
  }

  return {
    nome,
    linkedin: linkedinUrl,
    cidade,
    modalidade,
    formacao,
    habilidades,
    experiencia,
    cargos,
    portfolio: portfolioUrl,
    disponibilidade
  };
}

// ========== Fetch data ==========
async function fetchData() {
  // Try Google Sheets first
  try {
    const res = await fetch(SHEETS_CSV_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const rows = parseCSV(text);

    if (rows.length < 2) throw new Error('No data rows');

    // Skip header row (index 0), parse the rest
    const people = rows.slice(1)
      .map(csvRowToPerson)
      .filter(p => p !== null && p.nome);

    if (people.length > 0) {
      console.log(`Loaded ${people.length} profiles from Google Sheets`);
      return people;
    }
    throw new Error('No valid records parsed');
  } catch (err) {
    console.warn('Google Sheets fetch failed, falling back to data.json:', err.message);
  }

  // Fallback to static JSON
  const res = await fetch('./data.json');
  const data = await res.json();
  console.log(`Loaded ${data.length} profiles from data.json (fallback)`);
  return data;
}

// ========== Init ==========
async function init() {
  try {
    allData = await fetchData();
    filteredData = [...allData];

    populateSkillFilter();
    renderCards();
    bindEvents();
  } catch (err) {
    console.error('Error loading data:', err);
    cardsGrid.innerHTML = '<div class="no-results"><h3>Erro ao carregar dados</h3><p>Tente recarregar a página.</p></div>';
  }
}

// ========== Populate skill filter (multi-select) ==========
function populateSkillFilter() {
  const skillCount = {};
  allData.forEach(person => {
    person.habilidades.forEach(skill => {
      const s = skill.trim();
      if (s) skillCount[s] = (skillCount[s] || 0) + 1;
    });
  });

  const sorted = Object.entries(skillCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30);

  skillOptions.innerHTML = sorted.map(([skill, count]) => `
    <label class="multi-select-option" data-skill="${skill}">
      <input type="checkbox" value="${skill}">
      <span>${skill}</span>
      <span style="margin-left:auto;color:var(--gray-400);font-size:0.7rem">${count}</span>
    </label>
  `).join('');
}

// ========== Skill Multi-Select Logic ==========
function toggleSkillDropdown() {
  const isOpen = skillDropdown.classList.contains('open');
  if (isOpen) {
    skillDropdown.classList.remove('open');
    skillSelectBtn.classList.remove('active');
  } else {
    skillDropdown.classList.add('open');
    skillSelectBtn.classList.add('active');
    skillSearchInput.value = '';
    filterSkillOptions('');
    skillSearchInput.focus();
  }
}

function filterSkillOptions(query) {
  const q = query.toLowerCase();
  skillOptions.querySelectorAll('.multi-select-option').forEach(opt => {
    const skill = opt.dataset.skill.toLowerCase();
    opt.style.display = skill.includes(q) ? 'flex' : 'none';
  });
}

function toggleSkill(skill) {
  const idx = selectedSkills.indexOf(skill);
  if (idx >= 0) {
    selectedSkills.splice(idx, 1);
  } else {
    selectedSkills.push(skill);
  }
  updateSkillUI();
  applyFilters();
}

function removeSkill(skill) {
  const idx = selectedSkills.indexOf(skill);
  if (idx >= 0) {
    selectedSkills.splice(idx, 1);
    updateSkillUI();
    applyFilters();
  }
}

function updateSkillUI() {
  if (selectedSkills.length === 0) {
    skillSelectBtn.querySelector('.multi-select-label').textContent = 'Habilidades';
    skillSelectBtn.classList.remove('has-selection');
  } else {
    skillSelectBtn.querySelector('.multi-select-label').textContent = `${selectedSkills.length} selecionada${selectedSkills.length > 1 ? 's' : ''}`;
    skillSelectBtn.classList.add('has-selection');
  }

  skillOptions.querySelectorAll('.multi-select-option').forEach(opt => {
    const cb = opt.querySelector('input[type="checkbox"]');
    const isChecked = selectedSkills.includes(cb.value);
    cb.checked = isChecked;
    opt.classList.toggle('checked', isChecked);
  });

  selectedSkillsTags.innerHTML = selectedSkills.map(skill => `
    <span class="skill-filter-tag" data-skill="${skill}">
      ${skill}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
    </span>
  `).join('');
}

// ========== Render cards ==========
function renderCards() {
  if (filteredData.length === 0) {
    cardsGrid.innerHTML = `
      <div class="no-results">
        <h3>Nenhum talento encontrado</h3>
        <p>Tente ajustar os filtros ou entre em contato para indicações personalizadas.</p>
      </div>
    `;
    resultsCount.textContent = '0';
    return;
  }

  resultsCount.textContent = filteredData.length;

  cardsGrid.innerHTML = filteredData.map((person, i) => {
    const initials = getInitials(person.nome);
    const skills = person.habilidades.slice(0, 5);
    const extra = person.habilidades.length - 5;
    const roles = person.cargos.join(' / ');
    const availClass = getAvailClass(person.disponibilidade);
    const availLabel = getAvailLabel(person.disponibilidade);

    return `
      <div class="card" data-index="${i}" style="animation-delay: ${Math.min(i * 0.02, 0.2)}s">
        <div class="card-header">
          <div class="card-avatar">${initials}</div>
          ${availLabel ? `<span class="card-availability ${availClass}">${availLabel}</span>` : ''}
        </div>
        <div class="card-name">${person.nome}</div>
        <div class="card-meta">
          ${person.cidade ? `
            <span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
              ${person.cidade}
            </span>
          ` : ''}
          <span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
            ${person.modalidade}
          </span>
        </div>
        <div class="card-roles">${roles}</div>
        <div class="card-skills">
          ${skills.map(s => `<span class="skill-tag">${s}</span>`).join('')}
          ${extra > 0 ? `<span class="skill-more">+${extra}</span>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// ========== Helpers ==========
function getInitials(name) {
  const parts = name.trim().split(' ');
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getAvailClass(avail) {
  if (!avail) return '';
  const a = avail.toLowerCase();
  if (a.includes('imediata') || a.includes('imediato')) return 'avail-immediate';
  if (a.includes('semana')) return 'avail-soon';
  return 'avail-negotiable';
}

function getAvailLabel(avail) {
  if (!avail) return '';
  const a = avail.toLowerCase();
  if (a.includes('imediata') || a.includes('imediato')) return 'Imediata';
  if (a.includes('1 semana')) return '1 semana';
  if (a.includes('2 semana')) return '2 semanas';
  if (a.includes('3 semana')) return '3 semanas';
  if (a.includes('mediante') || a.includes('negoci')) return 'A negociar';
  if (a.includes('15 dias') || a.includes('aviso')) return '15 dias';
  return avail;
}

// ========== Filter logic ==========
function applyFilters() {
  const query = searchInput.value.toLowerCase().trim();
  const mode = filterMode.value;
  const avail = filterAvail.value;

  filteredData = allData.filter(person => {
    if (query) {
      const searchable = [
        person.nome,
        person.cidade,
        person.formacao,
        person.experiencia,
        ...person.habilidades,
        ...person.cargos
      ].join(' ').toLowerCase();
      if (!searchable.includes(query)) return false;
    }

    if (selectedSkills.length > 0) {
      const personSkills = person.habilidades.map(s => s.toLowerCase());
      const hasAll = selectedSkills.every(skill =>
        personSkills.some(ps => ps.includes(skill.toLowerCase()))
      );
      if (!hasAll) return false;
    }

    if (mode) {
      if (!person.modalidade.toLowerCase().includes(mode.toLowerCase())) return false;
    }

    if (avail) {
      const a = (person.disponibilidade || '').toLowerCase();
      if (avail === 'Imediata') {
        if (!a.includes('imediata') && !a.includes('imediato')) return false;
      } else if (avail === '1 semana') {
        if (!a.includes('1 semana')) return false;
      } else if (avail === 'Mediante') {
        if (!a.includes('mediante') && !a.includes('negoci')) return false;
      }
    }

    return true;
  });

  renderCards();
}

// ========== Modal ==========
function openModal(index) {
  const person = filteredData[index];
  if (!person) return;

  const initials = getInitials(person.nome);
  const roles = person.cargos.join(' / ');

  modalContent.innerHTML = `
    <div class="modal-avatar">${initials}</div>
    <div class="modal-name">${person.nome}</div>
    <div class="modal-roles">${roles}</div>

    <div class="modal-meta-grid">
      ${person.cidade ? `
        <div class="modal-meta-item">
          <span class="modal-meta-label">Localização</span>
          <span class="modal-meta-value">${person.cidade}</span>
        </div>
      ` : ''}
      <div class="modal-meta-item">
        <span class="modal-meta-label">Modalidade</span>
        <span class="modal-meta-value">${person.modalidade}</span>
      </div>
      <div class="modal-meta-item">
        <span class="modal-meta-label">Formação</span>
        <span class="modal-meta-value">${person.formacao}</span>
      </div>
      <div class="modal-meta-item">
        <span class="modal-meta-label">Disponibilidade</span>
        <span class="modal-meta-value">${person.disponibilidade || 'Consultar'}</span>
      </div>
    </div>

    ${person.experiencia ? `
      <div class="modal-section">
        <div class="modal-section-title">Experiência</div>
        <p>${person.experiencia}</p>
      </div>
    ` : ''}

    <div class="modal-section">
      <div class="modal-section-title">Habilidades Técnicas</div>
      <div class="modal-skills">
        ${person.habilidades.map(s => `<span class="modal-skill-tag">${s}</span>`).join('')}
      </div>
    </div>

    <div class="modal-actions">
      ${person.linkedin && person.linkedin.includes('linkedin.com') ? `
        <a href="${person.linkedin}" target="_blank" rel="noopener" class="modal-btn modal-btn-primary">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
          </svg>
          Ver LinkedIn
        </a>
      ` : ''}
      ${person.portfolio ? `
        <a href="${person.portfolio}" target="_blank" rel="noopener" class="modal-btn modal-btn-secondary">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" x2="21" y1="14" y2="3"/>
          </svg>
          Portfólio
        </a>
      ` : ''}
      <a href="https://www.linkedin.com/in/heitorsasaki/" target="_blank" rel="noopener" class="modal-btn modal-btn-secondary">
        Solicitar indicação
      </a>
    </div>
  `;

  modalOverlay.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  modalOverlay.classList.remove('active');
  document.body.style.overflow = '';
}

// ========== Event Bindings ==========
function bindEvents() {
  let debounceTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(applyFilters, 250);
  });

  skillSelectBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSkillDropdown();
  });

  skillSearchInput.addEventListener('input', (e) => {
    filterSkillOptions(e.target.value);
  });

  skillSearchInput.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  skillOptions.addEventListener('change', (e) => {
    if (e.target.type === 'checkbox') {
      toggleSkill(e.target.value);
    }
  });

  selectedSkillsTags.addEventListener('click', (e) => {
    const tag = e.target.closest('.skill-filter-tag');
    if (tag) {
      removeSkill(tag.dataset.skill);
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.multi-select')) {
      skillDropdown.classList.remove('open');
      skillSelectBtn.classList.remove('active');
    }
  });

  filterMode.addEventListener('change', applyFilters);
  filterAvail.addEventListener('change', applyFilters);

  clearFilters.addEventListener('click', () => {
    searchInput.value = '';
    filterMode.value = '';
    filterAvail.value = '';
    selectedSkills = [];
    updateSkillUI();
    applyFilters();
  });

  cardsGrid.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (card) {
      const index = parseInt(card.dataset.index);
      openModal(index);
    }
  });

  modalClose.addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
}

// ========== Start ==========
document.addEventListener('DOMContentLoaded', init);
