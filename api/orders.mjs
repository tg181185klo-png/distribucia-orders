import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { get, put } from '@vercel/blob';

const BLOB_PATH = 'distribucia-orders/list.json';
const FILE_PATH = path.join(process.cwd(), 'data', 'orders.json');
const ROW_ID = 'distribucia-orders';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://rtseufuxngkgwmaipqui.supabase.co';
const SUPABASE_KEY =
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ0c2V1ZnV4bmdrZ3dtYWlwcXVpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwNjEwOTcsImV4cCI6MjA5ODYzNzA5N30.QNXjkO2b5YFFck72BwiJdpatmPTV8aslxMVMCovhkck';

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

function signature(orders) {
  let max = 0;
  for (const sale of orders) {
    const time = saleRevisionTime(sale);
    if (time > max) max = time;
  }
  return `${orders.length}:${max}`;
}

function hasBlob() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function supabaseHeaders(extra = {}) {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    ...extra
  };
}

async function readFileOrders() {
  try {
    const raw = await readFile(FILE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeFileOrders(orders) {
  await mkdir(path.dirname(FILE_PATH), { recursive: true });
  await writeFile(FILE_PATH, JSON.stringify(orders), 'utf8');
}

async function readBlobOrders() {
  const result = await get(BLOB_PATH, { access: 'private', useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) return [];
  const text = await new Response(result.stream).text();
  const parsed = JSON.parse(text || '[]');
  return Array.isArray(parsed) ? parsed : [];
}

async function writeBlobOrders(orders) {
  await put(BLOB_PATH, JSON.stringify(orders), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json'
  });
}

async function readSupabaseOrders() {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/finance_store?id=eq.${ROW_ID}&select=payload`,
    { headers: supabaseHeaders(), cache: 'no-store' }
  );
  if (!response.ok) {
    throw new Error(`Supabase read ${response.status}`);
  }
  const rows = await response.json();
  const orders = rows?.[0]?.payload?.orders;
  return Array.isArray(orders) ? orders : [];
}

async function writeSupabaseOrders(orders) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/finance_store`, {
    method: 'POST',
    headers: supabaseHeaders({
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal'
    }),
    body: JSON.stringify({
      id: ROW_ID,
      payload: { orders },
      updated_at: new Date().toISOString()
    })
  });
  if (!response.ok) {
    throw new Error(`Supabase write ${response.status}`);
  }
}

async function readLegacyOrders() {
  const parts = [];
  if (hasBlob()) {
    try {
      parts.push(await readBlobOrders());
    } catch (error) {
      console.error('blob read failed', error);
    }
  }
  parts.push(await readFileOrders());
  return mergeSalesById(...parts);
}

async function loadOrders() {
  let remote = [];
  let remoteOk = false;
  try {
    remote = await readSupabaseOrders();
    remoteOk = true;
  } catch (error) {
    console.error('supabase read failed', error);
  }

  const legacy = await readLegacyOrders();
  const merged = mergeSalesById(remote, legacy);
  if (remoteOk && signature(merged) !== signature(remote)) {
    await writeSupabaseOrders(merged);
  }
  return merged;
}

async function saveOrders(orders) {
  try {
    await writeSupabaseOrders(orders);
  } catch (error) {
    console.error('supabase write failed', error);
    if (hasBlob()) await writeBlobOrders(orders);
    else await writeFileOrders(orders);
    return;
  }

  try {
    if (hasBlob()) await writeBlobOrders(orders);
  } catch (error) {
    console.error('blob backup failed', error);
  }
}

function readIncoming(req) {
  const body = req.body;
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.orders)) return body.orders;
  if (typeof body === 'string' && body.trim()) {
    const parsed = JSON.parse(body);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.orders)) return parsed.orders;
  }
  return null;
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const orders = await loadOrders();
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ ok: true, orders, storage: 'supabase' });
      return;
    }

    if (req.method === 'POST') {
      const incoming = readIncoming(req);
      if (!Array.isArray(incoming)) {
        res.status(400).json({ ok: false, error: 'Invalid payload' });
        return;
      }

      const existing = await loadOrders();
      if (incoming.length === 0 && existing.length > 0) {
        res.status(200).json({
          ok: true,
          count: existing.length,
          orders: existing,
          preserved: true,
          message: 'Empty overwrite rejected; history kept.'
        });
        return;
      }

      const merged = mergeSalesById(existing, incoming);
      await saveOrders(merged);
      res.status(200).json({ ok: true, count: merged.length, orders: merged, storage: 'supabase' });
      return;
    }

    res.setHeader('Allow', 'GET, POST');
    res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error?.message || error) });
  }
}
