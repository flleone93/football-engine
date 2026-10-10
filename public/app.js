const state = {
  meta: null,
  fixtures: [],
  selected: null,
  analysis: null,
  topPicks: null,
  performance: null,
  performanceLoaded: false,
  loadingTimer: null,
  analysisRequestSerial: 0
};

const elements = Object.fromEntries([
  'modeBadge', 'lastUpdate', 'refreshButton', 'fixtureCount', 'leagueCount', 'providerName',
  'bookmakerName', 'demoNotice', 'filteredCount', 'searchInput', 'leagueFilter', 'dateFilter',
  'fixturesLoading', 'fixturesError', 'fixtureList', 'emptyState', 'selectionState', 'selectedLeague',
  'selectedTitle', 'selectedMeta', 'neutralToggle', 'analyzeButton', 'preflightSource',
  'analysisLoading', 'loadingStep', 'loadingProgress', 'analysisProgress', 'analysisError', 'analysisResult',
  'topPicksDate', 'topPicksStake', 'topPicksButton', 'topPicksLoading',
  'topPicksError', 'topPicksResult', 'topPicksForm', 'aiModeBadge', 'appStatus',
  'analysisTab', 'topPicksTab', 'analysisView', 'topPicksView',
  'performanceTab', 'performanceView', 'performanceRefresh', 'performanceExport', 'performanceLoading',
  'performanceError', 'performanceResult', 'snapshotNotice',
  'settingsTab', 'settingsView', 'settingsForm', 'settingsProvider', 'settingsKey', 'settingsKeyState', 'settingsMode',
  'settingsClearKey', 'settingsDays', 'settingsLeagues', 'settingsAutoTrack', 'settingsTrackNow', 'settingsStatus'
].map((id) => [id, document.getElementById(id)]));

const percent = (value, digits = 1) => `${(Number(value || 0) * 100).toFixed(digits).replace('.', ',')}%`;
const decimal = (value, digits = 2) => Number(value || 0).toFixed(digits).replace('.', ',');
const currency = (value) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(Number(value || 0));
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
const formatDateTime = (value, options = {}) => new Intl.DateTimeFormat('it-IT', {
  dateStyle: options.dateStyle || 'medium', timeStyle: options.timeStyle || 'short', timeZone: state.meta?.timezone || 'Europe/Rome'
}).format(new Date(value));
const dateKey = (value) => new Intl.DateTimeFormat('sv-SE', { timeZone: state.meta?.timezone || 'Europe/Rome' }).format(new Date(value));
const dateLabel = (value) => new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: state.meta?.timezone || 'Europe/Rome' }).format(new Date(value));

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
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function loadMeta() {
  state.meta = await request('/api/meta');
  elements.modeBadge.textContent = state.meta.mode === 'demo' ? 'Demo' : 'Live';
  elements.modeBadge.className = `badge ${state.meta.mode}`;
  const aiMode = state.meta.ai?.effectiveMode || 'off';
  const aiProvider = { gemini: 'Gemini', openai: 'OpenAI', claude: 'Claude' }[state.meta.ai?.provider] || 'AI';
  elements.aiModeBadge.textContent = aiMode === 'active' ? `${aiProvider} attiva` : aiMode === 'shadow' ? `${aiProvider} shadow` : 'AI off';
  elements.aiModeBadge.className = `badge ${aiMode === 'active' ? 'active' : aiMode === 'shadow' ? 'demo' : 'neutral'}`;
  elements.providerName.textContent = state.meta.provider;
  elements.bookmakerName.textContent = state.meta.bookmaker;
  elements.preflightSource.textContent = state.meta.provider;
  elements.demoNotice.classList.toggle('hidden', state.meta.mode !== 'demo');
  const snapshot = state.meta.snapshot;
  elements.snapshotNotice.classList.toggle('hidden', !snapshot);
  if (snapshot) {
    elements.modeBadge.textContent = 'Live · snapshot';
    const aiNote = state.meta.ai?.provider === 'claude'
      ? (aiMode === 'active' ? ' Gli agenti AI sono eseguiti da Claude quando avvii un’analisi: al primo uso Claude chiede il consenso e l’analisi può richiedere uno o due minuti.' : ' Gli agenti AI richiedono il runtime Claude (Artifact): qui vale la baseline statistica.')
      : '';
    elements.snapshotNotice.innerHTML = `<strong>Dati reali ${escapeHtml(snapshot.source)}.</strong> Snapshot del ${escapeHtml(formatDateTime(snapshot.generatedAt))}: ${snapshot.fixtures} partite in ${snapshot.competitions} competizioni, con classifiche, forma, scontri diretti, notizie e quote DraftKings. ${escapeHtml(snapshot.note)}${escapeHtml(aiNote)}`;
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
    const payload = await request(`/api/fixtures?${query}`);
    state.fixtures = payload.fixtures || [];
    elements.lastUpdate.textContent = `Aggiornato ${formatDateTime(payload.updatedAt, { dateStyle: 'short' })}`;
    populateFilters();
    populateTopPicksDates();
    renderFixtures();
    elements.fixtureCount.textContent = state.fixtures.length;
    elements.leagueCount.textContent = new Set(state.fixtures.map((fixture) => fixture.league.id)).size;
    elements.appStatus.textContent = `Calendario aggiornato: ${state.fixtures.length} partite disponibili.`;
  } catch (error) {
    elements.fixturesError.textContent = error.message;
    elements.fixturesError.classList.remove('hidden');
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
  elements.leagueFilter.innerHTML = '<option value="">Tutte</option>' + leagues.map(([id, name]) => `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`).join('');
  elements.dateFilter.innerHTML = '<option value="">Tutte</option>' + dates.map((date) => `<option value="${date}">${escapeHtml(dateLabel(`${date}T12:00:00Z`))}</option>`).join('');
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
  elements.topPicksDate.innerHTML = dates.map((date) => `<option value="${date}">${escapeHtml(dateLabel(`${date}T12:00:00Z`))} · ${grouped.get(date)} partite</option>`).join('');
  if (dates.includes(current)) elements.topPicksDate.value = current;
  else elements.topPicksDate.value = dates.find((date) => grouped.get(date) >= 5) || dates[0] || '';
}

function filteredFixtures() {
  const query = elements.searchInput.value.trim().toLocaleLowerCase('it');
  const league = elements.leagueFilter.value;
  const date = elements.dateFilter.value;
  return state.fixtures.filter((fixture) => {
    const haystack = `${fixture.home.name} ${fixture.away.name} ${fixture.league.name} ${fixture.league.country}`.toLocaleLowerCase('it');
    return (!query || haystack.includes(query))
      && (!league || String(fixture.league.id) === league)
      && (!date || dateKey(fixture.kickoff) === date);
  });
}

function renderFixtures() {
  const fixtures = filteredFixtures();
  elements.filteredCount.textContent = fixtures.length;
  if (!fixtures.length) {
    elements.fixtureList.innerHTML = '<div class="loading-card"><p>Nessuna partita corrisponde ai filtri.</p></div>';
    return;
  }
  let previousDate = '';
  elements.fixtureList.innerHTML = fixtures.map((fixture) => {
    const date = dateKey(fixture.kickoff);
    const divider = date !== previousDate ? `<div class="date-divider">${escapeHtml(dateLabel(fixture.kickoff))}</div>` : '';
    previousDate = date;
    const active = String(state.selected?.id) === String(fixture.id);
    const time = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: state.meta.timezone }).format(new Date(fixture.kickoff));
    return `${divider}<button class="fixture-card ${active ? 'active' : ''}" type="button" role="option" aria-selected="${active}" data-fixture-id="${escapeHtml(fixture.id)}">
      <span class="fixture-league"><span>${escapeHtml(fixture.league.name)}</span><span>${escapeHtml(fixture.league.round || '')}</span></span>
      <span class="fixture-teams"><strong>${escapeHtml(fixture.home.name)}</strong><span class="fixture-time">${time}</span><strong>${escapeHtml(fixture.away.name)}</strong></span>
    </button>`;
  }).join('');
  elements.fixtureList.querySelectorAll('[data-fixture-id]').forEach((button) => button.addEventListener('click', () => selectFixture(button.dataset.fixtureId)));
}

