import { openDB, type IDBPDatabase } from 'idb';
import type { Doc } from '../../model/types';

/**
 * IndexedDB session persistence. Only the JSON `Doc` and the original encoded
 * source bytes are stored — never decoded pixels — so a session written by an
 * old build still loads after a deploy. Every call is defensive because
 * Safari private mode throws on storage access.
 */

const DB_NAME = 'image-editor';
const DB_VERSION = 1;
const SESSION_ID = 'current';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type StoredSession = {
  id: string;
  doc: Doc;
  updatedAt: number;
  thumb: string | null;
};

export type StoredAsset = {
  id: string;
  blob: Blob;
  mime: string;
};

type Schema = {
  sessions: StoredSession;
  assets: StoredAsset;
};

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null;

function db(): Promise<IDBPDatabase<Schema>> {
  dbPromise ??= openDB<Schema>(DB_NAME, DB_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains('sessions')) database.createObjectStore('sessions', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('assets')) database.createObjectStore('assets', { keyPath: 'id' });
    },
  });
  return dbPromise;
}

export async function saveSession(doc: Doc, source: Blob | null, thumb: string | null): Promise<void> {
  try {
    const database = await db();
    await database.put('sessions', { id: SESSION_ID, doc, updatedAt: Date.now(), thumb });
    if (source && doc.source) {
      await database.put('assets', { id: doc.source.assetId, blob: source, mime: doc.source.mime });
    }
  } catch {
    // Storage may be unavailable/full; autosave is best-effort.
  }
}

export async function loadSession(): Promise<{ doc: Doc; updatedAt: number; thumb: string | null; source: Blob | null } | null> {
  try {
    const database = await db();
    const session = await database.get('sessions', SESSION_ID);
    if (!session) return null;
    if (Date.now() - session.updatedAt > MAX_AGE_MS) return null;
    let source: Blob | null = null;
    if (session.doc.source) {
      const asset = await database.get('assets', session.doc.source.assetId);
      source = asset?.blob ?? null;
    }
    return { doc: session.doc, updatedAt: session.updatedAt, thumb: session.thumb, source };
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  try {
    const database = await db();
    await database.delete('sessions', SESSION_ID);
    const keys = await database.getAllKeys('assets');
    await Promise.all(keys.map((key) => database.delete('assets', key)));
  } catch {
    // ignore
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
    const estimate = await navigator.storage.estimate();
    return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
  } catch {
    return null;
  }
}

/** Create a small thumbnail data URL from a decoded source. */
export function createThumbnail(source: ImageBitmap, maxEdge = 160): string | null {
  try {
    const scale = Math.min(1, maxEdge / Math.max(source.width, source.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(source.width * scale));
    canvas.height = Math.max(1, Math.round(source.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.7);
  } catch {
    return null;
  }
}
