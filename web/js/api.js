// Server API + a local IndexedDB draft used for crash recovery.

function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function req(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).detail || msg; } catch { /* not json */ }
    throw new Error(`${res.status}: ${msg}`);
  }
  return res.headers.get('content-type')?.includes('json') ? res.json() : res;
}

export const api = {
  info: () => req('GET', '/api/info'),
  list: () => req('GET', '/api/maps'),
  load: (id) => req('GET', `/api/maps/${encodeURIComponent(id)}`),
  save: (doc) => req('PUT', `/api/maps/${encodeURIComponent(doc.meta.id)}`, JSON.stringify(doc)),
  remove: (id) => req('DELETE', `/api/maps/${encodeURIComponent(id)}`),
  export: (id, glbStep = 1, walkGrid = null) => req('POST', `/api/maps/${encodeURIComponent(id)}/export?glb_step=${glbStep}`,
    walkGrid ? { walkmap: bytesToB64(walkGrid) } : undefined),
  backups: (id) => req('GET', `/api/maps/${encodeURIComponent(id)}/backups`),
  loadBackup: (id, name) => req('GET', `/api/maps/${encodeURIComponent(id)}/backups/${encodeURIComponent(name)}`),
  thumbUrl: (id) => `/api/maps/${encodeURIComponent(id)}/thumb?t=${Date.now()}`,
};

// ------------------------------------------------------------ local draft

function openDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('map-creator', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('drafts');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function saveDraft(doc, serverId = null) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('drafts', 'readwrite');
      tx.objectStore('drafts').put({ savedAt: Date.now(), doc, serverId }, 'current');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch { return false; }
}

export async function loadDraft() {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const r = db.transaction('drafts').objectStore('drafts').get('current');
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    });
  } catch { return null; }
}

export async function clearDraft() {
  try {
    const db = await openDb();
    db.transaction('drafts', 'readwrite').objectStore('drafts').delete('current');
  } catch { /* ignore */ }
}

export function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