function renderTopPicks(payload) {
  const { coverage, picks, simulation } = payload;
  const accumulator = simulation.accumulator;
  const singles = simulation.singles;
  const incomplete = !coverage.complete
    ? `<div class="top-picks-warning">Disponibili ${coverage.returnedPicks} esiti idonei su ${payload.limit} richiesti. Gare senza quote o analisi non completate sono state escluse.</div>`
    : '';
  const rows = picks.map((pick) => `<tr data-top-fixture-id="${escapeHtml(pick.fixture.id)}" tabindex="0" role="button" aria-label="Apri analisi ${escapeHtml(pick.fixture.home.name)} contro ${escapeHtml(pick.fixture.away.name)}" title="Apri l'analisi della partita">
    <td>${pick.rank}</td>
    <td class="top-pick-match"><strong>${escapeHtml(pick.fixture.home.name)} — ${escapeHtml(pick.fixture.away.name)}</strong><span>${escapeHtml(pick.fixture.league.name)} · ${escapeHtml(pick.fixture.league.round || '')}</span></td>
    <td><span class="market-tag">${escapeHtml(pick.selection.label)}</span></td>
    <td class="numeric"><strong>${percent(pick.selection.probability)}</strong></td>
    <td class="numeric"><strong>${decimal(pick.selection.odd)}</strong></td>
    <td class="numeric ${probabilityClass(pick.selection.edge)}">${pick.selection.edge == null ? '—' : `${pick.selection.edge >= 0 ? '+' : ''}${percent(pick.selection.edge)}`}</td>
    <td class="numeric">${pick.confidence}/100</td>
  </tr>`).join('');
  elements.topPicksResult.innerHTML = `
    <div class="top-picks-summary">
      <div><h3>Top ${picks.length} · ${escapeHtml(dateLabel(`${payload.date}T12:00:00Z`))}</h3><p>${coverage.availableFixtures} disponibili · ${coverage.scannedFixtures} scansionate · ${coverage.analyzedFixtures} analizzate · ${coverage.eligibleFixtures} con quota valida · ${escapeHtml(payload.bookmaker || 'bookmaker non disponibile')}</p></div>
      <span class="count-pill">${picks.length} esiti</span>
    </div>
    <div class="top-picks-table-wrap"><table class="data-table top-picks-table"><caption>Classifica Top Picks risk-adjusted</caption><thead><tr><th>#</th><th>Partita</th><th>Esito</th><th class="numeric">Prob.</th><th class="numeric">Quota</th><th class="numeric">Edge</th><th class="numeric">Conf.</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${incomplete}
    ${accumulator && singles ? `<div class="top-ticket-grid">
      <article class="top-ticket-card"><span>Multipla · importo ${currency(simulation.stake)}</span><strong>Quota ${decimal(accumulator.combinedOdd, 3)}</strong><dl><dt>Probabilità modello</dt><dd>${percent(accumulator.modelProbability, 2)}</dd><dt>Ritorno potenziale</dt><dd>${currency(accumulator.potentialGrossReturn)}</dd><dt>Profitto potenziale</dt><dd>${currency(accumulator.potentialNetProfit)}</dd></dl></article>
      <article class="top-ticket-card"><span>Valore atteso multipla</span><strong class="${accumulator.expectedNetProfit >= 0 ? 'signal-positive' : 'signal-negative'}">${currency(accumulator.expectedNetProfit)}</strong><dl><dt>Ritorno atteso</dt><dd>${currency(accumulator.expectedGrossReturn)}</dd><dt>ROI atteso</dt><dd>${percent(accumulator.expectedRoi)}</dd><dt>Prob. quota grezza</dt><dd>${percent(accumulator.bookmakerRawProbability, 2)}</dd></dl></article>
      <article class="top-ticket-card"><span>Simulazione singole</span><strong>${currency(singles.stakePerSelection)} cad.</strong><dl><dt>Ritorno atteso</dt><dd>${currency(singles.expectedGrossReturn)}</dd><dt>Profitto atteso</dt><dd class="${singles.expectedNetProfit >= 0 ? 'signal-positive' : 'signal-negative'}">${currency(singles.expectedNetProfit)}</dd><dt>ROI atteso</dt><dd>${percent(singles.expectedRoi)}</dd></dl></article>
    </div>` : ''}
    <p class="top-ticket-note">${escapeHtml(simulation.assumptions.join(' '))}</p>
    <p class="top-ticket-note">AI Top Picks: ${payload.ai?.topPicksAiEnabled ? `shortlist ${payload.ai.shortlistSize}, modo ${escapeHtml(payload.ai.mode)}` : 'disattivata per default sui ranking giornalieri'}.</p>`;
  elements.topPicksResult.classList.remove('hidden');
  elements.topPicksResult.querySelectorAll('[data-top-fixture-id]').forEach((row) => {
    const openFixture = () => {
      const fixture = state.fixtures.find((item) => String(item.id) === String(row.dataset.topFixtureId));
      if (fixture) {
        selectFixture(fixture.id);
        activateTab('analysis');
      }
    };
    row.addEventListener('click', openFixture);
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openFixture();
      }
    });
  });
}

