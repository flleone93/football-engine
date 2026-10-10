// Storage del registro previsioni nell'IndexedDB del dispositivo (app iPhone/PWA).
// Il registro è sincrono: gli eventi vengono letti una volta all'avvio e le scritture partono in background.
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

export async function openIdbLedgerStorage({ name = 'football-engine-ledger', seedEvents = [] } = {}) {
  if (typeof indexedDB === 'undefined') return memoryStorage([...seedEvents]);
  try {
    const opening = indexedDB.open(name, 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore(STORE, { autoIncrement: true });
    const db = await request(opening);
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
      append(event) {
        events.push(event);
        try {
          db.transaction(STORE, 'readwrite').objectStore(STORE).add(event);
        } catch (error) {
          console.error('[ledger] scrittura non riuscita', error);
        }
      }
    };
  } catch (error) {
    // Navigazione privata o archiviazione bloccata: il registro vive solo in questa sessione.
    console.warn('[ledger] IndexedDB non disponibile, registro in memoria.', error);
    return memoryStorage([...seedEvents]);
  }
}
