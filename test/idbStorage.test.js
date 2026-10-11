import assert from 'node:assert/strict';
import test from 'node:test';
import { openIdbLedgerStorage } from '../src/browser/idbLedgerStorage.js';

// IndexedDB minimale in memoria: abbastanza per open/getAll/add con transazioni asincrone.
function fakeIndexedDb({ failCommit = false } = {}) {
  const rows = [];
  let opens = 0;
  const later = (fn) => setTimeout(fn, 0);
  const makeDb = () => {
    const db = {
      closed: false,
      createObjectStore() {},
      transaction(store, mode = 'readonly') {
        if (db.closed) throw Object.assign(new Error('connessione chiusa'), { name: 'InvalidStateError' });
        const tx = { oncomplete: null, onerror: null, error: null };
        tx.objectStore = () => ({
          getAll() {
            const request = {};
            later(() => { request.result = rows.slice(); request.onsuccess?.(); });
            return request;
          },
          add(value) {
            later(() => {
              if (failCommit) { tx.error = new Error('quota superata'); tx.onerror?.(); return; }
              rows.push(value);
              tx.oncomplete?.();
            });
          }
        });
        return tx;
      }
    };
    return db;
  };
  const api = {
    rows,
    get opens() { return opens; },
    current: null,
    open() {
      opens += 1;
      const request = {};
      later(() => { api.current = makeDb(); request.result = api.current; request.onupgradeneeded?.(); request.onsuccess?.(); });
      return request;
    }
  };
  return api;
}

async function withIdb(fake, run) {
  const original = globalThis.indexedDB;
  globalThis.indexedDB = fake;
  try { return await run(); } finally { if (original === undefined) delete globalThis.indexedDB; else globalThis.indexedDB = original; }
}

test('IndexedDB: append attende il salvataggio effettivo', async () => {
  const fake = fakeIndexedDb();
  await withIdb(fake, async () => {
    const storage = await openIdbLedgerStorage({ name: 'diario' });
    const pending = storage.append({ type: 'bet', bet: { id: 'a' } });
    assert.ok(pending instanceof Promise);
    assert.equal(fake.rows.length, 0, 'non ancora scritto');
    await pending;
    assert.equal(fake.rows.length, 1);
  });
});

test('IndexedDB: un errore della transazione arriva al chiamante', async () => {
  await withIdb(fakeIndexedDb({ failCommit: true }), async () => {
    const storage = await openIdbLedgerStorage({ name: 'diario' });
    await assert.rejects(storage.append({ type: 'bet' }), /quota superata/);
    assert.equal(storage.load().length, 0, 'l evento non resta in memoria');
  });
});

test('IndexedDB: connessione chiusa da iOS → riapre una volta e salva', async () => {
  const fake = fakeIndexedDb();
  await withIdb(fake, async () => {
    const storage = await openIdbLedgerStorage({ name: 'diario' });
    fake.current.closed = true;
    await storage.append({ type: 'bet', bet: { id: 'b' } });
    assert.equal(fake.opens, 2);
    assert.equal(fake.rows.length, 1);
  });
});