async function loadTopPicks() {
  const date = elements.topPicksDate.value;
  const limit = Number(document.querySelector('input[name="topLimit"]:checked')?.value || 5);
  const stake = Number(elements.topPicksStake.value);
  elements.topPicksError.classList.add('hidden');
  elements.topPicksResult.classList.add('hidden');
  if (!date) {
    elements.topPicksError.textContent = 'Seleziona una data con partite disponibili.';
    elements.topPicksError.classList.remove('hidden');
    return;
  }
  if (!Number.isFinite(stake) || stake < 1 || stake > 10000) {
    elements.topPicksError.textContent = 'Inserisci un importo compreso tra 1 e 10.000 euro.';
    elements.topPicksError.classList.remove('hidden');
    return;
  }
  elements.topPicksButton.disabled = true;
  elements.topPicksLoading.classList.remove('hidden');
  elements.appStatus.textContent = 'Generazione Top Picks in corso.';
  try {
    state.topPicks = await request('/api/top-picks', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ date, limit, stake }),
      timeout: 180000
    });
    renderTopPicks(state.topPicks);
    elements.appStatus.textContent = `Top ${state.topPicks.picks.length} generata.`;
  } catch (error) {
    elements.topPicksError.textContent = error.message;
    elements.topPicksError.classList.remove('hidden');
  } finally {
    elements.topPicksLoading.classList.add('hidden');
    elements.topPicksButton.disabled = false;
  }
}

function detectNeutral(fixture) {
  return /world cup|mondiale|european championship|europei|copa am[eé]rica|club world cup/i.test(fixture.league.name)
    && /final|semi|quarter|round|ottavi|quarti/i.test(fixture.league.round || '');
}

function selectFixture(id) {
  state.analysisRequestSerial += 1;
  stopLoading();
  state.selected = state.fixtures.find((fixture) => String(fixture.id) === String(id));
  state.analysis = null;
  renderFixtures();
  elements.emptyState.classList.add('hidden');
  elements.analysisResult.classList.add('hidden');
  elements.analysisError.classList.add('hidden');
  elements.selectionState.classList.remove('hidden');
  elements.selectedLeague.textContent = `${state.selected.league.name} · ${state.selected.league.round || 'Turno da confermare'}`;
  elements.selectedTitle.textContent = `${state.selected.home.name} — ${state.selected.away.name}`;
  elements.selectedMeta.textContent = `${formatDateTime(state.selected.kickoff)} · ${state.selected.venue}`;
  elements.neutralToggle.checked = detectNeutral(state.selected);
  document.querySelector('.analysis-stage').classList.add('has-selection');
  // stopLoading() viene eseguito prima che state.selected sia valorizzato: riabilita qui il pulsante.
  elements.analyzeButton.disabled = !state.selected;
}

const loadingSteps = [
  'Acquisizione e qualità dei dati…', 'Entity resolution e feature engineering…',
  'Valutazione forma e forza delle squadre…', 'Modello Poisson/Dixon–Coles…',
  'Simulazione Monte Carlo…', 'Confronto con le quote…',
  'Ensemble e calibrazione…', 'Agenti AI: disponibilità, tattica, news, competizione…',
  'Challenge & Bias Detection…', 'Final Explanation e audit finale…'
];

function startLoading() {
  let index = 0;
  elements.selectionState.classList.add('hidden');
  elements.analysisResult.classList.add('hidden');
  elements.analysisError.classList.add('hidden');
  elements.analysisLoading.classList.remove('hidden');
  elements.appStatus.textContent = 'Analisi enterprise in corso.';
  elements.loadingStep.textContent = loadingSteps[0];
  elements.loadingProgress.style.width = '8%';
  elements.analysisProgress.setAttribute('aria-valuenow', '8');
  elements.analyzeButton.disabled = true;
  clearInterval(state.loadingTimer);
  state.loadingTimer = setInterval(() => {
    index = Math.min(index + 1, loadingSteps.length - 1);
    elements.loadingStep.textContent = loadingSteps[index];
    const progress = Math.round(10 + (index + 1) / loadingSteps.length * 86);
    elements.loadingProgress.style.width = `${progress}%`;
    elements.analysisProgress.setAttribute('aria-valuenow', String(progress));
  }, state.meta?.ai?.effectiveMode === 'active' ? 7000 : 650);
}

function stopLoading() {
  clearInterval(state.loadingTimer);
  elements.analysisLoading.classList.add('hidden');
  elements.analyzeButton.disabled = !state.selected;
}

async function analyzeSelected() {
  if (!state.selected) return;
  const requestSerial = ++state.analysisRequestSerial;
  const fixtureId = state.selected.id;
  startLoading();
  try {
    const analysis = await request('/api/analyze', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fixtureId, neutral: elements.neutralToggle.checked }),
      timeout: 300000
    });
    if (requestSerial !== state.analysisRequestSerial || String(state.selected?.id) !== String(fixtureId)) return;
    state.analysis = analysis;
    renderAnalysis(state.analysis);
    elements.analysisResult.classList.remove('hidden');
    elements.appStatus.textContent = 'Analisi completata.';
  } catch (error) {
    if (requestSerial !== state.analysisRequestSerial) return;
    elements.analysisError.innerHTML = `<strong>Analisi non completata.</strong><p>${escapeHtml(error.message)}</p><button id="retryAnalysis" class="primary-button" type="button">Riprova</button>`;
    elements.analysisError.classList.remove('hidden');
    document.getElementById('retryAnalysis')?.addEventListener('click', analyzeSelected);
  } finally {
    if (requestSerial === state.analysisRequestSerial) stopLoading();
  }
}

function probabilityClass(edge) {
  if (edge == null) return '';
  if (edge >= 0.025) return 'signal-positive';
  if (edge <= -0.025) return 'signal-negative';
  return '';
}

function renderMarkets(markets) {
  return `<table class="data-table"><caption>Probabilità modello e benchmark quote</caption><thead><tr><th>Mercato</th><th class="numeric">Modello</th><th class="numeric">Quota</th><th class="numeric">Benchmark</th><th class="numeric">Edge</th></tr></thead><tbody>${markets.map((market) => `<tr>
    <td><span class="market-tag">${escapeHtml(market.label)}</span></td>
    <td class="numeric"><strong>${percent(market.probability)}</strong></td>
    <td class="numeric">${market.odd ? decimal(market.odd) : '—'}</td>
    <td class="numeric">${market.marketProbability == null ? '—' : percent(market.marketProbability)}</td>
    <td class="numeric ${probabilityClass(market.edge)}">${market.edge == null ? '—' : `${market.edge >= 0 ? '+' : ''}${percent(market.edge)}`}</td>
  </tr>`).join('')}</tbody></table>`;
}

function renderObservedLayer(layer) {
  const observed = layer?.observed || {};
  const labels = {
    fixture: 'Fixture',
    seasonStatistics: 'Statistiche stagionali',
    recentForm: 'Forma recente',
    injuries: 'Indisponibili',
    lineups: 'Formazioni ufficiali',
    odds: 'Quote',
    news: 'News',
    competitionRules: 'Regolamento'
  };
  return Object.entries(labels).map(([key, label]) => `<li><strong>${label}</strong><span class="${observed[key] ? 'signal-positive' : 'signal-muted'}">${observed[key] ? 'Osservato' : 'Mancante'}</span></li>`).join('');
}

