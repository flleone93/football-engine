// Enterprise Football Engine — interfaccia (server, file offline, Artifact e app iPhone). Creata da Leone Francesco.
const state = {
  meta: null,
  fixtures: [],
  selected: null,
  analysis: null,
  topPicks: null,
  performance: null,
  performanceLoaded: false,
  loadingTimer: null,
  analysisRequestSerial: 0,
  listScroll: 0,
  quick: new Map(),
  quickPending: new Set(),
  listFilter: 'all',
  journal: null
};

const elements = Object.fromEntries([
  'modeBadge', 'aiModeBadge', 'lastUpdate', 'refreshButton', 'fixtureCount', 'leagueCount', 'providerName',
  'bookmakerName', 'demoNotice', 'snapshotNotice', 'filteredCount', 'searchInput', 'leagueFilter', 'dateFilter',
  'fixturesLoading', 'fixturesError', 'fixtureList', 'emptyState', 'selectionState', 'selectedLeague',
  'selectedTitle', 'selectedMeta', 'neutralToggle', 'analyzeButton', 'quickAnalyzeButton', 'preflightSource', 'backToList',
  'analysisLoading', 'loadingStep', 'loadingProgress', 'analysisProgress', 'analysisError', 'analysisResult',
  'topPicksDate', 'topPicksStake', 'topPicksButton', 'topPicksLoading', 'topPicksError', 'topPicksResult', 'topPicksForm',
  'appStatus', 'analysisTab', 'topPicksTab', 'analysisView', 'topPicksView',
  'performanceTab', 'performanceView', 'performanceRefresh', 'performanceExport', 'performanceLoading',
  'performanceError', 'performanceResult',
  'settingsTab', 'settingsView', 'settingsForm', 'settingsProvider', 'settingsKey', 'settingsKeyState', 'settingsMode',
  'settingsClearKey', 'settingsDays', 'settingsLeagues', 'settingsAutoTrack', 'settingsTrackNow', 'settingsStatus', 'appVersion', 'sortSelect', 'settingsTheme', 'onboarding',
  'journalLimitNotice', 'journalResult'
].map((id) => [id, document.getElementById(id)]));

const percent = (value, digits = 1) => `${(Number(value || 0) * 100).toFixed(digits).replace('.', ',')}%`;
const decimal = (value, digits = 2) => Number(value || 0).toFixed(digits).replace('.', ',');
const signedPercent = (value, digits = 1) => `${value >= 0 ? '+' : ''}${percent(value, digits)}`;
const currency = (value) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(Number(value || 0));
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
const timeZone = () => state.meta?.timezone || 'Europe/Rome';
const formatDateTime = (value, options = {}) => new Intl.DateTimeFormat('it-IT', {
  dateStyle: options.dateStyle || 'medium', timeStyle: options.timeStyle || 'short', timeZone: timeZone()
}).format(new Date(value));
const formatTime = (value) => new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: timeZone() }).format(new Date(value));
const dateKey = (value) => new Intl.DateTimeFormat('sv-SE', { timeZone: timeZone() }).format(new Date(value));
const dateLabel = (value) => new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: timeZone() }).format(new Date(value));
const shortDateLabel = (value) => new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric', month: 'short', timeZone: timeZone() }).format(new Date(value));
const isPhone = () => window.matchMedia('(max-width: 899px)').matches;
const aiActive = () => ['active', 'shadow'].includes(state.meta?.ai?.effectiveMode);
const chevron = '<svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>';

function relativeDay(key) {
  const today = dateKey(new Date());
  const tomorrow = dateKey(new Date(Date.now() + 86400000));
  if (key === today) return 'Oggi';
  if (key === tomorrow) return 'Domani';
  return null;
}

// Preferiti salvati nel browser; con archiviazione bloccata restano solo per la sessione.
const favorites = (() => {
  const KEY = 'football-engine-favorites-v1';
  let data = { team: [], league: [] };
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) || '{}');
    // Valori malformati (archiviazione corrotta o formato futuro) vengono scartati invece di bloccare l'elenco.
    const clean = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string' || typeof item === 'number').map(String) : []);
    data = { team: clean(stored?.team), league: clean(stored?.league) };
  } catch { /* sessione senza archiviazione */ }
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* ignorato */ } };
  return {
    has: (type, id) => data[type].includes(String(id)),
    toggle(type, id) {
      const key = String(id);
      data[type] = data[type].includes(key) ? data[type].filter((item) => item !== key) : [...data[type], key];
      persist();
      return data[type].includes(key);
    },
    fixtureIsFavorite: (fixture) => data.team.includes(String(fixture.home.id)) || data.team.includes(String(fixture.away.id)) || data.league.includes(String(fixture.league.id))
  };
})();

