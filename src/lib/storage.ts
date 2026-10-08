// Keeps settings — and, only if the user opts in (`keepTranscripts`), finished
// transcripts — across page reloads, on this device only: transcripts in IndexedDB (they can run to hundreds of KB each, past
// localStorage's ~5 MB budget), settings in localStorage.
//
// The original media is deliberately NOT stored — a video can be gigabytes,
// and browsers may refuse that much (one Chrome profile capped an origin at
// ~300 MB while reporting far more quota). A restored transcript can still be
// read, renamed, edited and exported; it just can't play lines back.
//
// Every call is best-effort. Private windows, a full disk or blocked storage
// must never stop the app from transcribing, so failures resolve quietly and
// `storageAvailable` reports whether saving works.
import type { SpeakerNames } from "./exporters";
import type { Job, JobSource } from "./jobs";
import type { TranscriptResult } from "./protocol";
import type { Message } from "./i18n";

const DB_NAME = "vem-sa-vad";
const DB_VERSION = 1;
const STORE = "transcripts";
const SETTINGS_KEY = "vem-sa-vad:settings";

/** What survives a reload: everything about a finished job except its media. */
export interface SavedTranscript {
  id: string;
  label: string;
  source: JobSource;
  downloadName: string;
  result: TranscriptResult;
  originalResult: TranscriptResult | null;
  speakerNames: SpeakerNames;
  /** A Message; a plain string in transcripts saved before warnings followed the language. */
  warning: Message | string | null;
  /** When it was first saved — restored transcripts keep their queue order. */
  savedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB is not available"));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    // A failed open shouldn't be cached forever.
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

/**
 * Run one transaction and resolve when it COMMITS, not when the request
 * succeeds — a request can succeed and the transaction still abort (e.g. on
 * quota), which would silently lose the write.
 */
async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = run(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error ?? request.error);
    tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
  });
}

export function toSaved(job: Job, savedAt: number): SavedTranscript | null {
  if (job.status !== "done" || !job.result) return null;
  return {
    id: job.id,
    label: job.label,
    source: job.source,
    downloadName: job.downloadName,
    result: job.result,
    originalResult: job.originalResult,
    speakerNames: job.speakerNames,
    warning: job.warning,
    savedAt,
  };
}

/** All saved transcripts, oldest first. Empty if storage isn't usable. */
export async function loadTranscripts(): Promise<SavedTranscript[]> {
  try {
    const all = await withStore("readonly", (s) =>
      s.getAll() as IDBRequest<SavedTranscript[]>,
    );
    return all.sort((a, b) => a.savedAt - b.savedAt);
  } catch {
    return [];
  }
}

/** True if saved; false if the browser refused (private window, quota…). */
export async function saveTranscript(saved: SavedTranscript): Promise<boolean> {
  try {
    await withStore("readwrite", (s) => s.put(saved));
    return true;
  } catch {
    return false;
  }
}

export async function deleteTranscript(id: string): Promise<void> {
  try {
    await withStore("readwrite", (s) => s.delete(id));
  } catch {
    /* nothing stored, or storage unavailable — nothing to delete */
  }
}

/** Settings as last saved, or null. Validation is the caller's job. */
export function loadSettingsRaw(): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function saveSettings(settings: object): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* private window or storage disabled — settings just won't persist */
  }
}

/** Remove every saved transcript (used when the user turns keeping off). */
export async function deleteAllTranscripts(): Promise<void> {
  try {
    await withStore("readwrite", (s) => s.clear());
  } catch {
    /* storage unavailable — nothing stored */
  }
}

/**
 * Call `listener` when another tab changes the saved settings. Without this,
 * a tab still holding old settings would write them back on its next change —
 * e.g. switching keepTranscripts back on after the user turned it off (and
 * deleted everything) in another tab. Returns an unsubscribe function.
 */
export function onSettingsChangedElsewhere(listener: () => void): () => void {
  const handle = (e: StorageEvent) => {
    if (e.key === SETTINGS_KEY) listener();
  };
  window.addEventListener("storage", handle);
  return () => window.removeEventListener("storage", handle);
}