function renderAiTrace(trace) {
  if (!trace) return '<p class="muted">Nessuna traccia AI disponibile.</p>';
  const visibleAgents = [...(trace.agents || []), ...(trace.challenge ? [trace.challenge] : [])];
  const agentRows = visibleAgents.map((agent) => `<article class="ai-agent-card">
    <span>${escapeHtml(agent.status)}${agent.cacheHit ? ' · cache' : ''}</span>
    <strong>${escapeHtml(agent.label || agent.agentId)}</strong>
    <p>${escapeHtml(agent.summary || 'Nessun output qualitativo applicato.')}</p>
    <small>${agent.provider ? `${escapeHtml(agent.provider)} · ${escapeHtml(agent.model || 'modello non indicato')} · ` : ''}${(agent.effects || []).length} effetti proposti · ${(agent.unsupportedClaims || []).length} claim non supportati</small>
  </article>`).join('');
  const decisions = trace.adjustmentPolicy?.decisions || [];
  const decisionRows = decisions.length ? decisions.map((item) => `<tr>
    <td>${escapeHtml(item.agentId)}</td><td>${escapeHtml(item.target)}</td><td class="numeric">${decimal(item.rawRequested ?? item.requested, 3)}</td><td class="numeric">${decimal(item.requested, 3)}</td><td class="numeric">${decimal(item.cappedBeforeGlobalScale ?? item.applied, 3)}</td><td class="numeric">${decimal(item.applied, 3)}</td><td>${escapeHtml(item.reason)}</td>
  </tr>`).join('') : '<tr><td colspan="7">Nessun aggiustamento AI applicabile.</td></tr>';
  return `<div class="ai-trace">
    <div class="ai-mode-line"><span class="badge ${trace.applied ? 'active' : 'neutral'}">${escapeHtml(trace.provider || 'AI')} · ${escapeHtml(trace.mode || 'off')}</span><p>${escapeHtml(trace.audit?.modeNote || 'AI non applicata ai numeri finali.')}</p></div>
    <div class="ai-agent-grid">${agentRows || '<p class="muted">Agenti AI non eseguiti.</p>'}</div>
    <div class="table-scroll"><table class="data-table adjustment-table"><caption>Decisioni backend: richiesta, deduplicazione evidenze, cap e valore finale</caption><thead><tr><th>Agente</th><th>Target</th><th class="numeric">Richiesto</th><th class="numeric">Dopo dedup</th><th class="numeric">Cap agente</th><th class="numeric">Finale</th><th>Decisione</th></tr></thead><tbody>${decisionRows}</tbody></table></div>
    <p class="muted">Shift massimo probabilità: ${percent(trace.adjustmentPolicy?.probabilityShift || 0)} su limite ${percent(trace.adjustmentPolicy?.maxProbabilityShift || 0)}.</p>
  </div>`;
}

function renderProgression(analysis) {
  const progression = analysis.progression;
  if (!progression?.format?.knockout) return '';
  if (!progression.applicable) {
    const reason = progression.reason === 'competition_rules_unconfirmed'
      ? 'Regolamento non confermato: supplementari, rigori e qualificazione non vengono stimati.'
      : 'Serve il punteggio aggregato dell’andata per stimare la qualificazione.';
    return `<section class="section-card"><div class="section-title"><div><h3>Qualificazione</h3><p>Separata dall’esito nei 90 minuti.</p></div></div><div class="section-body"><div class="decision-state caution"><strong>Stima sospesa</strong><span>${escapeHtml(reason)}</span></div></div></section>`;
  }
  return `<section class="section-card"><div class="section-title"><div><h3>Supplementari, rigori e qualificazione</h3><p>Modello per gara secca; il pareggio 1X2 resta riferito ai 90 minuti.</p></div></div><div class="section-body"><div class="progression-grid">
    <article><span>Tempi supplementari</span><strong>${percent(progression.extraTime)}</strong></article>
    <article><span>Calci di rigore</span><strong>${percent(progression.penalties)}</strong></article>
    <article><span>Qualificazione ${escapeHtml(analysis.fixture.home.name)}</span><strong>${percent(progression.qualification.home)}</strong></article>
    <article><span>Qualificazione ${escapeHtml(analysis.fixture.away.name)}</span><strong>${percent(progression.qualification.away)}</strong></article>
  </div><p class="muted">${escapeHtml(progression.penaltySplitAssumption)}</p></div></section>`;
}

function renderTimeline(analysis) {
  const timeline = analysis.timeline;
  const leader = timeline.halfTimeLeader === 'home' ? analysis.fixture.home.name : timeline.halfTimeLeader === 'away' ? analysis.fixture.away.name : 'Pareggio';
  return `<section class="section-card"><div class="section-title"><div><h3>Andamento temporale</h3><p>Baseline trasparente a intensità omogenea.</p></div></div><div class="section-body"><div class="timeline-grid">
    <article><span>Gol 0’–15’</span><strong>${percent(timeline.first15Goal)}</strong></article>
    <article><span>Pareggio intervallo</span><strong>${percent(timeline.halfTimeDraw)}</strong></article>
    <article><span>Esito HT più probabile</span><strong>${escapeHtml(leader)}</strong></article>
    <article><span>Gol dopo il 75’</span><strong>${percent(timeline.after75Goal)}</strong></article>
  </div><p class="muted">${escapeHtml(timeline.caveat)}</p></div></section>`;
}

function renderLayerReport(analysis) {
  const layers = analysis.layers || {};
  const explanation = layers.qualitativeAssessments?.explanation || {};
  const unconfirmed = layers.unconfirmedInferences || [];
  return `<section class="section-card"><div class="section-title"><div><h3>Separazione dei layer</h3><p>Dati reali, modello statistico, agenti AI, inferenze e raccomandazione restano tracciati separatamente.</p></div></div><div class="section-body">
    <div class="layer-grid">
      <article><h4>Dati osservati dal provider</h4><ul class="compact-list">${renderObservedLayer(layers.realData)}</ul><p class="muted">Provider: ${escapeHtml(layers.realData?.provider || 'non disponibile')} · dataVersion ${escapeHtml(analysis.dataVersion?.slice(0, 10) || '—')}</p></article>
      <article><h4>Baseline statistica</h4><p>${escapeHtml(layers.statisticalBaseline?.summary?.recommendation?.label || analysis.summary.recommendation.label)}</p><p class="muted">xG base ${decimal(layers.statisticalBaseline?.summary?.xg?.home)}–${decimal(layers.statisticalBaseline?.summary?.xg?.away)} · confidenza ${layers.statisticalBaseline?.summary?.confidence || analysis.summary.confidence}/100</p></article>
      <article><h4>Raccomandazione finale</h4><p><strong>${escapeHtml(layers.finalRecommendation?.label || analysis.summary.recommendation.label)}</strong></p><p class="muted">Probabilità ${percent(layers.finalRecommendation?.probability || analysis.summary.recommendation.probability)} · xG ${decimal(analysis.summary.xg.home)}–${decimal(analysis.summary.xg.away)}</p></article>
    </div>
    <div class="explanation-box"><h4>${escapeHtml(explanation.headline || 'Spiegazione finale')}</h4><p>${escapeHtml(explanation.executiveSummary || 'Spiegazione AI non disponibile.')}</p><p>${escapeHtml(explanation.riskSummary || '')}</p>${explanation.provider ? `<small>${escapeHtml(explanation.provider)} · ${escapeHtml(explanation.model || 'modello non indicato')}</small>` : ''}</div>
    <div class="unconfirmed-box"><h4>Inferenze non confermate</h4>${unconfirmed.length ? `<ul>${unconfirmed.map((item) => `<li><strong>${escapeHtml(item.agentId)}</strong>: ${escapeHtml(item.claim)}</li>`).join('')}</ul>` : '<p class="muted">Nessuna inferenza non confermata pubblicata dagli agenti.</p>'}</div>
    ${renderAiTrace(layers.qualitativeAssessments)}
  </div></section>`;
}

