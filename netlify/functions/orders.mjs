import { getStore } from '@netlify/blobs';

const STORE = 'polimeri-orders';
const KEY = 'list';
const BACKUP_KEY = 'list-backup';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

function saleRevisionTime(sale) {
  const updated = Date.parse(sale?.updatedAt || 0) || 0;
  const created = Date.parse(sale?.createdAt || 0) || 0;
  return Math.max(updated, created);
}

function mergeSalesById(...lists) {
  const map = new Map();

  lists.flat().forEach((sale) => {
    if (!sale || !sale.id) return;

    const existing = map.get(sale.id);
    if (!existing) {
      map.set(sale.id, sale);
      return;
    }

    const nextTime = saleRevisionTime(sale);
    const prevTime = saleRevisionTime(existing);
    if (nextTime >= prevTime) {
      map.set(sale.id, sale);
    }
  });

  return [...map.values()].sort((a, b) => {
    const dateCompare = String(b.saleDate || '').localeCompare(String(a.saleDate || ''));
    if (dateCompare !== 0) return dateCompare;
    return (Date.parse(b.createdAt || 0) || 0) - (Date.parse(a.createdAt || 0) || 0);
  });
}

async function loadFromBlobs() {
  const store = getStore(STORE);
  const raw = await store.get(KEY, { type: 'json' });
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.orders)) return raw.orders;

  const backup = await store.get(BACKUP_KEY, { type: 'json' });
  if (Array.isArray(backup)) return backup;
  if (backup && Array.isArray(backup.orders)) return backup.orders;

  return [];
}

async function saveToBlobs(orders) {
  const store = getStore(STORE);
  try {
    const current = await loadFromBlobs();
    if (current.length) {
      await store.setJSON(BACKUP_KEY, current);
    }
  } catch {
    // Backup is best-effort; never block the save.
  }

  await store.setJSON(KEY, orders);
}

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  try {
    if (req.method === 'GET') {
      const orders = await loadFromBlobs();
      return Response.json({ ok: true, orders }, { headers: corsHeaders() });
    }

    if (req.method === 'POST') {
      const body = await req.json();
      const incoming = Array.isArray(body) ? body : body?.orders ?? [];

      if (!Array.isArray(incoming)) {
        return Response.json(
          { ok: false, error: 'Invalid payload' },
          { status: 400, headers: corsHeaders() }
        );
      }

      const existing = await loadFromBlobs();

      // Refuse empty wipe — history must never disappear.
      if (incoming.length === 0 && existing.length > 0) {
        return Response.json(
          {
            ok: true,
            count: existing.length,
            orders: existing,
            preserved: true,
            message: 'Empty overwrite rejected; history kept.'
          },
          { headers: corsHeaders() }
        );
      }

      const merged = mergeSalesById(existing, incoming);
      await saveToBlobs(merged);

      return Response.json(
        { ok: true, count: merged.length, orders: merged },
        { headers: corsHeaders() }
      );
    }

    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders() });
  } catch (error) {
    return Response.json(
      { ok: false, error: String(error?.message || error) },
      { status: 500, headers: corsHeaders() }
    );
  }
};