async function request(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout || 45000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Errore HTTP ${response.status}`);
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Tempo di attesa superato. Riprova tra poco.');
    if (error instanceof TypeError) throw new Error('Connessione non disponibile. Controlla la rete e riprova.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const postJson = (url, body, options = {}) => request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), ...options });

// ---------- Avvio e calendario ----------

async function loadMeta() {
  state.meta = await request('/api/meta');
  const snapshot = state.meta.snapshot;
  elements.modeBadge.textContent = state.meta.mode === 'demo' ? 'Demo' : snapshot ? 'Live · snapshot' : 'Live';
  elements.modeBadge.className = `status-dot ${state.meta.mode === 'demo' ? 'demo' : 'live'}`;
  const aiMode = state.meta.ai?.effectiveMode || 'off';
  const aiProvider = { anthropic: 'Claude', gemini: 'Gemini', openai: 'OpenAI', claude: 'Claude' }[state.meta.ai?.provider] || 'AI';
  elements.aiModeBadge.textContent = aiMode === 'active' ? `AI ${aiProvider}` : aiMode === 'shadow' ? `AI ${aiProvider} · oss.` : 'AI off';
  elements.aiModeBadge.className = `status-pill ${aiMode === 'active' ? 'active' : aiMode === 'shadow' ? 'demo' : 'neutral'}`;
  elements.providerName.textContent = state.meta.provider;
  elements.bookmakerName.textContent = state.meta.bookmaker;
  elements.preflightSource.textContent = state.meta.provider;
  if (elements.appVersion) elements.appVersion.textContent = `v${state.meta.version}`;
  elements.demoNotice.classList.toggle('hidden', state.meta.mode !== 'demo');
  elements.snapshotNotice.classList.toggle('hidden', !snapshot);
  if (snapshot) {
    const aiNote = state.meta.ai?.provider === 'claude'
      ? (aiMode === 'active' ? ' Gli agenti AI sono eseguiti da Claude: al primo uso chiede il consenso e un’analisi completa richiede uno o due minuti.' : ' Qui gli agenti AI non sono disponibili: vale il motore statistico.')
      : '';
    elements.snapshotNotice.innerHTML = `<strong>Dati reali ${escapeHtml(snapshot.source)} del ${escapeHtml(formatDateTime(snapshot.generatedAt))}.</strong> ${snapshot.fixtures} partite in ${snapshot.competitions} competizioni. Quote e notizie successive non sono incluse.${escapeHtml(aiNote)}`;
  }
}

async function loadFixtures(force = false) {
  elements.fixturesLoading.classList.remove('hidden');
  elements.fixturesError.classList.add('hidden');
  elements.refreshButton.disabled = true;
  elements.appStatus.textContent = 'Aggiornamento calendario in corso.';
  try {
    const query = new URLSearchParams({ days: state.meta?.daysAhead || 7 });
    if (force) query.set('refresh', '1');
    const payload = await request(`/api/fixtures?${query}`, { timeout: 90000 });
    state.fixtures = payload.fixtures || [];
    elements.lastUpdate.textContent = `agg. ${formatTime(payload.updatedAt)}`;
    populateFilters();
    populateTopPicksDates();
    renderFixtures();
    elements.fixtureCount.textContent = state.fixtures.length;
    elements.leagueCount.textContent = new Set(state.fixtures.map((fixture) => fixture.league.id)).size;
    elements.appStatus.textContent = `Calendario aggiornato: ${state.fixtures.length} partite.`;
  } catch (error) {
    elements.fixturesError.innerHTML = `<strong>Calendario non disponibile.</strong><p>${escapeHtml(error.message)}</p><button class="secondary-button" type="button" data-retry-fixtures>Riprova</button>`;
    elements.fixturesError.classList.remove('hidden');
    elements.fixturesError.querySelector('[data-retry-fixtures]')?.addEventListener('click', () => loadFixtures(true));
  } finally {
    elements.fixturesLoading.classList.add('hidden');
    elements.refreshButton.disabled = false;
  }
}

function populateFilters() {
  const selectedLeague = elements.leagueFilter.value;
  const selectedDate = elements.dateFilter.value;
  const leagues = [...new Map(state.fixtures.map((fixture) => [String(fixture.league.id), fixture.league.name])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1], 'it'));
  const dates = [...new Set(state.fixtures.map((fixture) => dateKey(fixture.kickoff)))].sort();
  elements.leagueFilter.innerHTML = '<option value="">Competizioni</option>' + leagues.map(([id, name]) => `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`).join('');
  elements.dateFilter.innerHTML = '<option value="">Tutti i giorni</option>' + dates.map((date) => `<option value="${date}">${escapeHtml(relativeDay(date) || shortDateLabel(`${date}T12:00:00Z`))}</option>`).join('');
  elements.leagueFilter.value = leagues.some(([id]) => id === selectedLeague) ? selectedLeague : '';
  elements.dateFilter.value = dates.includes(selectedDate) ? selectedDate : '';
}

function populateTopPicksDates() {
  const current = elements.topPicksDate.value;
  const grouped = new Map();
  for (const fixture of state.fixtures) {
    const date = dateKey(fixture.kickoff);
    grouped.set(date, (grouped.get(date) || 0) + 1);
  }
  const dates = [...grouped.keys()].sort();
  elements.topPicksDate.innerHTML = dates.map((date) => `<option value="${date}">${escapeHtml(relativeDay(date) ? `${relativeDay(date)} · ${shortDateLabel(`${date}T12:00:00Z`)}` : dateLabel(`${date}T12:00:00Z`))} · ${grouped.get(date)} partite</option>`).join('');
  if (dates.includes(current)) elements.topPicksDate.value = current;
  else elements.topPicksDate.value = dates.find((date) => grouped.get(date) >= 5) || dates[0] || '';
}

function filteredFixtures() {
  const query = elements.searchInput.value.trim().toLocaleLowerCase('it');
  const league = elements.leagueFilter.value;
  const date = elements.dateFilter.value;
  const list = state.fixtures.filter((fixture) => {
    const haystack = `${fixture.home.name} ${fixture.away.name} ${fixture.league.name} ${fixture.league.country}`.toLocaleLowerCase('it');
    return (!query || haystack.includes(query))
      && (!league || String(fixture.league.id) === league)
      && (!date || dateKey(fixture.kickoff) === date)
      && (state.listFilter !== 'favorites' || favorites.fixtureIsFavorite(fixture))
      && (state.listFilter !== 'value' || state.quick.get(String(fixture.id))?.recommendation?.hasValue);
  });
  const sort = elements.sortSelect?.value || 'time';
  const quick = (fixture) => state.quick.get(String(fixture.id));
  const byTime = (a, b) => a.kickoff.localeCompare(b.kickoff);
  if (sort === 'value') return list.sort((a, b) => (quick(b)?.recommendation?.edge ?? -9) - (quick(a)?.recommendation?.edge ?? -9) || byTime(a, b));
  if (sort === 'probability') return list.sort((a, b) => (quick(b)?.recommendation?.probability ?? -1) - (quick(a)?.recommendation?.probability ?? -1) || byTime(a, b));
  // Per orario: i giorni restano in ordine; dentro ogni giorno le partite preferite vengono prima.
  return list.sort((a, b) => dateKey(a.kickoff).localeCompare(dateKey(b.kickoff)) || Number(favorites.fixtureIsFavorite(b)) - Number(favorites.fixtureIsFavorite(a)) || byTime(a, b));
}

function quickMarkup(fixtureId) {
  const quick = state.quick.get(String(fixtureId));
  if (!quick) return state.quickPending.has(String(fixtureId)) ? '<span class="skeleton-line"></span>' : '';
  if (quick.error) return '';
  const { home, draw, away } = quick.outcomes;
  return `<span class="mini-bar" aria-hidden="true"><span class="home" data-width="${home * 100}"></span><span class="draw" data-width="${draw * 100}"></span><span class="away" data-width="${away * 100}"></span></span>
    <span class="quick-label">${escapeHtml(quick.recommendation.label)} ${percent(quick.recommendation.probability, 0)}</span>
    ${quick.recommendation.hasValue ? '<span class="value-badge">Valore</span>' : ''}`;
}

function renderFixtures() {
  const fixtures = filteredFixtures();
  elements.filteredCount.textContent = fixtures.length;
  if (!fixtures.length) {
    const message = state.listFilter === 'favorites' ? 'Nessuna partita delle squadre o competizioni preferite. Tocca ☆ accanto a una partita per aggiungerla.'
      : state.listFilter === 'value' ? 'Nessuna partita con valore tra quelle già analizzate.'
        : state.fixtures.length ? 'Nessuna partita corrisponde alla ricerca.' : 'Nessuna partita in calendario nei prossimi giorni.';
    elements.fixtureList.innerHTML = `<div class="loading-card"><p>${escapeHtml(message)}</p></div>`;
    return;
  }
  let previousDate = '';
  const sortedByTime = (elements.sortSelect?.value || 'time') === 'time';
  elements.fixtureList.innerHTML = fixtures.map((fixture) => {
    const date = dateKey(fixture.kickoff);
    const label = relativeDay(date) ? `${relativeDay(date)} · ${shortDateLabel(fixture.kickoff)}` : dateLabel(fixture.kickoff);
    const divider = sortedByTime && date !== previousDate ? `<div class="date-divider">${escapeHtml(label)}</div>` : '';
    previousDate = date;
    const active = String(state.selected?.id) === String(fixture.id);
    const starred = favorites.fixtureIsFavorite(fixture);
    return `${divider}<div class="fixture-row">
      <button class="fixture-card ${active ? 'active' : ''}" type="button" aria-pressed="${active}" data-fixture-id="${escapeHtml(fixture.id)}">
        <span class="fixture-time">${formatTime(fixture.kickoff)}</span>
        <span class="fixture-main">
          <span class="fixture-teams"><strong>${escapeHtml(fixture.home.name)}</strong><strong>${escapeHtml(fixture.away.name)}</strong></span>
          <span class="fixture-league">${escapeHtml(fixture.league.name)}${fixture.league.round ? ` · ${escapeHtml(fixture.league.round)}` : ''}${sortedByTime ? '' : ` · ${escapeHtml(shortDateLabel(fixture.kickoff))}`}</span>
          <span class="fixture-quick">${quickMarkup(fixture.id)}</span>
        </span>
        ${chevron}
      </button>
      <button class="star-button" type="button" data-star-fixture="${escapeHtml(fixture.id)}" data-star-league="${escapeHtml(fixture.league.id)}" data-star-home="${escapeHtml(fixture.home.id)}" aria-pressed="${starred}" aria-label="${starred ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'} ${escapeHtml(fixture.home.name)}">${starred ? '★' : '☆'}</button>
    </div>`;
  }).join('');
  elements.fixtureList.querySelectorAll('[data-width]').forEach((node) => { node.style.width = `${Number(node.dataset.width)}%`; });
  elements.fixtureList.querySelectorAll('[data-fixture-id]').forEach((button) => button.addEventListener('click', () => selectFixture(button.dataset.fixtureId)));
  elements.fixtureList.querySelectorAll('[data-star-home]').forEach((button) => button.addEventListener('click', () => {
    const fixture = state.fixtures.find((item) => String(item.id) === button.dataset.starFixture);
    if (!fixture) return;
    if (favorites.fixtureIsFavorite(fixture)) {
      // Stella piena: si spegne davvero, togliendo ogni preferito che la accende.
      for (const teamId of [fixture.home.id, fixture.away.id]) if (favorites.has('team', teamId)) favorites.toggle('team', teamId);
      if (favorites.has('league', fixture.league.id)) favorites.toggle('league', fixture.league.id);
    } else {
      favorites.toggle('team', fixture.home.id);
    }
    renderFixtures();
  }));
  observeVisibleFixtures();
}

// Previsioni rapide solo per le schede che entrano nello schermo (niente analisi in blocco dal telefono).
const visibleFixtureIds = new Set();
let fixtureObserver = null;
function observeVisibleFixtures() {
  const cards = [...elements.fixtureList.querySelectorAll('[data-fixture-id]')];
  // Le prime 12 in ordine di visualizzazione subito (anche se l'osservatore è sospeso); il resto solo scorrendo.
  const firstIds = cards.slice(0, 12).map((card) => card.dataset.fixtureId);
  if (typeof IntersectionObserver !== 'function') {
    requestQuickPredictions(firstIds);
    return;
  }
  firstIds.forEach((id) => visibleFixtureIds.add(id));
  fixtureObserver?.disconnect();
  fixtureObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) visibleFixtureIds.add(entry.target.dataset.fixtureId);
      else visibleFixtureIds.delete(entry.target.dataset.fixtureId);
    }
    requestQuickPredictions([...visibleFixtureIds]);
  }, { rootMargin: '200px 0px' });
  cards.forEach((card) => fixtureObserver.observe(card));
  requestQuickPredictions([...visibleFixtureIds]);
}

let quickTimer = null;
function requestQuickPredictions(fixtureIds) {
  clearTimeout(quickTimer);
  quickTimer = setTimeout(async () => {
    const missing = fixtureIds.map(String).filter((id) => !state.quick.has(id) && !state.quickPending.has(id)).slice(0, 24);
    if (!missing.length) return;
    missing.forEach((id) => state.quickPending.add(id));
    const batches = [];
    for (let index = 0; index < missing.length; index += 12) batches.push(missing.slice(index, index + 12));
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(2, batches.length) }, async () => {
      while (cursor < batches.length) {
        const batch = batches[cursor];
        cursor += 1;
        try {
          const payload = await request('/api/quick-predictions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fixtureIds: batch }), timeout: 90000 });
          for (const item of payload.predictions || []) state.quick.set(String(item.fixtureId), item);
        } catch {
          batch.forEach((id) => state.quick.set(id, { fixtureId: id, error: 'Previsione non disponibile.' }));
        } finally {
          batch.forEach((id) => state.quickPending.delete(id));
        }
      }
    }));
    renderFixtures();
  }, 250);
}

// ---------- Elenco → dettaglio (iPhone) ----------

function showDetail() {
  if (!document.body.classList.contains('show-detail')) state.listScroll = window.scrollY;
  document.body.classList.add('show-detail');
  if (isPhone()) window.scrollTo(0, 0);
}

function showList() {
  document.body.classList.remove('show-detail');
  if (isPhone()) requestAnimationFrame(() => window.scrollTo(0, state.listScroll));
}

function detectNeutral(fixture) {
  return /world cup|mondiale|european championship|europei|copa am[eé]rica|club world cup/i.test(fixture.league.name)
    && /final|semi|quarter|round|ottavi|quarti/i.test(fixture.league.round || '');
}

function selectFixture(id, { autoAnalyze = !aiActive() } = {}) {
  state.analysisRequestSerial += 1;
  stopLoading();
  state.selected = state.fixtures.find((fixture) => String(fixture.id) === String(id));
  if (!state.selected) return;
  state.analysis = null;
  renderFixtures();
  elements.emptyState.classList.add('hidden');
  elements.analysisResult.classList.add('hidden');
  elements.analysisError.classList.add('hidden');
  elements.selectedLeague.textContent = `${state.selected.league.name}${state.selected.league.round ? ` · ${state.selected.league.round}` : ''}`;
  elements.selectedTitle.textContent = `${state.selected.home.name} — ${state.selected.away.name}`;
  elements.selectedMeta.textContent = `${formatDateTime(state.selected.kickoff, { dateStyle: 'full' })} · ${state.selected.venue}`;
  elements.neutralToggle.checked = detectNeutral(state.selected);
  elements.analyzeButton.disabled = false;
  elements.quickAnalyzeButton.disabled = false;
  showDetail();
  if (autoAnalyze) {
    elements.selectionState.classList.add('hidden');
    analyzeSelected({ useAi: false });
  } else {
    elements.selectionState.classList.remove('hidden');
  }
}

const loadingSteps = [
  'Acquisizione e qualità dei dati…', 'Forma, classifica e scontri diretti…',
  'Modello Poisson / Dixon-Coles…', 'Simulazione Monte Carlo…', 'Confronto con le quote…',
  'Ensemble e calibrazione…', 'Agenti AI: disponibilità, tattica, news, competizione…',
  'Challenge & Bias Detection…', 'Spiegazione finale e audit…'
];

function startLoading(useAi) {
  let index = 0;
  elements.selectionState.classList.add('hidden');
  elements.analysisResult.classList.add('hidden');
  elements.analysisError.classList.add('hidden');
  elements.analysisLoading.classList.remove('hidden');
  elements.appStatus.textContent = 'Analisi in corso.';
  elements.loadingStep.textContent = loadingSteps[0];
  elements.loadingProgress.style.width = '8%';
  elements.analysisProgress.setAttribute('aria-valuenow', '8');
  elements.analyzeButton.disabled = true;
  elements.quickAnalyzeButton.disabled = true;
  const steps = useAi ? loadingSteps : loadingSteps.slice(0, 6);
  clearInterval(state.loadingTimer);
  state.loadingTimer = setInterval(() => {
    index = Math.min(index + 1, steps.length - 1);
    elements.loadingStep.textContent = steps[index];
    const progress = Math.round(10 + (index + 1) / steps.length * 86);
    elements.loadingProgress.style.width = `${progress}%`;
    elements.analysisProgress.setAttribute('aria-valuenow', String(progress));
  }, useAi ? 6000 : 260);
}

function stopLoading() {
  clearInterval(state.loadingTimer);
  elements.analysisLoading.classList.add('hidden');
  elements.analyzeButton.disabled = !state.selected;
  elements.quickAnalyzeButton.disabled = !state.selected;
}

async function analyzeSelected({ useAi = true } = {}) {
  if (!state.selected) return;
  const requestSerial = ++state.analysisRequestSerial;
  const fixtureId = state.selected.id;
  const withAi = useAi && aiActive();
  startLoading(withAi);
  try {
    const analysis = await request('/api/analyze', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fixtureId, neutral: elements.neutralToggle.checked, useAi: withAi }),
      timeout: 300000
    });
    if (requestSerial !== state.analysisRequestSerial || String(state.selected?.id) !== String(fixtureId)) return;
    state.analysis = analysis;
    renderAnalysis(analysis);
    elements.analysisResult.classList.remove('hidden');
    elements.appStatus.textContent = 'Analisi completata.';
  } catch (error) {
    if (requestSerial !== state.analysisRequestSerial) return;
    elements.analysisError.innerHTML = `<strong>Analisi non completata.</strong><p>${escapeHtml(error.message)}</p><button id="retryAnalysis" class="primary-button" type="button">Riprova</button>`;
    elements.analysisError.classList.remove('hidden');
    document.getElementById('retryAnalysis')?.addEventListener('click', () => analyzeSelected({ useAi }));
  } finally {
    if (requestSerial === state.analysisRequestSerial) stopLoading();
  }
}

// ---------- Risultato analisi ----------

function probabilityClass(edge) {
  if (edge == null) return '';
  if (edge >= 0.025) return 'signal-positive';
  if (edge <= -0.025) return 'signal-negative';
  return '';
}

/** Sezione richiudibile: aperta su desktop, chiusa su iPhone salvo le principali. */
function section(title, subtitle, body, { open = false, badge = '' } = {}) {
  const isOpen = open || !isPhone();
  return `<details class="section-card"${isOpen ? ' open' : ''}><summary><div><h3>${escapeHtml(title)}</h3>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}</div>${badge ? `<span class="summary-badge">${escapeHtml(badge)}</span>` : ''}</summary><div class="section-body">${body}</div></details>`;
}

function renderMarkets(markets, selectedKey) {
  return `<div class="market-list">${markets.map((market) => `<div class="market-row${market.key === selectedKey ? ' selected' : ''}">
    <span class="market-name">${escapeHtml(market.label)}</span>
    <span class="market-prob">${percent(market.probability)}</span>
    <span class="market-meter"><span data-width="${Math.round(market.probability * 1000) / 10}"></span></span>
    <span class="market-meta"><span>Quota <b>${market.odd ? decimal(market.odd) : '—'}</b></span><span>Mercato <b>${market.marketProbability == null ? '—' : percent(market.marketProbability)}</b></span><span>Edge <b class="${probabilityClass(market.edge)}">${market.edge == null ? '—' : signedPercent(market.edge)}</b></span></span>
  </div>`).join('')}</div>`;
}

function renderObservedLayer(layer) {
  const observed = layer?.observed || {};
  const labels = {
    fixture: 'Partita', seasonStatistics: 'Statistiche stagionali', recentForm: 'Forma recente', injuries: 'Indisponibili',
    lineups: 'Formazioni ufficiali', odds: 'Quote', news: 'Notizie', competitionRules: 'Regolamento'
  };
  return Object.entries(labels).map(([key, label]) => `<li><span>${label}</span><strong class="${observed[key] ? 'signal-positive' : 'signal-muted'}">${observed[key] ? 'Disponibile' : 'Mancante'}</strong></li>`).join('');
}

function agentStatusLabel(status) {
  return { completed: 'Completato', insufficient_data: 'Dati insufficienti', skipped: 'Non eseguito', error: 'Errore' }[status] || status;
}

function renderAiTrace(trace) {
  if (!trace) return '<p class="muted">Nessuna traccia AI disponibile.</p>';
  const visibleAgents = [...(trace.agents || []), ...(trace.challenge ? [trace.challenge] : [])];
  const agentRows = visibleAgents.map((agent) => `<article class="ai-agent-card">
    <span>${escapeHtml(agentStatusLabel(agent.status))}${agent.cacheHit ? ' · cache' : ''}</span>
    <strong>${escapeHtml(agent.label || agent.agentId)}</strong>
    <p>${escapeHtml(agent.summary || 'Nessun output qualitativo applicato.')}</p>
    <small>${agent.provider ? `${escapeHtml(agent.provider)} · ` : ''}${(agent.effects || []).length} effetti proposti · ${(agent.unsupportedClaims || []).length} affermazioni non supportate</small>
  </article>`).join('');
  const decisions = trace.adjustmentPolicy?.decisions || [];
  const decisionRows = decisions.length ? decisions.map((item) => `<tr>
    <td>${escapeHtml(item.agentId)}</td><td>${escapeHtml(item.target)}</td><td class="numeric">${decimal(item.rawRequested ?? item.requested, 3)}</td><td class="numeric">${decimal(item.requested, 3)}</td><td class="numeric">${decimal(item.cappedBeforeGlobalScale ?? item.applied, 3)}</td><td class="numeric">${decimal(item.applied, 3)}</td><td>${escapeHtml(item.reason)}</td>
  </tr>`).join('') : '<tr><td colspan="7">Nessuna correzione AI applicata.</td></tr>';
  return `<div class="ai-mode-line"><span class="badge ${trace.applied ? 'active' : ''}">${escapeHtml(trace.provider || 'AI')} · ${escapeHtml(trace.mode || 'off')}</span><span>${escapeHtml(trace.audit?.modeNote || 'Gli agenti AI non hanno modificato i numeri.')}</span></div>
    <div class="ai-agent-grid">${agentRows || '<p class="muted">Agenti AI non eseguiti.</p>'}</div>
    <div class="table-scroll"><table class="data-table"><caption>Decisioni del backend: richiesta, deduplicazione, limite per agente, valore finale</caption><thead><tr><th>Agente</th><th>Target</th><th class="numeric">Richiesto</th><th class="numeric">Dedup</th><th class="numeric">Cap</th><th class="numeric">Finale</th><th>Decisione</th></tr></thead><tbody>${decisionRows}</tbody></table></div>
    <p class="muted small">Spostamento massimo delle probabilità: ${percent(trace.adjustmentPolicy?.probabilityShift || 0)} su un limite di ${percent(trace.adjustmentPolicy?.maxProbabilityShift || 0)}.</p>`;
}

function renderExplanation(analysis) {
  const layers = analysis.layers || {};
  const explanation = layers.qualitativeAssessments?.explanation || {};
  const unconfirmed = layers.unconfirmedInferences || [];
  return `<div class="explanation-box"><h4>${escapeHtml(explanation.headline || 'Lettura del modello')}</h4><p>${escapeHtml(explanation.executiveSummary || 'Spiegazione AI non disponibile: vale il report del motore statistico.')}</p>${explanation.riskSummary ? `<p>${escapeHtml(explanation.riskSummary)}</p>` : ''}${explanation.provider ? `<small>${escapeHtml(explanation.provider)} · ${escapeHtml(explanation.model || '')}</small>` : ''}</div>
    ${unconfirmed.length ? `<div class="unconfirmed-box"><h4>Inferenze non confermate</h4><ul>${unconfirmed.map((item) => `<li><strong>${escapeHtml(item.agentId)}</strong>: ${escapeHtml(item.claim)}</li>`).join('')}</ul></div>` : ''}
    ${renderAiTrace(layers.qualitativeAssessments)}`;
}

function renderLayers(analysis) {
  const layers = analysis.layers || {};
  return `<div class="layer-grid">
    <article><h4>Dati osservati</h4><ul class="compact-list">${renderObservedLayer(layers.realData)}</ul><p class="muted small">Fonte ${escapeHtml(layers.realData?.provider || '—')} · versione dati ${escapeHtml(analysis.dataVersion?.slice(0, 10) || '—')}</p></article>
    <article><h4>Baseline statistica</h4><p>${escapeHtml(layers.statisticalBaseline?.summary?.recommendation?.label || analysis.summary.recommendation.label)}</p><p class="muted small">xG ${decimal(layers.statisticalBaseline?.summary?.xg?.home)}–${decimal(layers.statisticalBaseline?.summary?.xg?.away)} · confidenza ${layers.statisticalBaseline?.summary?.confidence || analysis.summary.confidence}/100</p></article>
    <article><h4>Indicazione finale</h4><p><strong>${escapeHtml(layers.finalRecommendation?.label || analysis.summary.recommendation.label)}</strong></p><p class="muted small">Probabilità ${percent(layers.finalRecommendation?.probability || analysis.summary.recommendation.probability)} · xG ${decimal(analysis.summary.xg.home)}–${decimal(analysis.summary.xg.away)}</p></article>
  </div>`;
}

function renderProgression(analysis) {
  const progression = analysis.progression;
  if (!progression?.format?.knockout) return '';
  if (!progression.applicable) {
    const reason = progression.reason === 'competition_rules_unconfirmed'
      ? 'Regolamento non confermato: supplementari, rigori e qualificazione non vengono stimati.'
      : 'Serve il risultato dell’andata per stimare la qualificazione.';
    return section('Qualificazione', 'Separata dall’esito dei 90 minuti', `<div class="decision-state"><strong>Stima sospesa</strong><span>${escapeHtml(reason)}</span></div>`);
  }
  return section('Supplementari, rigori e qualificazione', 'Gara secca: l’1X2 resta riferito ai 90 minuti', `<div class="progression-grid">
    <article><span>Supplementari</span><strong>${percent(progression.extraTime)}</strong></article>
    <article><span>Rigori</span><strong>${percent(progression.penalties)}</strong></article>
    <article><span>Passa ${escapeHtml(analysis.fixture.home.name)}</span><strong>${percent(progression.qualification.home)}</strong></article>
    <article><span>Passa ${escapeHtml(analysis.fixture.away.name)}</span><strong>${percent(progression.qualification.away)}</strong></article>
  </div><p class="muted small">${escapeHtml(progression.penaltySplitAssumption)}</p>`, { open: true });
}

function renderTimeline(analysis) {
  const timeline = analysis.timeline;
  const leader = timeline.halfTimeLeader === 'home' ? analysis.fixture.home.name : timeline.halfTimeLeader === 'away' ? analysis.fixture.away.name : 'Pareggio';
  return section('Andamento della gara', 'Primo tempo e momenti chiave', `<div class="timeline-grid">
    <article><span>Gol nei primi 15’</span><strong>${percent(timeline.first15Goal)}</strong></article>
    <article><span>Pari all’intervallo</span><strong>${percent(timeline.halfTimeDraw)}</strong></article>
    <article><span>Avanti all’intervallo</span><strong>${escapeHtml(leader)}</strong></article>
    <article><span>Gol dopo il 75’</span><strong>${percent(timeline.after75Goal)}</strong></article>
  </div><p class="muted small">${escapeHtml(timeline.caveat)}</p>`);
}

const formLabel = { W: 'V', D: 'P', L: 'S' };
function formDots(letters) {
  if (!letters?.length) return '<span class="team-meta">Forma non disponibile</span>';
  return `<span class="form-dots" aria-label="Ultime partite: ${letters.map((letter) => formLabel[letter]).join(' ')}">${letters.map((letter) => `<span class="form-dot ${letter}">${formLabel[letter]}</span>`).join('')}</span>`;
}

function standingText(standing) {
  return standing?.rank ? `${standing.rank}° · ${standing.points} pt in ${standing.played} gare` : '';
}

function renderScoreGrid(grid, topScore) {
  if (!grid?.cells) return '';
  const max = Math.max(...grid.cells.flat());
  const header = `<span class="axis"></span>${grid.cells[0].map((_, away) => `<span class="axis">${away}</span>`).join('')}`;
  const rows = grid.cells.map((row, home) => `<span class="axis">${home}</span>${row.map((value, away) => `<span class="score-cell${`${home}-${away}` === topScore ? ' top' : ''}" data-alpha="${max ? (0.08 + 0.92 * value / max).toFixed(3) : 0}" title="${home}-${away}: ${percent(value)}">${value >= 0.01 ? Math.round(value * 100) : ''}</span>`).join('')}`).join('');
  return `<p class="muted small">Righe: gol della squadra di casa · colonne: gol della squadra in trasferta · valori in %. Altri risultati: ${percent(grid.other)}.</p><div class="score-grid" role="img" aria-label="Probabilità dei risultati esatti">${header}${rows}</div>`;
}

function renderOddsMovement(movement) {
  if (!movement?.items?.length) return '<p class="muted">La fonte non fornisce le quote di apertura per questa partita.</p>';
  return `<div class="movement-list">${movement.items.map((item) => {
    const arrow = item.current > item.open ? '↑' : item.current < item.open ? '↓' : '→';
    const tone = item.impliedChangePp > 0.25 ? 'signal-positive' : item.impliedChangePp < -0.25 ? 'signal-negative' : 'muted';
    return `<div class="movement-row"><span>${escapeHtml(item.label)}</span><b>${decimal(item.open)} ${arrow} ${decimal(item.current)}</b><span class="${tone}">${item.impliedChangePp >= 0 ? '+' : ''}${decimal(item.impliedChangePp, 1)} pp</span></div>`;
  }).join('')}</div><p class="muted small">pp = variazione della probabilità implicita. Solo informativo: non entra nel modello.</p>`;
}

function icsForFixture(fixture) {
  const stamp = (date) => new Date(date).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const start = new Date(fixture.kickoff);
  const end = new Date(start.getTime() + 2 * 3600000);
  const text = (value) => String(value).replace(/[,;\\]/g, (char) => `\\${char}`);
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Leone Francesco//Football Engine//IT', 'BEGIN:VEVENT',
    `UID:${text(fixture.id)}@football-engine`, `DTSTAMP:${stamp(Date.now())}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`,
    `SUMMARY:${text(`${fixture.home.name} - ${fixture.away.name}`)}`, `LOCATION:${text(fixture.venue || '')}`, `DESCRIPTION:${text(fixture.league.name)}`,
    'BEGIN:VALARM', 'TRIGGER:-PT30M', 'ACTION:DISPLAY', 'DESCRIPTION:Calcio d\'inizio tra 30 minuti', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}

function shareText(analysis) {
  const { fixture, summary } = analysis;
  const odd = analysis.markets.find((market) => market.key === summary.recommendation.key)?.odd;
  const safer = (summary.recommendation.safer || []).map((pick) => `${pick.label} ${percent(pick.probability, 0)}`).join(' · ');
  return `${fixture.home.name} - ${fixture.away.name} (${fixture.league.name}, ${formatDateTime(fixture.kickoff)})\n1 ${percent(summary.outcomes.home, 0)} · X ${percent(summary.outcomes.draw, 0)} · 2 ${percent(summary.outcomes.away, 0)}\nIndicazione: ${summary.recommendation.label} ${percent(summary.recommendation.probability, 0)}${odd ? ` a quota ${decimal(odd)}` : ''}${safer ? `\nPiù sicure: ${safer}` : ''}\nPrevisione probabilistica, non una certezza. Football Engine di Leone Francesco: https://flleone93.github.io/football-engine/`;
}

