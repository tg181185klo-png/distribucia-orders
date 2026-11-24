import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { get, put } from '@vercel/blob';

const BLOB_PATH = 'distribucia-orders/list.json';
const FILE_PATH = path.join(process.cwd(), 'data', 'orders.json');
const ROW_ID = 'distribucia-orders';
const BACKUP_ID = 'distribucia-orders-backup';
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

function tbilisiDay() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tbilisi' }).format(new Date());
}

async function readRow(id) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/finance_store?id=eq.${id}&select=payload`,
    { headers: supabaseHeaders(), cache: 'no-store' }
  );
  if (!response.ok) {
    throw new Error(`Supabase read ${response.status}`);
  }
  const rows = await response.json();
  const payload = rows?.[0]?.payload || {};
  return {
    orders: Array.isArray(payload.orders) ? payload.orders : [],
    backupDay: typeof payload.backupDay === 'string' ? payload.backupDay : ''
  };
}

async function writeRow(id, orders, backupDay) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/finance_store`, {
    method: 'POST',
    headers: supabaseHeaders({
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal'
    }),
    body: JSON.stringify({
      id,
      payload: backupDay ? { orders, backupDay } : { orders },
      updated_at: new Date().toISOString()
    })
  });
  if (!response.ok) {
    throw new Error(`Supabase write ${response.status}`);
  }
}

async function readSupabaseOrders() {
  return readRow(ROW_ID);
}

async function writeSupabaseOrders(orders, backupDay) {
  return writeRow(ROW_ID, orders, backupDay);
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
  try {
    const remote = await readSupabaseOrders();
    if (remote.orders.length) return remote;
  } catch (error) {
    console.error('supabase read failed', error);
  }

  const legacy = await readLegacyOrders();
  if (legacy.length) {
    try {
      await writeSupabaseOrders(legacy, '');
    } catch (error) {
      console.error('supabase restore failed', error);
    }
  }
  return { orders: legacy, backupDay: '' };
}

function activeOrders(orders) {
  return orders.filter((sale) => sale && sale.deleted !== true);
}

function saleDay(sale) {
  return String(sale?.saleDate || '').slice(0, 10);
}

function selectOrders(orders, query) {
  const date = String(query.date || '');
  const from = String(query.from || '');
  const to = String(query.to || '');
  const id = String(query.id || '');
  const narrowed = Boolean(date || (from && to) || id);
  const source = narrowed ? activeOrders(orders) : orders;
  return source.filter((sale) => {
    if (id) return sale.id === id;
    const day = saleDay(sale);
    if (date) return day === date;
    if (from && to) return day >= from && day <= to;
    return true;
  });
}

function storeDirectory(orders) {
  const map = new Map();
  activeOrders(orders).forEach((sale) => {
    const storeName = String(sale.storeName || '').trim();
    const storePhone = String(sale.storePhone || '').trim();
    const storeAddress = String(sale.storeAddress || '').trim();
    if (!storeName && !storePhone && !storeAddress) return;
    const key = `${storeName}|${storePhone}|${storeAddress}`;
    if (!map.has(key)) map.set(key, { storeName, storePhone, storeAddress });
  });
  return [...map.values()];
}

async function saveOrders(incoming) {
  const current = await loadOrders();
  if (incoming.length === 0 && current.orders.length > 0) {
    return { orders: current.orders, preserved: true };
  }

  const merged = mergeSalesById(current.orders, incoming);
  let backupDay = current.backupDay;
  const today = tbilisiDay();
  if (backupDay !== today && current.orders.length) {
    try {
      await writeRow(BACKUP_ID, current.orders);
      backupDay = today;
    } catch (error) {
      console.error('daily backup failed', error);
    }
  }

  await writeSupabaseOrders(merged, backupDay);
  return { orders: merged, preserved: false };
}

function readIncoming(req) {
  const body = req.body;
  if (Array.isArray(body)) return { patch: false, orders: body };
  if (body && Array.isArray(body.orders)) return { patch: body.patch === true, orders: body.orders };
  if (typeof body === 'string' && body.trim()) {
    const parsed = JSON.parse(body);
    if (Array.isArray(parsed)) return { patch: false, orders: parsed };
    if (parsed && Array.isArray(parsed.orders)) {
      return { patch: parsed.patch === true, orders: parsed.orders };
    }
  }
  return null;
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const query = req.query || {};
      const stored = await loadOrders();
      res.setHeader('Cache-Control', 'no-store');
      if (String(query.stores || '') === '1') {
        res.status(200).json({ ok: true, stores: storeDirectory(stored.orders) });
        return;
      }
      if (String(query.alerts || '') === '1') {
        const today = tbilisiDay();
        const alerts = activeOrders(stored.orders)
          .filter((sale) => sale.consignment && !sale.consignmentSettled && sale.consignmentDue && sale.consignmentDue < today)
          .map((sale) => ({
            id: sale.id,
            storeName: sale.storeName || '',
            consignmentDue: sale.consignmentDue,
            totalAmount: Number(sale.totalAmount) || 0
          }));
        res.status(200).json({ ok: true, alerts });
        return;
      }
      const orders = selectOrders(stored.orders, query);
      res.status(200).json({ ok: true, count: orders.length, orders, storage: 'supabase' });
      return;
    }

    if (req.method === 'POST') {
      const incoming = readIncoming(req);
      if (!incoming || !Array.isArray(incoming.orders)) {
        res.status(400).json({ ok: false, error: 'Invalid payload' });
        return;
      }

      const saved = await saveOrders(incoming.orders);
      const orders = incoming.patch ? selectOrders(saved.orders, { date: saleDay(incoming.orders[0]) }) : saved.orders;
      res.status(200).json({
        ok: true,
        count: saved.orders.length,
        orders,
        preserved: Boolean(saved.preserved),
        storage: 'supabase'
      });
      return;
    }

    res.setHeader('Allow', 'GET, POST');
    res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error?.message || error) });
  }
}