function renderAnalysis(analysis) {
  const { fixture, summary, governance } = analysis;
  const agents = analysis.agents.filter((agent) => agent.active);
  const missingAgents = analysis.agents.filter((agent) => !agent.active);
  const riskItems = [...governance.riskFlags, ...governance.challenge];
  const recommendation = summary.recommendation;
  const decisionLabel = recommendation.hasValue ? 'Segnale con valore rilevato' : 'Nessun vantaggio quota sufficiente';
  elements.analysisResult.innerHTML = `
    <section class="result-top">
      <div class="result-match">
        <div><p class="eyebrow">${escapeHtml(fixture.league.name)} · ${escapeHtml(fixture.league.round || '')}</p><h2>${escapeHtml(fixture.home.name)} — ${escapeHtml(fixture.away.name)}</h2></div>
        <div class="result-side"><div class="confidence"><i></i>Confidenza ${escapeHtml(summary.confidenceLabel)} · ${summary.confidence}/100</div>
          <div class="result-actions"><button class="secondary-button" type="button" data-result-action="json">Esporta JSON</button><button class="secondary-button" type="button" data-result-action="print">Stampa / PDF</button></div></div>
      </div>
      <div class="recommendation">
        <div class="recommendation-main"><span>INDICAZIONE PRINCIPALE</span><h3>${escapeHtml(recommendation.label)}</h3><div class="decision-state ${recommendation.hasValue ? 'positive' : 'caution'}"><strong>${decisionLabel}</strong><span>${escapeHtml(recommendation.status)}</span></div><p>Intervallo: ${percent(recommendation.interval[0])}–${percent(recommendation.interval[1])}${recommendation.edge == null ? '' : ` · Edge ${recommendation.edge >= 0 ? '+' : ''}${percent(recommendation.edge)}`}</p></div>
        <div class="probability-ring"><div><strong>${percent(recommendation.probability, 0)}</strong><span>probabilità modello</span></div></div>
      </div>
      <div class="probability-strip"><div><span>1 · ${escapeHtml(fixture.home.name)} · 90’</span><strong>${percent(summary.outcomes.home)}</strong></div><div><span>X · Pareggio · 90’</span><strong>${percent(summary.outcomes.draw)}</strong></div><div><span>2 · ${escapeHtml(fixture.away.name)} · 90’</span><strong>${percent(summary.outcomes.away)}</strong></div></div>
    </section>

    <div class="metric-grid metric-grid-six">
      <article class="metric-card"><span>xG ${escapeHtml(fixture.home.name)}</span><strong>${decimal(summary.xg.home)}</strong></article>
      <article class="metric-card"><span>xG ${escapeHtml(fixture.away.name)}</span><strong>${decimal(summary.xg.away)}</strong></article>
      <article class="metric-card"><span>Score modale</span><strong>${escapeHtml(summary.exactScore.score)}</strong></article>
      <article class="metric-card"><span>Probabilità score</span><strong>${percent(summary.exactScore.probability)}</strong></article>
      <article class="metric-card"><span>Qualità dati</span><strong>${governance.dataQuality.score}/100</strong></article>
      <article class="metric-card"><span>Incertezza</span><strong>${escapeHtml(summary.uncertainty.level)}</strong></article>
    </div>

    ${renderLayerReport(analysis)}

    ${renderProgression(analysis)}

    ${renderTimeline(analysis)}

    <section class="section-card"><div class="section-title"><div><h3>Mercati richiesti</h3><p>Probabilità del modello confrontate con ${escapeHtml(governance.bookmaker || 'quote non disponibili')}.</p></div></div><div class="section-body">${renderMarkets(analysis.markets)}</div></section>

    <div class="two-column">
      <section class="section-card"><div class="section-title"><div><h3>Risultati esatti</h3><p>Distribuzione e contributo al rispettivo esito 1X2.</p></div></div><div class="section-body"><div class="table-scroll"><table class="data-table"><thead><tr><th>#</th><th>Risultato</th><th>Esito</th><th class="numeric">Probabilità</th><th class="numeric">Quota esito</th></tr></thead><tbody>${analysis.exactScores.map((item) => `<tr><td>${item.rank}</td><td><strong>${item.score}</strong></td><td>${item.outcome}</td><td class="numeric">${percent(item.probability)}</td><td class="numeric">${percent(item.contributionToOutcome)}</td></tr>`).join('')}</tbody></table></div></div></section>
      <section class="section-card"><div class="section-title"><div><h3>Fattori decisivi</h3><p>Direzione, intensità e qualità dell’evidenza.</p></div></div><div class="section-body"><ul class="factor-list">${analysis.factors.map((factor) => `<li><strong>${escapeHtml(factor.name)}</strong><span>${escapeHtml(factor.direction)}</span><small>Impatto ${escapeHtml(factor.intensity)} · certezza ${escapeHtml(factor.certainty)}</small></li>`).join('')}</ul></div></section>
    </div>

    <section class="section-card"><div class="section-title"><div><h3>Scenari alternativi</h3><p>Sensibilità a condizioni favorevoli per le due squadre.</p></div></div><div class="section-body"><div class="scenario-grid">${analysis.scenarios.map((scenario) => `<article class="scenario"><strong>${escapeHtml(scenario.name)}</strong><p><span>xG</span><b>${decimal(scenario.xg.home)}–${decimal(scenario.xg.away)}</b></p><p><span>1 / X / 2</span><b>${percent(scenario.probabilities.home, 0)} · ${percent(scenario.probabilities.draw, 0)} · ${percent(scenario.probabilities.away, 0)}</b></p><p><span>Goal</span><b>${percent(scenario.markets.goal)}</b></p><p><span>Over 2.5</span><b>${percent(scenario.markets.over25)}</b></p></article>`).join('')}</div></div></section>

    <div class="two-column">
      <section class="section-card"><div class="section-title"><div><h3>Agenti e pesi</h3><p>Solo i blocchi con dati disponibili entrano nell’ensemble.</p></div></div><div class="section-body"><ul class="agent-list">${agents.map((agent) => `<li><strong>${escapeHtml(agent.name)}</strong><span>Peso ${percent(agent.effectiveWeight, 0)}</span><small>1 ${percent(agent.probabilities.home, 0)} · X ${percent(agent.probabilities.draw, 0)} · 2 ${percent(agent.probabilities.away, 0)}</small></li>`).join('')}${missingAgents.map((agent) => `<li><strong>${escapeHtml(agent.name)}</strong><span>Escluso</span><small>Dati insufficienti.</small></li>`).join('')}</ul></div></section>
      <section class="section-card"><div class="section-title"><div><h3>Challenge & Risk Report</h3><p>Contestazioni applicate prima della pubblicazione.</p></div></div><div class="section-body"><ul class="risk-list">${riskItems.map((risk) => `<li>${escapeHtml(risk)}</li>`).join('')}</ul></div></section>
    </div>

    <section class="section-card"><div class="section-title"><div><h3>Processo multi-agente</h3><p>Ogni modulo dichiara se è operativo o escluso per mancanza di dati.</p></div></div><div class="section-body"><div class="workflow-grid">${analysis.workflow.map((agent) => `<article class="workflow-agent ${agent.active ? 'active' : 'inactive'}"><span>${agent.active ? 'Attivo' : 'Escluso'}</span><strong>${escapeHtml(agent.name)}</strong><p>${escapeHtml(agent.note)}</p></article>`).join('')}</div></div></section>

    <section class="section-card"><div class="section-title"><div><h3>Audit sintetico</h3><p>Tracciabilità del calcolo e qualità dei dati.</p></div></div><div class="section-body"><table class="data-table"><tbody>
      <tr><td>Simulazioni</td><td class="numeric"><strong>${analysis.simulation.runs.toLocaleString('it-IT')}</strong></td></tr>
      <tr><td>Qualità dati</td><td class="numeric"><strong>${governance.dataQuality.score}/100</strong></td></tr>
      <tr><td>Consenso agenti</td><td class="numeric"><strong>${percent(governance.consensus)}</strong></td></tr>
      <tr><td>Robustezza</td><td class="numeric"><strong>${percent(governance.robustness)}</strong></td></tr>
      <tr><td>Entropia normalizzata</td><td class="numeric"><strong>${percent(summary.uncertainty.normalizedEntropy)}</strong></td></tr>
      <tr><td>Rischio non-vittoria favorita</td><td class="numeric"><strong>${percent(summary.uncertainty.favoriteNonWinRisk)}</strong></td></tr>
      <tr><td>Calibrazione empirica</td><td class="numeric"><strong>${governance.calibration?.empiricallyBacktested ? 'Attiva' : 'Non ancora disponibile'}</strong></td></tr>
      <tr><td>Formazioni ufficiali</td><td class="numeric"><strong>${analysis.context.lineupsConfirmed ? 'Sì' : 'No'}</strong></td></tr>
      <tr><td>Campo neutro applicato</td><td class="numeric"><strong>${analysis.options.neutral ? 'Sì' : 'No'}</strong></td></tr>
      <tr><td>Quote aggiornate</td><td class="numeric"><strong>${governance.oddsUpdatedAt ? escapeHtml(formatDateTime(governance.oddsUpdatedAt)) : 'Non disponibili'}</strong></td></tr>
    </tbody></table><p class="muted">${escapeHtml(governance.disagreements.join(' '))}</p></div></section>
    <div class="audit-footer"><span>${escapeHtml(governance.disclaimer)}</span><span>Analisi ${escapeHtml(formatDateTime(analysis.generatedAt))}${analysis.cached ? ' · cache' : ''}</span></div>`;
  elements.analysisResult.querySelector('[data-result-action="json"]')?.addEventListener('click', () => {
    const name = `analisi-${slug(`${fixture.home.name}-${fixture.away.name}`)}-${dateKey(analysis.generatedAt)}.json`;
    downloadFile(name, JSON.stringify(analysis, null, 2), 'application/json').catch((error) => { elements.appStatus.textContent = error.message; });
  });
  const printButton = elements.analysisResult.querySelector('[data-result-action="print"]');
  // window.print() non funziona dentro un Artifact: il pulsante resta solo dove la stampa è possibile.
  if (claudeRuntime) printButton?.remove();
  else printButton?.addEventListener('click', () => window.print());
}