function weatherText(weather) {
  const parts = [];
  if (Number.isFinite(weather.temperatureC)) parts.push(`${Math.round(weather.temperatureC)}°C`);
  if (Number.isFinite(weather.precipitationProbability)) parts.push(`pioggia ${weather.precipitationProbability}%`);
  if (Number.isFinite(weather.windKmh)) parts.push(`vento ${Math.round(weather.windKmh)} km/h`);
  return parts.join(' · ');
}

// Quota esattamente come fornita (fino a 3 decimali, senza zeri finali): arrotondarla inventerebbe un CLV.
const oddInput = (value) => String(Math.round(Number(value) * 1000) / 1000).replace('.', ',');

const stakeText = (suggestion) => {
  if (!suggestion || suggestion.kellyFraction == null) return '—';
  if (!suggestion.hasStake) return 'Nessuna puntata consigliata';
  return suggestion.stake == null ? `${percent(suggestion.fraction)} del bankroll` : currency(suggestion.stake);
};

async function suggestStake(probability, odd) {
  try {
    return await postJson('/api/journal/suggest', { probability, odd });
  } catch {
    return null;
  }
}

function renderJournalLimitNotice() {
  const limits = state.journal?.limits;
  const node = elements.journalLimitNotice;
  if (!node) return;
  if (!limits?.anyExceeded) { node.classList.add('hidden'); return; }
  const parts = [];
  if (limits.daily.exceeded) parts.push(`oggi hai perso ${currency(limits.daily.loss)} (limite ${currency(limits.daily.limit)})`);
  if (limits.weekly.exceeded) parts.push(`negli ultimi 7 giorni hai perso ${currency(limits.weekly.loss)} (limite ${currency(limits.weekly.limit)})`);
  node.innerHTML = `<strong>Limite di perdita superato:</strong> ${escapeHtml(parts.join('; '))}. Valuta una pausa: la decisione resta tua.`;
  node.classList.remove('hidden');
}

