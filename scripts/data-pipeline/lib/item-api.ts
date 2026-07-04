/**
 * Wynncraft v3 Item API client (ported from py_script/item_wrapper.py).
 */

const ITEM_DATABASE_URL = 'https://api.wynncraft.com/v3/item/database?fullResult';
const ITEM_METADATA_URL = 'https://api.wynncraft.com/v3/item/metadata?static';
const ITEM_SEARCH_URL = 'https://api.wynncraft.com/v3/item/search?fullResult';

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText} (${url})`);
  }
  return response.json() as Promise<T>;
}

export class Items {
  async getAllItems(): Promise<unknown[]> {
    return fetchJson<unknown[]>(ITEM_DATABASE_URL);
  }

  async getMetadata(): Promise<Record<string, unknown>> {
    return fetchJson(ITEM_METADATA_URL);
  }

  async itemQuery(data: Record<string, unknown> | null = null): Promise<unknown> {
    return fetchJson(ITEM_SEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data ?? {}),
    });
  }
}

export async function updateItems(filePath: string): Promise<void> {
  const { writeJsonPretty } = await import('./json-io.ts');
  const data = await new Items().getAllItems();
  writeJsonPretty(filePath, data, 3);
  console.log(`${data.length} items updated`);
}

export async function updateMetadata(filePath: string): Promise<void> {
  const { writeJsonPretty } = await import('./json-io.ts');
  const data = await new Items().getMetadata();
  writeJsonPretty(filePath, data, 3);
  console.log('Metadata updated');
}

export async function itemSearchParam(options: {
  keyword?: string;
  itemType?: string;
  itemTier?: string;
  atkSpeed?: string;
  lvlRange?: [number, number];
  prof?: string;
  ids?: string;
  majorId?: string;
}): Promise<void> {
  const payload = {
    query: options.keyword ?? [],
    type: options.itemType ?? [],
    tier: options.itemTier ?? [],
    attackSpeed: options.atkSpeed ?? [],
    levelRange: options.lvlRange ?? [],
    professions: options.prof ?? [],
    identifications: options.ids ?? [],
    majorIds: options.majorId ?? [],
  };
  const response = await new Items().itemQuery(payload);
  console.log(JSON.stringify(response, null, 3));
}