function slug(value) {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'export';
}

// Dentro un Artifact claude.ai i download diretti sono bloccati: si usa la capability `downloads` (conferma del viewer).
const claudeRuntime = typeof window.claude?.use === 'function';

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
  const url = URL.createObjectURL(new Blob([content], { type: `${type};charset=utf-8` }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Performance ----------

const metric = (value, digits = 3) => (value == null ? '—' : decimal(value, digits));
const outcomeLabel = { home: '1', draw: 'X', away: '2' };

function skillText(value, against) {
  if (value == null) return 'Campione non disponibile';
  return `Brier ${value >= 0 ? 'migliore' : 'peggiore'} del ${percent(Math.abs(value), 1)} rispetto ${against}`;
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

function renderRecommendationCard(title, report) {
  const roi = report.flatStake.roi;
  return `<article class="top-ticket-card"><span>${escapeHtml(title)}</span><strong>${report.n ? `${report.hits}/${report.n} vinte` : 'Nessuna'}</strong><dl>
    <dt>Frequenza vincente</dt><dd>${report.hitRate == null ? '—' : percent(report.hitRate)}</dd>
    <dt>Probabilità media prevista</dt><dd>${report.averageProbability == null ? '—' : percent(report.averageProbability)}</dd>
    <dt>Brier binario</dt><dd>${metric(report.brier)}</dd>
    <dt>ROI puntata unitaria</dt><dd class="${roi == null ? '' : roi >= 0 ? 'signal-positive' : 'signal-negative'}">${roi == null ? '—' : `${roi >= 0 ? '+' : ''}${percent(roi)}`} · ${report.flatStake.bets} quote</dd>
  </dl></article>`;
}

function resultCell(record) {
  if (!record.result) return '<span class="signal-muted">In attesa</span>';
  if (record.result.void) return `<span class="signal-muted">Annullata (${escapeHtml(record.result.status)})</span>`;
  return `<strong>${record.result.goals.home}-${record.result.goals.away}</strong> <span class="muted">(${outcomeLabel[record.result.outcome]})</span>`;
}

function hitCell(record) {
  if (!record.result?.finished) return '—';
  const key = record.recommendation?.key;
  const { home, away } = record.result.goals;
  const outcome = record.result.outcome;
  const total = home + away;
  const checks = {
    '1': outcome === 'home', X: outcome === 'draw', '2': outcome === 'away', '1X': outcome !== 'away', X2: outcome !== 'home',
    GOAL: home > 0 && away > 0, NO_GOAL: home === 0 || away === 0, OVER_1_5: total > 1.5, UNDER_1_5: total < 1.5, OVER_2_5: total > 2.5, UNDER_2_5: total < 2.5
  };
  if (!(key in checks)) return '—';
  return checks[key] ? '<span class="signal-positive">Vinta</span>' : '<span class="signal-negative">Persa</span>';
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
  const recentRows = payload.recent.map((record) => `<tr>
    <td>${escapeHtml(formatDateTime(record.fixture.kickoff, { dateStyle: 'short' }))}</td>
    <td class="top-pick-match"><strong>${escapeHtml(record.fixture.home.name)} — ${escapeHtml(record.fixture.away.name)}</strong><span>${escapeHtml(record.fixture.league.name || '')}</span></td>
    <td class="numeric">${percent(record.outcomes.home, 0)} · ${percent(record.outcomes.draw, 0)} · ${percent(record.outcomes.away, 0)}</td>
    <td class="numeric">${resultCell(record)}</td>
    <td><span class="market-tag">${escapeHtml(record.recommendation?.label || '—')}</span></td>
    <td>${hitCell(record)}</td>
  </tr>`).join('');
  const upcomingRows = payload.upcoming.map((record) => `<tr>
    <td>${escapeHtml(formatDateTime(record.fixture.kickoff, { dateStyle: 'short' }))}</td>
    <td class="top-pick-match"><strong>${escapeHtml(record.fixture.home.name)} — ${escapeHtml(record.fixture.away.name)}</strong><span>${escapeHtml(record.fixture.league.name || '')}</span></td>
    <td class="numeric">${percent(record.outcomes.home, 0)} · ${percent(record.outcomes.draw, 0)} · ${percent(record.outcomes.away, 0)}</td>
    <td><span class="market-tag">${escapeHtml(record.recommendation?.label || '—')}</span></td>
    <td>${escapeHtml(formatDateTime(record.predictedAt))}</td>
  </tr>`).join('');
  const benchmarkRow = (name, set, note = '') => `<tr><td><strong>${escapeHtml(name)}</strong>${note ? `<br><small class="muted">${escapeHtml(note)}</small>` : ''}</td><td class="numeric">${set.n}</td><td class="numeric">${metric(set.brier)}</td><td class="numeric">${metric(set.logLoss)}</td><td class="numeric">${metric(set.rps)}</td><td class="numeric">${set.accuracy == null ? '—' : percent(set.accuracy)}</td></tr>`;
  const goalRow = (label, item) => `<tr><td>${label}</td><td class="numeric">${item.n}</td><td class="numeric">${item.averagePredicted == null ? '—' : percent(item.averagePredicted)}</td><td class="numeric">${item.observedRate == null ? '—' : percent(item.observedRate)}</td><td class="numeric">${metric(item.brier)}</td></tr>`;
  elements.performanceResult.innerHTML = `
    ${methodology.demo ? `<div class="notice" role="note"><strong>Storico dimostrativo.</strong> ${escapeHtml(methodology.demo)}</div>` : ''}
    <div class="metric-grid metric-grid-six">
      <article class="metric-card"><span>Partite valutate</span><strong>${evaluation.settled}</strong></article>
      <article class="metric-card"><span>In attesa di esito</span><strong>${pending}</strong></article>
      <article class="metric-card"><span>Brier 1X2 ↓</span><strong>${metric(model.brier)}</strong></article>
      <article class="metric-card"><span>Log loss ↓</span><strong>${metric(model.logLoss)}</strong></article>
      <article class="metric-card"><span>RPS ↓</span><strong>${metric(model.rps)}</strong></article>
      <article class="metric-card"><span>Calibrazione ECE ↓</span><strong>${evaluation.calibration.expectedCalibrationError == null ? '—' : percent(evaluation.calibration.expectedCalibrationError)}</strong></article>
    </div>
    ${evaluation.settled ? '' : '<div class="notice">Nessuna partita ancora conclusa tra quelle analizzate. Le metriche compaiono dopo il primo risultato acquisito.</div>'}
    <section class="section-card"><div class="section-title"><div><h3>Modello contro benchmark</h3><p>Valori più bassi sono migliori per Brier, log loss e RPS. Il mercato è valutato sullo stesso campione con quote registrate.</p></div></div><div class="section-body">
      <div class="table-scroll"><table class="data-table"><thead><tr><th>Previsore</th><th class="numeric">Partite</th><th class="numeric">Brier</th><th class="numeric">Log loss</th><th class="numeric">RPS</th><th class="numeric">Accuratezza</th></tr></thead><tbody>
        ${benchmarkRow('Motore (campione completo)', model)}
        ${benchmarkRow('Motore (campione con quote)', market.modelOnSameSample)}
        ${benchmarkRow('Mercato de-vig', market, 'Probabilità implicite delle quote 1X2')}
        ${benchmarkRow('Uniforme 1/3', uniform, 'Riferimento minimo')}
      </tbody></table></div>
      <div class="skill-row"><div class="decision-state ${evaluation.benchmarks.brierSkillVsUniform > 0 ? 'positive' : 'caution'}"><strong>Skill contro uniforme</strong><span>${skillText(evaluation.benchmarks.brierSkillVsUniform, 'al modello uniforme')}</span></div>
      <div class="decision-state ${market.brierSkillVsMarket > 0 ? 'positive' : 'caution'}"><strong>Skill contro mercato</strong><span>${skillText(market.brierSkillVsMarket, 'al mercato')}</span></div></div>
    </div></section>
    <div class="two-column">
      <section class="section-card"><div class="section-title"><div><h3>Calibrazione</h3><p>Punti sulla diagonale = probabilità affidabili. Dimensione proporzionale al campione.</p></div></div><div class="section-body calibration-body">${renderCalibrationChart(evaluation.calibration.bins)}
        <div class="table-scroll"><table class="data-table compact-table"><thead><tr><th>Fascia</th><th class="numeric">N</th><th class="numeric">Prevista</th><th class="numeric">Osservata</th></tr></thead><tbody>${evaluation.calibration.bins.filter((bin) => bin.n).map((bin) => `<tr><td>${Math.round(bin.from * 100)}–${Math.round(bin.to * 100)}%</td><td class="numeric">${bin.n}</td><td class="numeric">${percent(bin.meanPredicted)}</td><td class="numeric">${percent(bin.observedRate)}</td></tr>`).join('') || '<tr><td colspan="4">Nessun dato.</td></tr>'}</tbody></table></div>
      </div></section>
      <section class="section-card"><div class="section-title"><div><h3>Indicazioni principali</h3><p>Esito delle indicazioni pubblicate e rendimento a puntata unitaria.</p></div></div><div class="section-body">
        <div class="recommendation-grid">${renderRecommendationCard('Tutte le indicazioni', evaluation.recommendations.all)}${renderRecommendationCard('Solo segnali con valore', evaluation.recommendations.valueOnly)}</div>
        <div class="table-scroll"><table class="data-table compact-table"><caption>Mercati goal</caption><thead><tr><th>Mercato</th><th class="numeric">N</th><th class="numeric">Prevista media</th><th class="numeric">Osservata</th><th class="numeric">Brier</th></tr></thead><tbody>${goalRow('Over 2.5', evaluation.goalMarkets.OVER_2_5)}${goalRow('Goal', evaluation.goalMarkets.GOAL)}</tbody></table></div>
      </div></section>
    </div>
    <section class="section-card"><div class="section-title"><div><h3>Per competizione</h3><p>Campioni piccoli producono metriche instabili: interpretare con cautela sotto le 100 partite.</p></div></div><div class="section-body"><div class="table-scroll"><table class="data-table"><thead><tr><th>Competizione</th><th class="numeric">Partite</th><th class="numeric">Brier</th><th class="numeric">Log loss</th><th class="numeric">RPS</th><th class="numeric">Accuratezza</th></tr></thead><tbody>${evaluation.byCompetition.map((item) => benchmarkRow(item.name, item)).join('') || '<tr><td colspan="6">Nessuna partita valutata.</td></tr>'}</tbody></table></div></div></section>
    <section class="section-card"><div class="section-title"><div><h3>Ultimi esiti</h3><p>Previsione ufficiale (ultima pre-partita) confrontata con il risultato al 90'.</p></div></div><div class="section-body"><div class="table-scroll"><table class="data-table"><thead><tr><th>Data</th><th>Partita</th><th class="numeric">1 · X · 2</th><th class="numeric">Risultato</th><th>Indicazione</th><th>Esito</th></tr></thead><tbody>${recentRows || '<tr><td colspan="6">Nessun risultato acquisito.</td></tr>'}</tbody></table></div></div></section>
    <section class="section-card"><div class="section-title"><div><h3>Previsioni in attesa</h3><p>Registrate prima del calcio d'inizio; il risultato viene acquisito automaticamente dopo ${payload.ledger ? Math.round((state.meta?.predictionLedger?.settlementDelayMinutes || 150) / 60 * 10) / 10 : '—'} ore.</p></div></div><div class="section-body"><div class="table-scroll"><table class="data-table"><thead><tr><th>Calcio d'inizio</th><th>Partita</th><th class="numeric">1 · X · 2</th><th>Indicazione</th><th>Registrata</th></tr></thead><tbody>${upcomingRows || '<tr><td colspan="5">Nessuna previsione in attesa. Analizza una partita per registrarla.</td></tr>'}</tbody></table></div></div></section>
    <section class="section-card"><div class="section-title"><div><h3>Metodologia</h3><p>Regole fisse, verificabili ed esportabili.</p></div></div><div class="section-body"><ul class="risk-list">${['officialPrediction', 'horizon', 'metrics', 'benchmark', 'roi'].map((key) => `<li>${escapeHtml(methodology[key])}</li>`).join('')}</ul>
      <p class="muted">Registro: ${escapeHtml(ledger.storage)} · ${ledger.predictionsLogged} previsioni registrate · ${ledger.fixturesTracked} partite · ${ledger.voided} annullate${payload.settlement ? ` · ultimo controllo risultati ${escapeHtml(formatDateTime(payload.settlement.at))} (${payload.settlement.settled}/${payload.settlement.checked} acquisiti${payload.settlement.errors ? `, ${payload.settlement.errors} errori` : ''})` : ''}.</p></div></section>`;
  elements.performanceResult.classList.remove('hidden');
}

async function loadPerformance() {
  elements.performanceError.classList.add('hidden');
  elements.performanceLoading.classList.remove('hidden');
  elements.performanceRefresh.disabled = true;
  elements.appStatus.textContent = 'Valutazione performance in corso.';
  try {
    state.performance = await request('/api/performance', { timeout: 120000 });
    state.performanceLoaded = true;
    renderPerformance(state.performance);
    elements.appStatus.textContent = `Performance aggiornata: ${state.performance.evaluation?.settled ?? 0} partite valutate.`;
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
    await downloadFile(`registro-previsioni-${payload.mode}-${dateKey(new Date())}.csv`, `\ufeff${csv}`, 'text/csv');
  } catch (error) {
    elements.performanceError.textContent = error.message;
    elements.performanceError.classList.remove('hidden');
  } finally {
    elements.performanceExport.disabled = false;
  }
}

elements.refreshButton.addEventListener('click', () => loadFixtures(true));
elements.searchInput.addEventListener('input', renderFixtures);
elements.leagueFilter.addEventListener('change', renderFixtures);
elements.dateFilter.addEventListener('change', renderFixtures);
elements.topPicksForm.addEventListener('submit', (event) => {
  event.preventDefault();
  loadTopPicks();
});
elements.analyzeButton.addEventListener('click', analyzeSelected);

const tabs = [
  { name: 'analysis', tab: elements.analysisTab, view: elements.analysisView },
  { name: 'top', tab: elements.topPicksTab, view: elements.topPicksView },
  { name: 'performance', tab: elements.performanceTab, view: elements.performanceView },
  { name: 'settings', tab: elements.settingsTab, view: elements.settingsView }
].filter((item) => item.tab && (item.name !== 'settings' || globalThis.__FOOTBALL_ENGINE_STANDALONE__?.settings));

function activateTab(tabName) {
  for (const item of tabs) {
    const selected = item.name === tabName;
    item.tab.setAttribute('aria-selected', String(selected));
    item.tab.tabIndex = selected ? 0 : -1;
    item.view.hidden = !selected;
  }
  if (tabName === 'performance' && !state.performanceLoaded) loadPerformance();
  tabs.find((item) => item.name === tabName)?.view.focus?.();
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
    if (provider !== 'off' && !key && !deviceApp.settings.get().hasKey) {
      elements.settingsStatus.textContent = 'Inserisci la chiave API oppure scegli "Disattivati".';
      return;
    }
    try {
      deviceApp.settings.save({
        aiProvider: provider,
        ...(key ? { apiKey: key } : {}),
        aiMode: elements.settingsMode.value,
        daysAhead: Number(elements.settingsDays.value),
        leagues: [...elements.settingsLeagues.querySelectorAll('input:checked')].map((input) => input.value),
        autoTrack: elements.settingsAutoTrack.checked
      });
      elements.settingsStatus.textContent = 'Salvato. Riavvio…';
      setTimeout(() => location.reload(), 400);
    } catch {
      elements.settingsStatus.textContent = 'Impossibile salvare: archiviazione del browser non disponibile.';
    }
  });
  elements.settingsClearKey.addEventListener('click', () => {
    deviceApp.settings.clearKey();
    renderSettings();
    elements.settingsStatus.textContent = 'Chiave rimossa. Riavvia per applicare.';
  });
  elements.settingsTrackNow.addEventListener('click', async () => {
    elements.settingsTrackNow.disabled = true;
    elements.settingsStatus.textContent = 'Aggiornamento storico in corso: risultati e previsioni delle prossime 48 ore…';
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

async function boot() {
  try {
    await loadMeta();
    await loadFixtures();
    setInterval(() => loadFixtures(true), state.meta.autoRefreshMinutes * 60_000);
  } catch (error) {
    elements.fixturesLoading.classList.add('hidden');
    elements.fixturesError.textContent = error.message;
    elements.fixturesError.classList.remove('hidden');
  }
}

boot();
