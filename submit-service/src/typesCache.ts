import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import path from 'path';

const cachePath = process.env.TYPES_CACHE_PATH ?? '/usr/src/data/types.json';

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

async function ensureDir(): Promise<void> {
  await mkdir(path.dirname(cachePath), { recursive: true });
}

export async function readTypesCache(): Promise<string[]> {
  try {
    const raw = await readFile(cachePath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
      console.warn('submit-service types cache file is invalid JSON array');
      return [];
    }
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`submit-service types cache unavailable: ${message}`);
    return [];
  }
}

async function writeTypesCacheAtomically(types: string[]): Promise<void> {
  await ensureDir();
  const tmpPath = `${cachePath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(types, null, 2), 'utf8');
  await rename(tmpPath, cachePath);
}

export async function upsertTypeInCache(typeName: string): Promise<void> {
  const trimmed = typeName.trim();
  if (!trimmed) {
    return;
  }

  const types = await readTypesCache();
  const exists = types.some((existing) => normalize(existing) === normalize(trimmed));
  if (exists) {
    return;
  }

  const next = [...types, trimmed].sort((a, b) => a.localeCompare(b));
  await writeTypesCacheAtomically(next);
  console.log(`submit-service cached new type from event: ${trimmed}`);
}
