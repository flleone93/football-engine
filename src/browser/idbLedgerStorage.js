// Storage a eventi nell'IndexedDB del dispositivo (app iPhone/PWA): registro previsioni e diario delle giocate.
// Gli eventi vengono letti una volta all'avvio; ogni scrittura restituisce una promessa che si risolve solo
// quando la transazione è davvero salvata (il diario la attende, il registro la lascia in background).
const STORE = 'events';

function request(operation) {
  return new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error);
  });
}

function memoryStorage(events) {
  return { kind: 'memory', load: () => events.slice(), append: (event) => { events.push(event); } };
}

function openDb(name) {
  const opening = indexedDB.open(name, 1);
  opening.onupgradeneeded = () => opening.result.createObjectStore(STORE, { autoIncrement: true });
  return request(opening);
}

function writeEvent(db, event) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Scrittura non riuscita.'));
    transaction.onabort = () => reject(transaction.error || new Error('Scrittura annullata.'));
    transaction.objectStore(STORE).add(event);
  });
}

export async function openIdbLedgerStorage({ name = 'football-engine-ledger', seedEvents = [] } = {}) {
  if (typeof indexedDB === 'undefined') return memoryStorage([...seedEvents]);
  try {
    let db = await openDb(name);
    let events = await request(db.transaction(STORE).objectStore(STORE).getAll());
    if (!events.length && seedEvents.length) {
      const transaction = db.transaction(STORE, 'readwrite');
      for (const event of seedEvents) transaction.objectStore(STORE).add(event);
      await new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); });
      events = [...seedEvents];
    }
    return {
      kind: 'indexeddb',
      load: () => events.slice(),
      async append(event) {
        try {
          await writeEvent(db, event);
        } catch (error) {
          // iOS chiude la connessione quando la web app resta a lungo in background: si riapre una volta.
          if (error?.name !== 'InvalidStateError') throw error;
          db = await openDb(name);
          await writeEvent(db, event);
        }
        events.push(event);
      }
    };
  } catch (error) {
    // Navigazione privata o archiviazione bloccata: i dati vivono solo in questa sessione.
    console.warn('[storage] IndexedDB non disponibile, dati in memoria.', error);
    return memoryStorage([...seedEvents]);
  }
}
