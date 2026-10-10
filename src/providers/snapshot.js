// Provider da snapshot: dati reali raccolti da una fonte live (ESPN) in un momento preciso e incorporati nella pagina.
// Usato dove la rete esterna non è raggiungibile (Artifact claude.ai, file HTML offline). Ogni dato porta il proprio timestamp.

const localDate = (value, timeZone) => new Intl.DateTimeFormat('sv-SE', { timeZone }).format(new Date(value));

export class SnapshotProvider {
  constructor(snapshot, { timezone = 'Europe/Rome', now = () => Date.now() } = {}) {
    if (!snapshot?.fixtures || !snapshot?.bundles) throw new Error('Snapshot dati non valido.');
    this.snapshot = snapshot;
    this.mode = 'live';
    this.timezone = timezone;
    this.now = now;
    const generated = new Intl.DateTimeFormat('it-IT', { dateStyle: 'short', timeStyle: 'short', timeZone: timezone }).format(new Date(snapshot.generatedAt));
    this.label = `${snapshot.source} · snapshot ${generated}`;
    this.snapshotInfo = {
      generatedAt: snapshot.generatedAt,
      source: snapshot.source,
      fixtures: snapshot.fixtures.length,
      competitions: new Set(snapshot.fixtures.map((fixture) => fixture.league.id)).size,
      note: 'Dati reali congelati al momento dello snapshot: quote e notizie successive non sono incluse.'
    };
  }

  /** Partite non ancora iniziate rispetto all'orologio di chi guarda (tolleranza 3 ore per le gare in corso). */
  async getFixtures() {
    const threshold = this.now() - 3 * 3600000;
    return this.snapshot.fixtures.filter((fixture) => Date.parse(fixture.kickoff) >= threshold);
  }

  async getFixturesByDate(date) {
    return (await this.getFixtures()).filter((fixture) => localDate(fixture.kickoff, this.timezone) === date);
  }

  async getAnalysisBundle(fixtureId) {
    const bundle = this.snapshot.bundles[String(fixtureId)];
    if (!bundle) throw Object.assign(new Error('Partita non presente nello snapshot.'), { code: 'not_found' });
    return structuredClone(bundle);
  }

  async getFixtureResult(fixtureId) {
    return this.snapshot.results?.[String(fixtureId)] || null;
  }
}
