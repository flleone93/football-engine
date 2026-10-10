export const AGENT_IDS = Object.freeze([
  'player_availability_impact',
  'tactical_context',
  'news_intelligence',
  'competition_context',
  'challenge_bias',
  'final_explanation'
]);

const effect = {
  type: 'object',
  additionalProperties: false,
  required: ['target', 'suggestedAdjustment', 'confidence', 'rationale', 'evidenceIndex'],
  properties: {
    target: { type: 'string', enum: ['home_xg', 'away_xg', 'confidence'] },
    suggestedAdjustment: { type: 'number', minimum: -0.5, maximum: 0.5 },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    rationale: { type: 'string', maxLength: 280 },
    evidenceIndex: { type: 'array', maxItems: 8, items: { type: 'integer', minimum: 0 } }
  }
};

export const assessmentSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['agentId', 'status', 'summary', 'confidence', 'evidence', 'effects', 'unsupportedClaims', 'riskFlags', 'needsRefresh'],
  properties: {
    agentId: { type: 'string', enum: AGENT_IDS },
    status: { type: 'string', enum: ['completed', 'insufficient_data'] },
    summary: { type: 'string', maxLength: 700 },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    evidence: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['source', 'claim', 'reliability'],
        properties: {
          source: { type: 'string', maxLength: 120 },
          claim: { type: 'string', maxLength: 280 },
          reliability: { type: 'string', enum: ['high', 'medium', 'low'] }
        }
      }
    },
    effects: { type: 'array', maxItems: 6, items: effect },
    unsupportedClaims: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 240 } },
    riskFlags: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 240 } },
    needsRefresh: { type: 'boolean' }
  }
};

export const explanationSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['agentId', 'status', 'headline', 'executiveSummary', 'modelExplanation', 'riskSummary', 'finalRecommendation', 'unsupportedClaims'],
  properties: {
    agentId: { type: 'string', enum: ['final_explanation'] },
    status: { type: 'string', enum: ['completed', 'insufficient_data'] },
    headline: { type: 'string', maxLength: 160 },
    executiveSummary: { type: 'string', maxLength: 900 },
    modelExplanation: { type: 'string', maxLength: 900 },
    riskSummary: { type: 'string', maxLength: 700 },
    finalRecommendation: { type: 'string', maxLength: 500 },
    unsupportedClaims: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 240 } }
  }
};

export const AGENT_SPECS = Object.freeze({
  player_availability_impact: {
    label: 'Player Availability & Impact Agent',
    model: 'default',
    schema: assessmentSchema,
    schemaName: 'player_availability_impact_output',
    maxXgDelta: 'maxPlayerXgDelta',
    prompt: 'Valuta solo disponibilita, infortuni, probabili titolarita e impatto dei giocatori usando esclusivamente i dati ricevuti. Non inventare formazioni, notizie o diagnosi. Se i dati non bastano, dichiara insufficient_data.'
  },
  tactical_context: {
    label: 'Tactical Context Agent',
    model: 'default',
    schema: assessmentSchema,
    schemaName: 'tactical_context_output',
    maxXgDelta: 'maxTacticalXgDelta',
    prompt: 'Valuta compatibilita tattica, ritmo e matchup collettivi solo dai dati disponibili. Non attribuire moduli o piani gara non presenti nei dati; segnala le ipotesi non supportate.'
  },
  news_intelligence: {
    label: 'News Intelligence Agent',
    model: 'default',
    schema: assessmentSchema,
    schemaName: 'news_intelligence_output',
    maxXgDelta: 'maxNewsXgDelta',
    prompt: 'Interpreta solo news, comunicati e fonti testuali presenti nel payload. Se non ci sono news verificabili, restituisci insufficient_data senza effetti.'
  },
  competition_context: {
    label: 'Competition Context Agent',
    model: 'default',
    schema: assessmentSchema,
    schemaName: 'competition_context_output',
    maxXgDelta: 'maxCompetitionXgDelta',
    prompt: 'Valuta formato competizione, motivazioni, andata/ritorno, campo neutro e qualificazione solo dalle informazioni fornite. Se il regolamento non e strutturato, dichiara i limiti.'
  },
  challenge_bias: {
    label: 'Challenge & Bias Detection Agent',
    model: 'challenge',
    schema: assessmentSchema,
    schemaName: 'challenge_bias_output',
    maxXgDelta: null,
    prompt: 'Contesta la previsione finale cercando bias, overconfidence, dati mancanti e contraddizioni. Puoi proporre solo penalita di confidenza tramite target confidence; non modificare xG.'
  },
  final_explanation: {
    label: 'Final Explanation Agent',
    model: 'explanation',
    schema: explanationSchema,
    schemaName: 'final_explanation_output',
    maxXgDelta: null,
    prompt: 'Scrivi una spiegazione finale chiara in italiano, separando dati osservati, modello statistico, valutazioni AI, inferenze non confermate e raccomandazione probabilistica. Non aggiungere dati nuovi.'
  }
});
