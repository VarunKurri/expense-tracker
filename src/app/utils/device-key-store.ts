// Local, per-device storage for the vault master key, so a trusted device can skip
// the passphrase. The key is stored as a NON-EXTRACTABLE CryptoKey in IndexedDB: any
// script on this origin can *use* it to decrypt, but it cannot be exported as raw
// bytes. Presence of a key = "this device is remembered". Clearing it = "forget".
//
// Tradeoff: anyone with access to this browser profile (unlocked OS session) can open
// the vault without the passphrase. Only enable on trusted personal devices.

const DB_NAME = 'trackr-device';
const STORE = 'keys';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putDeviceKey(uid: string, key: CryptoKey): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(key, uid);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function getDeviceKey(uid: string): Promise<CryptoKey | null> {
  const db = await openDb();
  try {
    return await new Promise<CryptoKey | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(uid);
      req.onsuccess = () => resolve((req.result as CryptoKey) ?? null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function deleteDeviceKey(uid: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(uid);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
