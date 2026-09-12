import { createDoc } from '../../model/defaults';
import { migrateDoc } from '../../model/migrate';
import type { Doc } from '../../model/types';

const CLIPBOARD_KEY = 'ie-clipboard-recipe';

/** A recipe is the document's look, without the source asset or output prefs. */
export function serializeRecipe(doc: Doc): string {
  const { source: _source, output: _output, passport: _passport, ...recipe } = doc;
  void _source;
  void _output;
  void _passport;
  return JSON.stringify(recipe);
}

export function applyRecipe(doc: Doc, raw: unknown): Doc | null {
  if (typeof raw !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const migrated = migrateDoc({
    ...createDoc(),
    ...(parsed as Record<string, unknown>),
    source: doc.source,
    output: doc.output,
    schema: 3,
  });
  if (!migrated) return null;
  return { ...migrated, source: doc.source, output: doc.output, passport: doc.passport };
}

export function writeClipboardRecipe(doc: Doc): void {
  try {
    localStorage.setItem(CLIPBOARD_KEY, serializeRecipe(doc));
  } catch {
    // Storage unavailable; copy/paste edits silently unavailable.
  }
}

export function readClipboardRecipe(): string | null {
  try {
    return localStorage.getItem(CLIPBOARD_KEY);
  } catch {
    return null;
  }
}

export function hasClipboardRecipe(): boolean {
  return readClipboardRecipe() !== null;
}

export function savePreset(name: string, doc: Doc): void {
  try {
    const key = `ie-preset:${name}`;
    localStorage.setItem(key, serializeRecipe(doc));
  } catch {
    // ignore
  }
}
