import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { get, put } from '@vercel/blob';

const BLOB_PATH = 'distribucia-orders/list.json';
const FILE_PATH = path.join(process.cwd(), 'data', 'orders.json');

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

function hasBlob() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
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

async function loadOrders() {
  if (hasBlob()) return readBlobOrders();
  return readFileOrders();
}

async function saveOrders(orders) {
  if (hasBlob()) {
    await writeBlobOrders(orders);
    return;
  }
  await writeFileOrders(orders);
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
      res.status(200).json({ ok: true, orders });
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
      res.status(200).json({ ok: true, count: merged.length, orders: merged });
      return;
    }

    res.setHeader('Allow', 'GET, POST');
    res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error?.message || error) });
  }
}
