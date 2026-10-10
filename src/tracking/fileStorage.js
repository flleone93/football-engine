// Storage JSONL append-only per il registro previsioni (solo server Node).
import fs from 'node:fs';
import path from 'node:path';

export class JsonlLedgerStorage {
  constructor(filePath) {
    this.kind = 'jsonl';
    this.filePath = path.resolve(filePath);
    this.corruptLines = 0;
  }

  load() {
    if (!fs.existsSync(this.filePath)) return [];
    const events = [];
    for (const line of fs.readFileSync(this.filePath, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line));
      } catch {
        // Una riga troncata (es. arresto durante la scrittura) non deve impedire l'avvio.
        this.corruptLines += 1;
      }
    }
    return events;
  }

  append(event) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.appendFileSync(this.filePath, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
  }
}