async function loadJournal() {
  try {
    state.journal = await request('/api/journal', { timeout: 60000 });
  } catch {
    state.journal = null;
  }
  renderJournalLimitNotice();
  // Sempre: la sezione vive nel suo contenitore, così tornando allo Storico è già aggiornata.
  renderJournal();
}

function wireStakeAndJournal(analysis) {
  const recommendation = analysis.summary.recommendation;
  const selected = analysis.markets.find((market) => market.key === recommendation.key);
  const line = elements.analysisResult.querySelector('[data-stake-line] b');
  if (line) {
    if (!(selected?.odd > 1)) line.textContent = '—';
    else suggestStake(selected.probability, selected.odd).then((suggestion) => { line.textContent = stakeText(suggestion); });
  }
  const form = elements.analysisResult.querySelector('[data-journal-form]');
  if (!form) return;
  const status = form.querySelector('[data-journal-status]');
  let stakeEdited = false;
  const fill = async ({ keepOdd = false } = {}) => {
    const option = form.marketKey.selectedOptions[0];
    if (!keepOdd) form.oddTaken.value = oddInput(option.dataset.odd);
    const suggestion = await suggestStake(Number(option.dataset.probability), form.oddTaken.value);
    if (!stakeEdited) form.stake.value = suggestion?.stake ? decimal(suggestion.stake) : '';
    status.textContent = `Suggerimento: ${stakeText(suggestion)}`;
  };
  form.marketKey.addEventListener('change', () => fill());
  form.oddTaken.addEventListener('change', () => fill({ keepOdd: true }));
  form.stake.addEventListener('input', () => { stakeEdited = true; });
  fill();
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    if (button.disabled) return;
    button.disabled = true;
    try {
      await postJson('/api/journal', { fixtureId: analysis.fixture.id, marketKey: form.marketKey.value, oddTaken: form.oddTaken.value, stake: form.stake.value });
      status.textContent = 'Giocata salvata nel diario (Storico › Le mie giocate).';
      elements.appStatus.textContent = status.textContent;
      loadJournal();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
}

function renderAnalysis(analysis) {
  const { fixture, summary, governance } = analysis;
  const activeModels = analysis.agents.filter((agent) => agent.active);
  const missingModels = analysis.agents.filter((agent) => !agent.active);
  const riskItems = [...governance.riskFlags, ...governance.challenge];
  const recommendation = summary.recommendation;
  const selectedMarket = analysis.markets.find((market) => market.key === recommendation.key);
  const workflowActive = analysis.workflow.filter((item) => item.active).length;
  const outcomeName = (key) => ({ home: fixture.home.name, draw: 'Pareggio', away: fixture.away.name })[key];
  elements.analysisResult.innerHTML = `
    <section class="card match-hero">
      <div class="match-meta"><span class="kicker">${escapeHtml(fixture.league.name)}</span><span>${escapeHtml(formatDateTime(fixture.kickoff, { dateStyle: 'medium' }))}</span>${fixture.venue ? `<span>${escapeHtml(fixture.venue)}</span>` : ''}</div>
      <div class="match-teams">
        <div class="team-line"><strong>${escapeHtml(fixture.home.name)}</strong>${formDots(analysis.context.form?.home)}<span class="team-meta">${escapeHtml(standingText(analysis.context.standings?.home))}</span><button class="team-star" type="button" data-team-star="${escapeHtml(fixture.home.id)}" aria-pressed="${favorites.has('team', fixture.home.id)}" aria-label="Preferita: ${escapeHtml(fixture.home.name)}">${favorites.has('team', fixture.home.id) ? '★' : '☆'}</button></div>
        <span class="vs">vs</span>
        <div class="team-line"><strong>${escapeHtml(fixture.away.name)}</strong>${formDots(analysis.context.form?.away)}<span class="team-meta">${escapeHtml(standingText(analysis.context.standings?.away))}</span><button class="team-star" type="button" data-team-star="${escapeHtml(fixture.away.id)}" aria-pressed="${favorites.has('team', fixture.away.id)}" aria-label="Preferita: ${escapeHtml(fixture.away.name)}">${favorites.has('team', fixture.away.id) ? '★' : '☆'}</button></div>
      </div>
      <p class="match-meta"><button class="league-star" type="button" data-league-star="${escapeHtml(fixture.league.id)}" aria-pressed="${favorites.has('league', fixture.league.id)}">${favorites.has('league', fixture.league.id) ? '★' : '☆'} Competizione preferita: ${escapeHtml(fixture.league.name)}</button></p>
      ${analysis.context.weather ? `<p class="weather-line">Meteo al calcio d'inizio (${escapeHtml(analysis.context.weather.city)}): ${escapeHtml(weatherText(analysis.context.weather))}</p>` : ''}
      ${analysis.context.elo ? `<p class="weather-line">Elo stagione: ${escapeHtml(fixture.home.name)} ${Math.round(analysis.context.elo.home.rating)} (${analysis.context.elo.home.games} gare) · ${escapeHtml(fixture.away.name)} ${Math.round(analysis.context.elo.away.rating)} (${analysis.context.elo.away.games} gare) · attesa casa ${percent(analysis.context.elo.expectedHome, 0)}. Solo informativo.</p>` : ''}
      <div class="outcome-bar" role="img" aria-label="Probabilità 1X2 al 90': casa ${percent(summary.outcomes.home)}, pareggio ${percent(summary.outcomes.draw)}, trasferta ${percent(summary.outcomes.away)}"><span class="home" data-width="${summary.outcomes.home * 100}"></span><span class="draw" data-width="${summary.outcomes.draw * 100}"></span><span class="away" data-width="${summary.outcomes.away * 100}"></span></div>
      <div class="outcome-legend">
        <div class="home"><span>1 · ${escapeHtml(fixture.home.name)}</span><strong>${percent(summary.outcomes.home, 0)}</strong></div>
        <div><span>X · Pareggio</span><strong>${percent(summary.outcomes.draw, 0)}</strong></div>
        <div class="away"><span>2 · ${escapeHtml(fixture.away.name)}</span><strong>${percent(summary.outcomes.away, 0)}</strong></div>
      </div>
    </section>

    <section class="card pick-card">
      <div class="pick-head">
        <div><p class="kicker">Indicazione</p><h3>${escapeHtml(recommendation.label)}</h3></div>
        <div class="pick-probability"><strong>${percent(recommendation.probability, 0)}</strong><span>probabilità</span></div>
      </div>
      <div class="chips">
        <span class="chip ${recommendation.hasValue ? 'good' : 'warn'}">${recommendation.hasValue ? 'Valore rilevato' : 'Nessun valore sulla quota'}</span>
        ${selectedMarket?.odd ? `<span class="chip">Quota <b>${decimal(selectedMarket.odd)}</b></span>` : ''}
        ${recommendation.edge == null ? '' : `<span class="chip ${recommendation.edge >= 0.025 ? 'good' : recommendation.edge <= -0.025 ? 'bad' : ''}">Edge <b>${signedPercent(recommendation.edge)}</b></span>`}
        <span class="chip">Confidenza <b>${summary.confidence}/100</b></span>
      </div>
      <p class="pick-note">${escapeHtml(recommendation.status)} Intervallo ${percent(recommendation.interval[0])}–${percent(recommendation.interval[1])}. Favorita ai 90’: ${escapeHtml(outcomeName(summary.outcomes.home >= summary.outcomes.away ? (summary.outcomes.home >= summary.outcomes.draw ? 'home' : 'draw') : (summary.outcomes.away >= summary.outcomes.draw ? 'away' : 'draw')))}.</p>
      ${recommendation.safer?.length ? `<div class="safer-picks"><p class="kicker">Giocate più sicure</p>${recommendation.safer.map((pick) => `<div class="safer-pick"><span>${escapeHtml(pick.label)}</span><b>${percent(pick.probability, 0)}</b><small>${pick.odd ? `${pick.estimated ? 'quota equa stimata' : 'quota'} ${decimal(pick.odd)}` : 'quota non disponibile'}</small></div>`).join('')}</div>` : ''}
      <p class="stake-line" data-stake-line>Puntata consigliata: <b>…</b></p>
      ${state.journal?.enabled && analysis.markets.some((market) => market.odd > 1) && Date.parse(fixture.kickoff) > Date.now() ? `<details class="journal-form-wrap">
        <summary class="secondary-button">Aggiungi al diario</summary>
        <form class="journal-form" data-journal-form>
          <label>Mercato<select name="marketKey">${analysis.markets.filter((market) => market.odd > 1).map((market) => `<option value="${escapeHtml(market.key)}" data-probability="${market.probability}" data-odd="${market.odd}" ${market.key === recommendation.key ? 'selected' : ''}>${escapeHtml(market.label)} · ${decimal(market.odd)}</option>`).join('')}</select></label>
          <label>Quota presa<input name="oddTaken" inputmode="decimal" autocomplete="off" required></label>
          <label>Puntata (€)<input name="stake" inputmode="decimal" autocomplete="off" required></label>
          <button class="primary-button" type="submit">Salva giocata</button>
          <p class="muted small" data-journal-status role="status"></p>
        </form>
      </details>` : ''}
    </section>

    <div class="metric-grid">
      <article class="metric-card"><span>xG ${escapeHtml(fixture.home.name)}</span><strong>${decimal(summary.xg.home)}</strong></article>
      <article class="metric-card"><span>xG ${escapeHtml(fixture.away.name)}</span><strong>${decimal(summary.xg.away)}</strong></article>
      <article class="metric-card"><span>Risultato più probabile</span><strong>${escapeHtml(summary.exactScore.score)}</strong></article>
      <article class="metric-card"><span>Probabilità risultato</span><strong>${percent(summary.exactScore.probability)}</strong></article>
      <article class="metric-card"><span>Qualità dati</span><strong>${governance.dataQuality.score}/100</strong></article>
      <article class="metric-card"><span>Incertezza</span><strong>${escapeHtml(summary.uncertainty.level)}</strong></article>
    </div>

    ${section('Mercati e quote', `Modello contro ${governance.bookmaker || 'quote non disponibili'}`, renderMarkets(analysis.markets, recommendation.key), { open: true, badge: `${analysis.markets.length}` })}
    ${section('Spiegazione e agenti AI', 'Lettura del risultato e decisioni sugli agenti', renderExplanation(analysis), { open: true })}
    ${renderProgression(analysis)}
    ${section('Risultati esatti', 'Mappa delle probabilità dei punteggi', `${renderScoreGrid(analysis.scoreGrid, summary.exactScore.score)}<details class="nested"><summary>Elenco dei 10 più probabili</summary><div class="table-scroll"><table class="data-table"><thead><tr><th>#</th><th>Risultato</th><th>Esito</th><th class="numeric">Prob.</th><th class="numeric">Peso sull’esito</th></tr></thead><tbody>${analysis.exactScores.map((item) => `<tr><td>${item.rank}</td><td><strong>${item.score}</strong></td><td>${item.outcome}</td><td class="numeric">${percent(item.probability)}</td><td class="numeric">${percent(item.contributionToOutcome)}</td></tr>`).join('')}</tbody></table></div></details>`)}
    ${section('Movimento quote', 'Apertura contro quota attuale', renderOddsMovement(analysis.governance.oddsMovement))}
    ${renderTimeline(analysis)}
    ${section('Fattori decisivi', 'Direzione, intensità e certezza', `<ul class="factor-list">${analysis.factors.map((factor) => `<li><strong>${escapeHtml(factor.name)}</strong><span>${escapeHtml(factor.direction)}</span><small>Impatto ${escapeHtml(factor.intensity)} · certezza ${escapeHtml(factor.certainty)}</small></li>`).join('')}</ul>`)}
    ${section('Scenari alternativi', 'Se la gara gira a favore di una squadra', `<div class="scenario-grid">${analysis.scenarios.map((scenario) => `<article class="scenario"><strong>${escapeHtml(scenario.name)}</strong><p><span>xG</span><b>${decimal(scenario.xg.home)}–${decimal(scenario.xg.away)}</b></p><p><span>1 · X · 2</span><b>${percent(scenario.probabilities.home, 0)} · ${percent(scenario.probabilities.draw, 0)} · ${percent(scenario.probabilities.away, 0)}</b></p><p><span>Goal</span><b>${percent(scenario.markets.goal)}</b></p><p><span>Over 2.5</span><b>${percent(scenario.markets.over25)}</b></p></article>`).join('')}</div>`)}
    ${section('Modelli e pesi', 'Solo i modelli con dati disponibili entrano nella media', `<ul class="agent-list">${activeModels.map((agent) => `<li><strong>${escapeHtml(agent.name)}</strong><span>${percent(agent.effectiveWeight, 0)}</span><small>1 ${percent(agent.probabilities.home, 0)} · X ${percent(agent.probabilities.draw, 0)} · 2 ${percent(agent.probabilities.away, 0)}</small></li>`).join('')}${missingModels.map((agent) => `<li><strong>${escapeHtml(agent.name)}</strong><span class="signal-muted">${agent.unavailableReason ? 'Non disponibile' : 'Escluso'}</span><small>${escapeHtml(agent.unavailableReason || 'Dati insufficienti.')}</small></li>`).join('')}</ul>`, { badge: `${activeModels.length}/${analysis.agents.length}` })}
    ${section('Rischi e contestazioni', 'Cosa può invalidare la previsione', `<ul class="risk-list">${riskItems.map((risk) => `<li>${escapeHtml(risk)}</li>`).join('')}</ul>`, { badge: `${riskItems.length}` })}
    ${section('Separazione dei dati', 'Dati osservati, modello e indicazione finale', renderLayers(analysis))}
    ${section('Processo multi-agente', 'Ogni modulo dichiara se ha lavorato', `<div class="workflow-grid">${analysis.workflow.map((agent) => { const status = agent.status || (agent.active ? 'active' : 'inactive'); return `<article class="workflow-agent ${status}"><span>${status === 'active' ? 'Attivo' : status === 'unavailable_source' ? 'Non disponibile' : 'Escluso'}</span><strong>${escapeHtml(agent.name)}</strong><p>${escapeHtml(agent.note)}</p></article>`; }).join('')}</div>`, { badge: `${workflowActive}/${analysis.workflow.length}` })}
    ${section('Audit', 'Tracciabilità del calcolo', `<div class="table-scroll"><table class="data-table"><tbody>
      <tr><td>Simulazioni Monte Carlo</td><td class="numeric"><strong>${analysis.simulation.runs.toLocaleString('it-IT')}</strong></td></tr>
      <tr><td>Qualità dati</td><td class="numeric"><strong>${governance.dataQuality.score}/100</strong></td></tr>
      <tr><td>Accordo tra modelli</td><td class="numeric"><strong>${percent(governance.consensus)}</strong></td></tr>
      <tr><td>Robustezza</td><td class="numeric"><strong>${percent(governance.robustness)}</strong></td></tr>
      <tr><td>Entropia normalizzata</td><td class="numeric"><strong>${percent(summary.uncertainty.normalizedEntropy)}</strong></td></tr>
      <tr><td>Rischio che la favorita non vinca</td><td class="numeric"><strong>${percent(summary.uncertainty.favoriteNonWinRisk)}</strong></td></tr>
      <tr><td>Calibrazione empirica</td><td class="numeric"><strong>${governance.calibration?.empiricallyBacktested ? 'Attiva' : 'Non ancora disponibile'}</strong></td></tr>
      <tr><td>Formazioni ufficiali</td><td class="numeric"><strong>${analysis.context.lineupsConfirmed ? 'Sì' : 'No'}</strong></td></tr>
      <tr><td>Campo neutro</td><td class="numeric"><strong>${analysis.options.neutral ? 'Sì' : 'No'}</strong></td></tr>
      <tr><td>Quote aggiornate</td><td class="numeric"><strong>${governance.oddsUpdatedAt ? escapeHtml(formatDateTime(governance.oddsUpdatedAt)) : 'Non disponibili'}</strong></td></tr>
    </tbody></table></div><p class="muted small">${escapeHtml(governance.disagreements.join(' '))}</p>`)}

    <section class="card result-options">
      <label class="switch" for="resultNeutral"><input id="resultNeutral" type="checkbox" ${analysis.options.neutral ? 'checked' : ''}><span aria-hidden="true"></span>Campo neutro</label>
      ${aiActive() ? '<button class="secondary-button" type="button" data-result-action="ai">Ricalcola con agenti AI</button>' : '<button class="secondary-button" type="button" data-result-action="recalc">Ricalcola</button>'}
    </section>
    <div class="share-actions"><button class="secondary-button" type="button" data-result-action="calendar">Aggiungi al Calendario</button><button class="secondary-button" type="button" data-result-action="share">Condividi</button></div>
    <div class="result-actions"><button class="secondary-button" type="button" data-result-action="json">Esporta JSON</button><button class="secondary-button" type="button" data-result-action="print">Stampa / PDF</button></div>
    <div class="audit-footer"><span>${escapeHtml(governance.disclaimer)}</span><span>Analisi del ${escapeHtml(formatDateTime(analysis.generatedAt))}${analysis.cached ? ' · dalla cache' : ''}</span></div>`;

  // Le larghezze passano dal CSSOM: compatibile con la Content-Security-Policy senza stili inline.
  elements.analysisResult.querySelectorAll('[data-width]').forEach((node) => { node.style.width = `${Number(node.dataset.width)}%`; });
  elements.analysisResult.querySelectorAll('[data-alpha]').forEach((node) => { node.style.backgroundColor = `color-mix(in srgb, var(--accent) ${Math.round(Number(node.dataset.alpha) * 100)}%, var(--surface-2))`; node.style.color = Number(node.dataset.alpha) > 0.55 ? 'var(--accent-ink)' : 'var(--text)'; });
  elements.analysisResult.querySelectorAll('[data-team-star]').forEach((button) => button.addEventListener('click', () => {
    const on = favorites.toggle('team', button.dataset.teamStar);
    button.setAttribute('aria-pressed', String(on));
    button.textContent = on ? '★' : '☆';
    renderFixtures();
  }));
  elements.analysisResult.querySelectorAll('[data-league-star]').forEach((button) => button.addEventListener('click', () => {
    const on = favorites.toggle('league', button.dataset.leagueStar);
    button.setAttribute('aria-pressed', String(on));
    button.textContent = `${on ? '★' : '☆'} Competizione preferita: ${fixture.league.name}`;
    renderFixtures();
  }));
  elements.analysisResult.querySelector('[data-result-action="calendar"]')?.addEventListener('click', () => {
    downloadFile(`partita-${slug(`${fixture.home.name}-${fixture.away.name}`)}.ics`, icsForFixture(fixture), 'text/calendar').catch((error) => { elements.appStatus.textContent = error.message; });
  });
  elements.analysisResult.querySelector('[data-result-action="share"]')?.addEventListener('click', async () => {
    const text = shareText(analysis);
    try {
      if (navigator.share) await navigator.share({ title: `${fixture.home.name} - ${fixture.away.name}`, text });
      else { await navigator.clipboard.writeText(text); elements.appStatus.textContent = 'Analisi copiata negli appunti.'; }
    } catch (error) {
      if (error?.name !== 'AbortError') elements.appStatus.textContent = 'Condivisione non disponibile.';
    }
  });
  const recalc = (useAi) => {
    elements.neutralToggle.checked = elements.analysisResult.querySelector('#resultNeutral')?.checked || false;
    analyzeSelected({ useAi });
  };
  elements.analysisResult.querySelector('[data-result-action="recalc"]')?.addEventListener('click', () => recalc(false));
  elements.analysisResult.querySelector('[data-result-action="ai"]')?.addEventListener('click', () => recalc(true));
  elements.analysisResult.querySelector('[data-result-action="json"]')?.addEventListener('click', () => {
    const name = `analisi-${slug(`${fixture.home.name}-${fixture.away.name}`)}-${dateKey(analysis.generatedAt)}.json`;
    downloadFile(name, JSON.stringify(analysis, null, 2), 'application/json').catch((error) => { elements.appStatus.textContent = error.message; });
  });
  const printButton = elements.analysisResult.querySelector('[data-result-action="print"]');
  // window.print() non funziona dentro un Artifact né in modo affidabile nelle web app iOS a schermo intero.
  if (claudeRuntime || standaloneDisplay) printButton?.remove();
  else printButton?.addEventListener('click', () => window.print());
  wireStakeAndJournal(analysis);
}

function slug(value) {
  return String(value).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'export';
}

// Dentro un Artifact claude.ai i download diretti sono bloccati: si usa la capability `downloads` (conferma del viewer).
const claudeRuntime = typeof window.claude?.use === 'function';
const standaloneDisplay = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

async function downloadFile(name, content, type) {
  if (claudeRuntime) {
    const downloads = await window.claude.use('downloads').catch(() => null);
    if (!downloads) throw new Error('Il download non è disponibile in questa vista.');
    try {
      await downloads.save({ filename: name, data: content });
    } catch (error) {
      if (error?.code === 'declined' || error?.code === 'cancelled') return;
      throw new Error('Download non completato. Riprova.');
    }
    return;
  }
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  // Su iPhone il foglio di condivisione permette di salvare in File o inviare il report.
  if (navigator.canShare && navigator.share && /iPhone|iPad/.test(navigator.userAgent)) {
    const file = new File([blob], name, { type });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
      }
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Top del giorno ----------

function renderTopPicks(payload) {
  const { coverage, picks, simulation } = payload;
  const accumulator = simulation.accumulator;
  const singles = simulation.singles;
  const incomplete = !coverage.complete
    ? `<div class="top-picks-warning">${coverage.returnedPicks} selezioni superano i controlli di qualità su ${payload.limit} richieste: le altre partite non hanno quote o dati sufficienti.</div>`
    : '';
  const cards = picks.map((pick) => `<button class="top-pick-card" type="button" data-top-fixture-id="${escapeHtml(pick.fixture.id)}" aria-label="Apri l'analisi di ${escapeHtml(pick.fixture.home.name)} contro ${escapeHtml(pick.fixture.away.name)}">
    <span class="rank">${pick.rank}</span>
    <span class="top-pick-body">
      <strong>${escapeHtml(pick.fixture.home.name)} — ${escapeHtml(pick.fixture.away.name)}</strong>
      <span>${escapeHtml(pick.fixture.league.name)} · ${formatTime(pick.fixture.kickoff)}</span>
      <span class="chips"><span class="market-tag">${escapeHtml(pick.selection.label)}</span><span class="chip"><b>${percent(pick.selection.probability, 0)}</b></span><span class="chip">Quota <b>${decimal(pick.selection.odd)}</b></span>${pick.selection.edge == null ? '' : `<span class="chip ${pick.selection.edge >= 0.025 ? 'good' : pick.selection.edge <= -0.025 ? 'bad' : ''}">Edge <b>${signedPercent(pick.selection.edge)}</b></span>`}</span>
    </span>
  </button>`).join('');
  elements.topPicksResult.innerHTML = `
    <div class="top-picks-summary"><h3>Top ${picks.length} · ${escapeHtml(relativeDay(payload.date) || dateLabel(`${payload.date}T12:00:00Z`))}</h3><p>${coverage.analyzedFixtures} partite analizzate · ${coverage.eligibleFixtures} idonee · quote ${escapeHtml(payload.bookmaker || 'non disponibili')}</p></div>
    ${picks.length ? `<div class="top-pick-cards">${cards}</div>` : '<div class="card"><p class="muted">Nessuna selezione supera i controlli di qualità per questo giorno.</p></div>'}
    ${incomplete}
    ${accumulator && singles ? `<div class="top-ticket-grid">
      <article class="top-ticket-card"><span>Multipla · ${currency(simulation.stake)}</span><strong>Quota ${decimal(accumulator.combinedOdd, 2)}</strong><dl><dt>Probabilità modello</dt><dd>${percent(accumulator.modelProbability, 2)}</dd><dt>Ritorno potenziale</dt><dd>${currency(accumulator.potentialGrossReturn)}</dd><dt>Profitto potenziale</dt><dd>${currency(accumulator.potentialNetProfit)}</dd></dl></article>
      <article class="top-ticket-card"><span>Valore atteso multipla</span><strong class="${accumulator.expectedNetProfit >= 0 ? 'signal-positive' : 'signal-negative'}">${currency(accumulator.expectedNetProfit)}</strong><dl><dt>Ritorno atteso</dt><dd>${currency(accumulator.expectedGrossReturn)}</dd><dt>ROI atteso</dt><dd>${percent(accumulator.expectedRoi)}</dd><dt>Probabilità da quota</dt><dd>${percent(accumulator.bookmakerRawProbability, 2)}</dd></dl></article>
      <article class="top-ticket-card"><span>Singole · ${currency(singles.stakePerSelection)} ciascuna</span><strong class="${singles.expectedNetProfit >= 0 ? 'signal-positive' : 'signal-negative'}">${currency(singles.expectedNetProfit)}</strong><dl><dt>Ritorno atteso</dt><dd>${currency(singles.expectedGrossReturn)}</dd><dt>ROI atteso</dt><dd>${percent(singles.expectedRoi)}</dd></dl></article>
    </div>` : ''}
    <p class="top-ticket-note">${escapeHtml(simulation.assumptions.join(' '))}</p>`;
  elements.topPicksResult.classList.remove('hidden');
  elements.topPicksResult.querySelectorAll('[data-top-fixture-id]').forEach((card) => card.addEventListener('click', () => {
    const fixture = state.fixtures.find((item) => String(item.id) === String(card.dataset.topFixtureId));
    if (!fixture) return;
    activateTab('analysis');
    selectFixture(fixture.id);
  }));
}

async function loadTopPicks() {
  const date = elements.topPicksDate.value;
  const limit = Number(document.querySelector('input[name="topLimit"]:checked')?.value || 5);
  const stake = Number(elements.topPicksStake.value);
  elements.topPicksError.classList.add('hidden');
  elements.topPicksResult.classList.add('hidden');
  if (!date) {
    elements.topPicksError.textContent = 'Scegli un giorno con partite in calendario.';
    elements.topPicksError.classList.remove('hidden');
    return;
  }
  if (!Number.isFinite(stake) || stake < 1 || stake > 10000) {
    elements.topPicksError.textContent = 'Inserisci un importo tra 1 e 10.000 euro.';
    elements.topPicksError.classList.remove('hidden');
    return;
  }
  elements.topPicksButton.disabled = true;
  elements.topPicksLoading.classList.remove('hidden');
  elements.appStatus.textContent = 'Generazione Top del giorno in corso.';
  try {
    state.topPicks = await request('/api/top-picks', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ date, limit, stake }),
      timeout: 240000
    });
    renderTopPicks(state.topPicks);
    elements.appStatus.textContent = `Top ${state.topPicks.picks.length} pronta.`;
  } catch (error) {
    elements.topPicksError.textContent = error.message;
    elements.topPicksError.classList.remove('hidden');
  } finally {
    elements.topPicksLoading.classList.add('hidden');
    elements.topPicksButton.disabled = false;
  }
}

// ---------- Storico ----------

const metric = (value, digits = 3) => (value == null ? '—' : decimal(value, digits));
const outcomeLabel = { home: '1', draw: 'X', away: '2' };

function skillText(value, against) {
  if (value == null) return 'Servono partite concluse per il confronto.';
  return `Brier ${value >= 0 ? 'migliore' : 'peggiore'} del ${percent(Math.abs(value), 1)} rispetto ${against}.`;
}

function renderCalibrationChart(bins) {
  const size = 300;
  const pad = 36;
  const span = size - pad * 2;
  const x = (value) => pad + value * span;
  const y = (value) => size - pad - value * span;
  const maxN = Math.max(1, ...bins.map((bin) => bin.n));
  const grid = [0, 0.25, 0.5, 0.75, 1].map((tick) => `<line class="calib-grid" x1="${x(0)}" y1="${y(tick)}" x2="${x(1)}" y2="${y(tick)}"/><text class="calib-label" x="${pad - 6}" y="${y(tick) + 4}" text-anchor="end">${Math.round(tick * 100)}%</text><text class="calib-label" x="${x(tick)}" y="${size - pad + 16}" text-anchor="middle">${Math.round(tick * 100)}%</text>`).join('');
  const populated = bins.filter((bin) => bin.n);
  const path = populated.map((bin, index) => `${index ? 'L' : 'M'}${x(bin.meanPredicted).toFixed(1)},${y(bin.observedRate).toFixed(1)}`).join(' ');
  const points = populated.map((bin) => `<circle class="calib-point" cx="${x(bin.meanPredicted).toFixed(1)}" cy="${y(bin.observedRate).toFixed(1)}" r="${(3 + 7 * Math.sqrt(bin.n / maxN)).toFixed(1)}"><title>Previsto ${percent(bin.meanPredicted)} · osservato ${percent(bin.observedRate)} · ${bin.n} probabilità</title></circle>`).join('');
  return `<svg class="calibration-chart" viewBox="0 0 ${size} ${size}" role="img" aria-label="Diagramma di affidabilità: probabilità prevista contro frequenza osservata">
    ${grid}
    <line class="calib-diagonal" x1="${x(0)}" y1="${y(0)}" x2="${x(1)}" y2="${y(1)}"/>
    ${path ? `<path class="calib-line" d="${path}"/>` : ''}
    ${points}
    <text class="calib-axis" x="${size / 2}" y="${size - 4}" text-anchor="middle">Probabilità prevista</text>
    <text class="calib-axis" x="12" y="${size / 2}" text-anchor="middle" transform="rotate(-90 12 ${size / 2})">Frequenza osservata</text>
  </svg>`;
}

/** Grafico a linee SVG con assi in scala; `reference` è una linea orizzontale fissa (es. pareggio a ROI 0). */
function renderLineChart({ points, series, format, reference = null, label }) {
  const width = 340;
  const height = 200;
  const pad = { left: 46, right: 10, top: 12, bottom: 28 };
  const values = series.flatMap((item) => points.map((point) => point[item.key])).filter(Number.isFinite);
  if (reference != null) values.push(reference);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max - min < 1e-6) { min -= 0.05; max += 0.05; }
  const span = max - min;
  min -= span * 0.08;
  max += span * 0.08;
  const x = (index) => pad.left + (points.length === 1 ? 0 : index / (points.length - 1)) * (width - pad.left - pad.right);
  const y = (value) => pad.top + (1 - (value - min) / (max - min)) * (height - pad.top - pad.bottom);
  const ticks = [0, 1, 2, 3].map((step) => min + (max - min) * step / 3);
  const grid = ticks.map((tick) => `<line class="calib-grid" x1="${pad.left}" y1="${y(tick).toFixed(1)}" x2="${width - pad.right}" y2="${y(tick).toFixed(1)}"/><text class="calib-label" x="${pad.left - 6}" y="${(y(tick) + 3).toFixed(1)}" text-anchor="end">${escapeHtml(format(tick))}</text>`).join('');
  const lines = series.map((item) => {
    let path = '';
    points.forEach((point, index) => {
      if (!Number.isFinite(point[item.key])) return;
      path += `${path ? 'L' : 'M'}${x(index).toFixed(1)},${y(point[item.key]).toFixed(1)} `;
    });
    return path ? `<path class="timeline-line ${item.className}" d="${path.trim()}"/>` : '';
  }).join('');
  const referenceLine = reference == null ? '' : `<line class="calib-diagonal" x1="${pad.left}" y1="${y(reference).toFixed(1)}" x2="${width - pad.right}" y2="${y(reference).toFixed(1)}"/>`;
  const first = points[0];
  const last = points[points.length - 1];
  return `<svg class="timeline-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(label)}">
    ${grid}${referenceLine}${lines}
    <text class="calib-label" x="${pad.left}" y="${height - 8}">${escapeHtml(shortDateLabel(first.kickoff))}</text>
    <text class="calib-label" x="${width - pad.right}" y="${height - 8}" text-anchor="end">${escapeHtml(shortDateLabel(last.kickoff))} · ${last.n} partite</text>
  </svg>`;
}

function renderTimelineCharts(points) {
  if (!points || points.length < 2) return '<p class="muted">Servono almeno 2 partite concluse per disegnare l’andamento.</p>';
  const last = points[points.length - 1];
  const decimals = (value) => decimal(value, 3);
  return `<div class="trend-grid">
    <figure class="trend-figure">
      <figcaption><strong>Brier 1X2 mobile</strong> (più basso è meglio) · <span class="legend model">Motore</span> <span class="legend market">Mercato</span></figcaption>
      ${renderLineChart({ points, series: [{ key: 'brier', className: 'model' }, { key: 'marketBrier', className: 'market' }], format: decimals, label: `Brier mobile: motore ${decimals(last.brier)}${last.marketBrier == null ? '' : `, mercato ${decimals(last.marketBrier)}`}` })}
    </figure>
    <figure class="trend-figure">
      <figcaption><strong>ROI cumulato</strong> a puntata unitaria · linea tratteggiata = pareggio</figcaption>
      ${points.some((point) => point.roi != null) ? renderLineChart({ points, series: [{ key: 'roi', className: 'model' }], format: (value) => signedPercent(value, 0), reference: 0, label: `ROI cumulato ${last.roi == null ? 'non disponibile' : signedPercent(last.roi)} su ${last.bets} indicazioni` }) : '<p class="muted">Nessuna indicazione con quota da valutare.</p>'}
    </figure>
  </div>`;
}

function renderRecommendationCard(title, report) {
  const roi = report.flatStake.roi;
  return `<article class="top-ticket-card"><span>${escapeHtml(title)}</span><strong>${report.n ? `${report.hits}/${report.n} vinte` : 'Nessuna'}</strong><dl>
    <dt>Frequenza vincente</dt><dd>${report.hitRate == null ? '—' : percent(report.hitRate)}</dd>
    <dt>Probabilità media</dt><dd>${report.averageProbability == null ? '—' : percent(report.averageProbability)}</dd>
    <dt>Brier</dt><dd>${metric(report.brier)}</dd>
    <dt>ROI a 1 €</dt><dd class="${roi == null ? '' : roi >= 0 ? 'signal-positive' : 'signal-negative'}">${roi == null ? '—' : signedPercent(roi)}</dd>
  </dl></article>`;
}

function renderSaferCard(title, report) {
  return `<article class="top-ticket-card"><span>${escapeHtml(title)}</span><strong>${report.n ? `${report.hits}/${report.n} a segno` : 'Ancora nessuna'}</strong><dl>
    <dt>Frequenza</dt><dd>${report.hitRate == null ? '—' : percent(report.hitRate)}</dd>
    <dt>Probabilità media</dt><dd>${report.averageProbability == null ? '—' : percent(report.averageProbability)}</dd>
  </dl></article>`;
}

function resultCell(record) {
  if (!record.result) return '<span class="signal-muted">In attesa</span>';
  if (record.result.void) return `<span class="signal-muted">Annullata</span>`;
  return `<strong>${record.result.goals.home}-${record.result.goals.away}</strong> <span class="muted">(${outcomeLabel[record.result.outcome]})</span>`;
}

function hitCell(record) {
  if (!record.result?.finished) return '';
  const key = record.recommendation?.key;
  const { home, away } = record.result.goals;
  const outcome = record.result.outcome;
  const total = home + away;
  const checks = {
    '1': outcome === 'home', X: outcome === 'draw', '2': outcome === 'away', '1X': outcome !== 'away', X2: outcome !== 'home',
    GOAL: home > 0 && away > 0, NO_GOAL: home === 0 || away === 0, OVER_1_5: total > 1.5, UNDER_1_5: total < 1.5, OVER_2_5: total > 2.5, UNDER_2_5: total < 2.5
  };
  if (!(key in checks)) return '';
  return checks[key] ? '<span class="chip good">Vinta</span>' : '<span class="chip bad">Persa</span>';
}

function recordRow(record, pending = false) {
  return `<div class="record-row">
    <strong>${escapeHtml(record.fixture.home.name)} — ${escapeHtml(record.fixture.away.name)}</strong>
    <span class="record-side">${pending ? `<span class="muted">${escapeHtml(formatDateTime(record.fixture.kickoff, { dateStyle: 'short' }))}</span>` : resultCell(record)}</span>
    <small>${escapeHtml(record.fixture.league.name || '')} · 1 ${percent(record.outcomes.home, 0)} · X ${percent(record.outcomes.draw, 0)} · 2 ${percent(record.outcomes.away, 0)} · ${escapeHtml(record.recommendation?.label || '—')}</small>
    <span class="record-side">${pending ? '' : hitCell(record)}</span>
  </div>`;
}

function renderPerformance(payload) {
  if (!payload.enabled) {
    elements.performanceResult.innerHTML = `<div class="notice">${escapeHtml(payload.message || 'Registro previsioni disattivato.')}</div>`;
    elements.performanceResult.classList.remove('hidden');
    return;
  }
  const { ledger, evaluation, methodology } = payload;
  const model = evaluation.model;
  const market = evaluation.benchmarks.market;
  const uniform = evaluation.benchmarks.uniform;
  const pending = ledger.awaitingKickoff + ledger.awaitingResult;
  const benchmarkRow = (name, set) => `<tr><td><strong>${escapeHtml(name)}</strong></td><td class="numeric">${set.n}</td><td class="numeric">${metric(set.brier)}</td><td class="numeric">${metric(set.logLoss)}</td><td class="numeric">${metric(set.rps)}</td><td class="numeric">${set.accuracy == null ? '—' : percent(set.accuracy, 0)}</td></tr>`;
  const goalRow = (label, item) => `<tr><td>${label}</td><td class="numeric">${item.n}</td><td class="numeric">${item.averagePredicted == null ? '—' : percent(item.averagePredicted)}</td><td class="numeric">${item.observedRate == null ? '—' : percent(item.observedRate)}</td><td class="numeric">${metric(item.brier)}</td></tr>`;
  const delayHours = (Math.round((state.meta?.predictionLedger?.settlementDelayMinutes || 150) / 60 * 10) / 10).toLocaleString('it-IT');
  elements.performanceResult.innerHTML = `
    ${methodology.demo ? `<div class="notice" role="note"><strong>Storico dimostrativo.</strong> ${escapeHtml(methodology.demo)}</div>` : ''}
    <div class="metric-grid">
      <article class="metric-card"><span>Partite valutate</span><strong>${evaluation.settled}</strong></article>
      <article class="metric-card"><span>In attesa</span><strong>${pending}</strong></article>
      <article class="metric-card"><span>Brier 1X2 ↓</span><strong>${metric(model.brier)}</strong></article>
      <article class="metric-card"><span>Log loss ↓</span><strong>${metric(model.logLoss)}</strong></article>
      <article class="metric-card"><span>RPS ↓</span><strong>${metric(model.rps)}</strong></article>
      <article class="metric-card"><span>Calibrazione ↓</span><strong>${evaluation.calibration.expectedCalibrationError == null ? '—' : percent(evaluation.calibration.expectedCalibrationError)}</strong></article>
    </div>
    ${evaluation.settled ? '' : `<div class="notice">Nessuna partita registrata è ancora conclusa. I risultati arrivano da soli circa ${delayHours} ore dopo il calcio d'inizio, quando apri l'app.</div>`}
    ${section('Modello contro benchmark', 'Valori più bassi = previsioni migliori', `<div class="table-scroll"><table class="data-table"><thead><tr><th>Previsore</th><th class="numeric">N</th><th class="numeric">Brier</th><th class="numeric">Log loss</th><th class="numeric">RPS</th><th class="numeric">Acc.</th></tr></thead><tbody>
        ${benchmarkRow('Motore', model)}${benchmarkRow('Motore (con quote)', market.modelOnSameSample)}${benchmarkRow('Mercato de-vig', market)}${benchmarkRow('Uniforme 1/3', uniform)}
      </tbody></table></div>
      <div class="skill-row"><div class="decision-state ${evaluation.benchmarks.brierSkillVsUniform > 0 ? 'positive' : ''}"><strong>Contro il caso</strong><span>${skillText(evaluation.benchmarks.brierSkillVsUniform, 'al modello uniforme')}</span></div>
      <div class="decision-state ${market.brierSkillVsMarket > 0 ? 'positive' : ''}"><strong>Contro le quote</strong><span>${skillText(market.brierSkillVsMarket, 'al mercato')}</span></div></div>`, { open: true })}
    ${section('Andamento nel tempo', 'Ultime 50 partite e rendimento cumulato', renderTimelineCharts(evaluation.timeline), { open: true })}
    ${section('Indicazioni principali', 'Quante sono andate a segno e con quale rendimento', `<div class="recommendation-grid">${renderRecommendationCard('Tutte le indicazioni', evaluation.recommendations.all)}${renderRecommendationCard('Solo con valore', evaluation.recommendations.valueOnly)}${evaluation.safer ? `${renderSaferCard('Doppia chance della favorita', evaluation.safer.doubleChance)}${renderSaferCard('Over 1.5', evaluation.safer.over15)}` : ''}</div>
      <div class="table-scroll"><table class="data-table compact-table"><caption>Mercati goal</caption><thead><tr><th>Mercato</th><th class="numeric">N</th><th class="numeric">Prevista</th><th class="numeric">Osservata</th><th class="numeric">Brier</th></tr></thead><tbody>${goalRow('Over 2.5', evaluation.goalMarkets.OVER_2_5)}${goalRow('Goal', evaluation.goalMarkets.GOAL)}</tbody></table></div>`, { open: true })}
    ${section('Calibrazione', 'Se il modello dice 60%, succede 6 volte su 10?', `<div class="calibration-body">${renderCalibrationChart(evaluation.calibration.bins)}</div>
      <div class="table-scroll"><table class="data-table compact-table"><thead><tr><th>Fascia</th><th class="numeric">N</th><th class="numeric">Prevista</th><th class="numeric">Osservata</th></tr></thead><tbody>${evaluation.calibration.bins.filter((bin) => bin.n).map((bin) => `<tr><td>${Math.round(bin.from * 100)}–${Math.round(bin.to * 100)}%</td><td class="numeric">${bin.n}</td><td class="numeric">${percent(bin.meanPredicted)}</td><td class="numeric">${percent(bin.observedRate)}</td></tr>`).join('') || '<tr><td colspan="4">Nessun dato.</td></tr>'}</tbody></table></div>`)}
    ${section('Ultimi esiti', 'Previsione pre-partita contro risultato al 90’', `<div class="record-list">${payload.recent.map((record) => recordRow(record)).join('') || '<p class="muted">Nessun risultato acquisito.</p>'}</div>`, { open: true, badge: `${payload.recent.length}` })}
    ${section('Previsioni in attesa', 'Registrate prima del calcio d’inizio', `<div class="record-list">${payload.upcoming.map((record) => recordRow(record, true)).join('') || '<p class="muted">Nessuna previsione in attesa: analizza una partita per registrarla.</p>'}</div>`, { badge: `${pending}` })}
    ${section('Per competizione', 'Sotto le 100 partite le metriche sono instabili', `<div class="table-scroll"><table class="data-table"><thead><tr><th>Competizione</th><th class="numeric">N</th><th class="numeric">Brier</th><th class="numeric">Log loss</th><th class="numeric">RPS</th><th class="numeric">Acc.</th></tr></thead><tbody>${evaluation.byCompetition.map((item) => benchmarkRow(item.name, item)).join('') || '<tr><td colspan="6">Nessuna partita valutata.</td></tr>'}</tbody></table></div>`)}
    ${section('Metodo', 'Regole fisse e verificabili', `<ul class="risk-list">${['officialPrediction', 'horizon', 'metrics', 'benchmark', 'roi'].map((key) => `<li>${escapeHtml(methodology[key])}</li>`).join('')}</ul>
      <p class="muted small">Registro ${escapeHtml(ledger.storage)} · ${ledger.predictionsLogged} previsioni · ${ledger.fixturesTracked} partite · ${ledger.voided} annullate${payload.settlement ? ` · ultimo controllo ${escapeHtml(formatDateTime(payload.settlement.at))} (${payload.settlement.settled}/${payload.settlement.checked} risultati)` : ''}.</p>`)}`;
  elements.performanceResult.classList.remove('hidden');
}

async function loadPerformance() {
  elements.performanceError.classList.add('hidden');
  elements.performanceLoading.classList.remove('hidden');
  elements.performanceRefresh.disabled = true;
  elements.appStatus.textContent = 'Valutazione dello storico in corso.';
  try {
    state.performance = await request('/api/performance', { timeout: 120000 });
    state.performanceLoaded = true;
    renderPerformance(state.performance);
    await loadJournal();
    elements.appStatus.textContent = `Storico aggiornato: ${state.performance.evaluation?.settled ?? 0} partite valutate.`;
  } catch (error) {
    elements.performanceError.textContent = error.message;
    elements.performanceError.classList.remove('hidden');
  } finally {
    elements.performanceLoading.classList.add('hidden');
    elements.performanceRefresh.disabled = false;
  }
}

function csvCell(value) {
  if (value == null) return '';
  let text = String(value);
  // Neutralizza formule nei fogli di calcolo (CSV injection) per i campi testuali.
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function exportPerformanceCsv() {
  elements.performanceExport.disabled = true;
  try {
    const payload = await request('/api/performance/records', { timeout: 120000 });
    const rows = payload.rows || [];
    if (!rows.length) throw new Error('Nessuna previsione registrata da esportare.');
    const headers = Object.keys(rows[0]);
    const csv = [headers.join(';'), ...rows.map((row) => headers.map((key) => csvCell(row[key])).join(';'))].join('\r\n');
    await downloadFile(`registro-previsioni-${payload.mode}-${dateKey(new Date())}.csv`, `﻿${csv}`, 'text/csv');
  } catch (error) {
    elements.performanceError.textContent = error.message;
    elements.performanceError.classList.remove('hidden');
  } finally {
    elements.performanceExport.disabled = false;
  }
}

const BET_STATUS = { open: 'In corso', won: 'Vinta', lost: 'Persa', void: 'Annullata' };

function betRow(bet) {
  const clv = bet.clv == null ? '—' : `${signedPercent(bet.clv)}${bet.clvFinal ? '' : ' (provvisorio)'}`;
  const profit = bet.profit == null ? '—' : `${bet.profit >= 0 ? '+' : ''}${currency(bet.profit)}`;
  return `<div class="record-row bet-row">
    <div><strong>${escapeHtml(bet.match)}</strong><small>${escapeHtml(bet.label)} · quota ${decimal(bet.oddTaken)} · ${currency(bet.stake)} · ${escapeHtml(formatDateTime(bet.kickoff, { dateStyle: 'short' }))}</small><small>Chiusura ${bet.closingOdd ? decimal(bet.closingOdd) : '—'} · CLV ${escapeHtml(clv)}</small></div>
    <div class="record-side"><span class="${bet.status === 'won' ? 'signal-positive' : bet.status === 'lost' ? 'signal-negative' : 'signal-muted'}">${BET_STATUS[bet.status]}${bet.goals ? ` ${bet.goals.home}-${bet.goals.away}` : ''}</span><b>${escapeHtml(profit)}</b><button class="link-button" type="button" data-delete-bet="${escapeHtml(bet.id)}" aria-label="Elimina la giocata ${escapeHtml(bet.match)}">Elimina</button></div>
  </div>`;
}

function renderJournal() {
  const node = elements.journalResult;
  const payload = state.journal;
  if (!node) return;
  if (!payload?.enabled) { node.innerHTML = ''; return; }
  const { summary, settings, bets } = payload;
  const fractionOptions = [[0.125, '1/8'], [0.25, '1/4'], [0.5, '1/2']].map(([value, label]) => `<option value="${value}" ${settings.kellyMultiplier === value ? 'selected' : ''}>${label}</option>`).join('');
  const num = (value) => (value == null ? '' : String(value).replace('.', ','));
  node.innerHTML = section('Le mie giocate', 'Profitto, ROI e CLV delle giocate registrate', `
    ${payload.storage === 'memory' ? '<div class="notice" role="note">Il diario resta solo finché l’app è aperta: qui non c’è un archivio permanente (demo, Artifact o navigazione privata).</div>' : ''}
    <div class="metric-grid">
      <article class="metric-card"><span>Giocate</span><strong>${summary.count}</strong></article>
      <article class="metric-card"><span>Profitto</span><strong class="${summary.profit > 0 ? 'signal-positive' : summary.profit < 0 ? 'signal-negative' : ''}">${currency(summary.profit)}</strong></article>
      <article class="metric-card"><span>ROI</span><strong>${summary.roi == null ? '—' : signedPercent(summary.roi)}</strong></article>
      <article class="metric-card"><span>CLV medio</span><strong>${summary.avgClv == null ? '—' : signedPercent(summary.avgClv)}</strong></article>
      <article class="metric-card"><span>Vinte</span><strong>${summary.winRate == null ? '—' : percent(summary.winRate, 0)}</strong></article>
      <article class="metric-card"><span>In corso</span><strong>${summary.open}</strong></article>
    </div>
    <div class="record-list">${bets.map(betRow).join('') || '<p class="muted">Nessuna giocata: apri una partita e tocca “Aggiungi al diario”.</p>'}</div>
    <details class="nested"><summary>Bankroll e limiti</summary>
      <form class="journal-form" data-journal-settings>
        <label>Bankroll (€, vuoto = puntate in %)<input name="bankroll" inputmode="decimal" value="${num(settings.bankroll)}"></label>
        <label>Frazione di Kelly<select name="kellyMultiplier">${fractionOptions}</select></label>
        <label>Tetto per giocata (% del bankroll)<input name="maxStakePct" inputmode="decimal" value="${num(Math.round(settings.maxStakePct * 1000) / 10)}"></label>
        <label>Limite di perdita giornaliero (€)<input name="dailyLossLimit" inputmode="decimal" value="${num(settings.dailyLossLimit)}"></label>
        <label>Limite di perdita settimanale (€)<input name="weeklyLossLimit" inputmode="decimal" value="${num(settings.weeklyLossLimit)}"></label>
        <button class="primary-button" type="submit">Salva</button>
        <p class="muted small" data-settings-status role="status">Al superamento di un limite compare un avviso: nessun blocco, decidi tu.</p>
      </form>
    </details>
    <button id="journalExport" class="secondary-button" type="button" ${bets.length ? '' : 'disabled'}>Esporta diario CSV</button>`, { open: true, badge: `${summary.count}` });
  // Eliminazione in due tocchi: confirm() è bloccato dentro l'Artifact claude.ai.
  node.querySelectorAll('[data-delete-bet]').forEach((button) => button.addEventListener('click', async () => {
    if (!button.dataset.confirmDelete) {
      button.dataset.confirmDelete = '1';
      button.textContent = 'Conferma eliminazione';
      setTimeout(() => { if (button.isConnected && !button.disabled) { delete button.dataset.confirmDelete; button.textContent = 'Elimina'; } }, 4000);
      return;
    }
    button.disabled = true;
    try {
      await postJson('/api/journal/delete', { id: button.dataset.deleteBet });
      await loadJournal();
    } catch (error) {
      elements.appStatus.textContent = error.message;
      button.disabled = false;
    }
  }));
  const form = node.querySelector('[data-journal-settings]');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const statusNode = form.querySelector('[data-settings-status]');
    const pct = String(form.maxStakePct.value).trim().replace(',', '.');
    try {
      await postJson('/api/journal/settings', {
        bankroll: form.bankroll.value, kellyMultiplier: Number(form.kellyMultiplier.value),
        maxStakePct: pct ? Number(pct) / 100 : '', dailyLossLimit: form.dailyLossLimit.value, weeklyLossLimit: form.weeklyLossLimit.value
      });
      await loadJournal();
      const fresh = elements.journalResult.querySelector('[data-settings-status]');
      if (fresh) { fresh.textContent = 'Salvato. Le puntate consigliate usano i nuovi valori.'; fresh.closest('details').open = true; }
    } catch (error) {
      statusNode.textContent = error.message;
    }
  });
  node.querySelector('#journalExport')?.addEventListener('click', exportJournalCsv);
}

async function exportJournalCsv() {
  const bets = state.journal?.bets || [];
  if (!bets.length) return;
  const headers = ['placedAt', 'kickoff', 'competition', 'match', 'market', 'oddTaken', 'stake', 'closingOdd', 'clv', 'clvFinal', 'status', 'goals', 'profit'];
  const rows = bets.map((bet) => [bet.placedAt, bet.kickoff, bet.competition, bet.match, bet.label, bet.oddTaken, bet.stake, bet.closingOdd, bet.clv, bet.clvFinal, BET_STATUS[bet.status], bet.goals ? `${bet.goals.home}-${bet.goals.away}` : '', bet.profit]);
  const csv = [headers.join(';'), ...rows.map((row) => row.map(csvCell).join(';'))].join('\r\n');
  try {
    await downloadFile(`diario-giocate-${dateKey(new Date())}.csv`, `﻿${csv}`, 'text/csv');
  } catch (error) {
    elements.appStatus.textContent = error.message;
  }
}

// ---------- Navigazione ----------

elements.refreshButton.addEventListener('click', () => {
  loadFixtures(true);
  if (!elements.performanceView.hidden) loadPerformance();
});
elements.searchInput.addEventListener('input', renderFixtures);
elements.leagueFilter.addEventListener('change', renderFixtures);
elements.dateFilter.addEventListener('change', renderFixtures);
elements.sortSelect.addEventListener('change', renderFixtures);
document.querySelectorAll('[data-list-filter]').forEach((chip) => chip.addEventListener('click', () => {
  state.listFilter = chip.dataset.listFilter;
  document.querySelectorAll('[data-list-filter]').forEach((item) => item.setAttribute('aria-pressed', String(item === chip)));
  renderFixtures();
}));
elements.topPicksForm.addEventListener('submit', (event) => {
  event.preventDefault();
  loadTopPicks();
});
elements.analyzeButton.addEventListener('click', () => analyzeSelected({ useAi: true }));
elements.quickAnalyzeButton.addEventListener('click', () => analyzeSelected({ useAi: false }));
elements.backToList.addEventListener('click', showList);

const tabs = [
  { name: 'analysis', tab: elements.analysisTab, view: elements.analysisView },
  { name: 'top', tab: elements.topPicksTab, view: elements.topPicksView },
  { name: 'performance', tab: elements.performanceTab, view: elements.performanceView },
  { name: 'settings', tab: elements.settingsTab, view: elements.settingsView }
].filter((item) => item.tab && (item.name !== 'settings' || globalThis.__FOOTBALL_ENGINE_STANDALONE__?.settings));

function activateTab(tabName) {
  const current = tabs.find((item) => item.tab.getAttribute('aria-selected') === 'true');
  // Toccare di nuovo "Partite" mentre si guarda un dettaglio riporta all'elenco, come nelle app iOS.
  if (current?.name === 'analysis' && tabName === 'analysis' && document.body.classList.contains('show-detail')) {
    showList();
    return;
  }
  for (const item of tabs) {
    const selected = item.name === tabName;
    item.tab.setAttribute('aria-selected', String(selected));
    item.tab.tabIndex = selected ? 0 : -1;
    item.view.hidden = !selected;
  }
  if (tabName === 'performance' && !state.performanceLoaded) loadPerformance();
  if (current?.name !== tabName) window.scrollTo(0, 0);
}

tabs.forEach((item, index) => {
  item.tab.addEventListener('click', () => activateTab(item.name));
  item.tab.addEventListener('keydown', (event) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === 'Home' ? 0
      : event.key === 'End' ? tabs.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
    activateTab(tabs[nextIndex].name);
    tabs[nextIndex].tab.focus();
  });
});

elements.performanceRefresh.addEventListener('click', loadPerformance);
elements.performanceExport.addEventListener('click', exportPerformanceCsv);

// ---------- Impostazioni (solo app iPhone) ----------

const deviceApp = globalThis.__FOOTBALL_ENGINE_STANDALONE__;

function renderSettings() {
  const current = deviceApp.settings.get();
  elements.settingsProvider.value = current.aiProvider;
  elements.settingsMode.value = current.aiMode;
  elements.settingsDays.value = String(current.daysAhead);
  elements.settingsAutoTrack.checked = current.autoTrack;
  elements.settingsKey.value = '';
  elements.settingsKeyState.textContent = current.hasKey ? `Chiave salvata (${current.apiKey}). Lascia vuoto per mantenerla.` : 'Nessuna chiave salvata.';
  elements.settingsLeagues.innerHTML = deviceApp.leagues.map((league) => `<label class="settings-league"><input type="checkbox" value="${escapeHtml(league.slug)}" ${current.leagues.includes(league.slug) ? 'checked' : ''}> ${escapeHtml(league.name)} <small>${escapeHtml(league.country)}</small></label>`).join('');
}

if (deviceApp?.settings && elements.settingsTab) {
  elements.settingsTab.hidden = false;
  renderSettings();
  elements.settingsForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const key = elements.settingsKey.value.trim();
    const provider = elements.settingsProvider.value;
    const missingKey = provider !== 'off' && !key && !deviceApp.settings.get().hasKey;
    try {
      deviceApp.settings.save({
        aiProvider: provider,
        ...(key ? { apiKey: key } : {}),
        aiMode: elements.settingsMode.value,
        daysAhead: Number(elements.settingsDays.value),
        leagues: [...elements.settingsLeagues.querySelectorAll('input:checked')].map((input) => input.value),
        autoTrack: elements.settingsAutoTrack.checked
      });
      elements.settingsStatus.textContent = missingKey
        ? 'Salvato. Gli agenti AI si attivano quando inserisci la chiave. Riavvio dell’app…'
        : 'Salvato. Riavvio dell’app…';
      setTimeout(() => location.reload(), missingKey ? 1200 : 400);
    } catch {
      elements.settingsStatus.textContent = 'Impossibile salvare: l’archiviazione del browser non è disponibile.';
    }
  });
  elements.settingsClearKey.addEventListener('click', () => {
    deviceApp.settings.clearKey();
    renderSettings();
    elements.settingsStatus.textContent = 'Chiave rimossa. Premi Salva per applicare.';
  });
  elements.settingsTrackNow.addEventListener('click', async () => {
    elements.settingsTrackNow.disabled = true;
    elements.settingsStatus.textContent = 'Aggiornamento dello storico: risultati e previsioni delle prossime 48 ore…';
    try {
      const result = await deviceApp.autoTrack({ force: true });
      elements.settingsStatus.textContent = `Fatto: ${result.settlement?.settled ?? 0} risultati acquisiti, ${result.recorded} nuove previsioni su ${result.fixtures} partite.`;
      state.performanceLoaded = false;
    } catch (error) {
      elements.settingsStatus.textContent = `Aggiornamento non riuscito: ${error.message || 'errore di rete'}.`;
    } finally {
      elements.settingsTrackNow.disabled = false;
    }
  });
}

// ---------- Tema e guida al primo avvio ----------

function applyTheme(choice) {
  if (choice === 'light' || choice === 'dark') document.documentElement.dataset.theme = choice;
  else delete document.documentElement.dataset.theme;
}
const storedTheme = (() => { try { return localStorage.getItem('football-engine-theme') || 'auto'; } catch { return 'auto'; } })();
applyTheme(storedTheme);
if (elements.settingsTheme) {
  elements.settingsTheme.value = storedTheme;
  elements.settingsTheme.addEventListener('change', () => {
    applyTheme(elements.settingsTheme.value);
    try { localStorage.setItem('football-engine-theme', elements.settingsTheme.value); } catch { /* sessione */ }
  });
}

function showOnboarding() {
  let seen = false;
  try { seen = localStorage.getItem('football-engine-onboarded-v1') === '1'; } catch { /* sessione */ }
  if (seen || !deviceApp?.settings || !elements.onboarding) return;
  const install = standaloneDisplay ? '' : '<li><b>3</b><span><strong>Installa l\'app:</strong> in Safari tocca Condividi → "Aggiungi alla schermata Home".</span></li>';
  elements.onboarding.innerHTML = `<div class="onboarding-sheet" role="dialog" aria-modal="true" aria-labelledby="onboardingTitle">
    <h2 id="onboardingTitle">Benvenuto in Football Engine</h2>
    <ol class="onboarding-steps">
      <li><b>1</b><span><strong>Partite reali, probabilità oneste:</strong> tocca una partita per vedere 1X2, risultati, quote e valore. Sono probabilità, non certezze.</span></li>
      <li><b>2</b><span><strong>Attiva Claude (consigliato):</strong> Impostazioni → incolla la chiave creata su console.anthropic.com. Senza chiave funziona il motore statistico.</span></li>
      ${install}
    </ol>
    <button class="primary-button" type="button" data-onboarding-close>Inizia</button>
    <p class="muted small">Creata da Leone Francesco · solo maggiorenni · gioca responsabilmente.</p>
  </div>`;
  elements.onboarding.hidden = false;
  elements.onboarding.querySelector('[data-onboarding-close]').addEventListener('click', () => {
    elements.onboarding.hidden = true;
    try { localStorage.setItem('football-engine-onboarded-v1', '1'); } catch { /* sessione */ }
  });
}

async function boot() {
  try {
    await loadMeta();
    showOnboarding();
    elements.analyzeButton.textContent = aiActive() ? 'Analizza con agenti AI' : 'Analizza';
    elements.quickAnalyzeButton.classList.toggle('hidden', !aiActive());
    await loadFixtures();
    loadJournal();
    setInterval(() => loadFixtures(true), state.meta.autoRefreshMinutes * 60_000);
  } catch (error) {
    elements.fixturesLoading.classList.add('hidden');
    elements.fixturesError.textContent = error.message;
    elements.fixturesError.classList.remove('hidden');
  }
}

boot();
