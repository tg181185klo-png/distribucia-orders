const STORAGE_KEY = 'distribucia-sales-v3';
const API_ENDPOINT = '/api/orders';

function readLocalSales() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Could not read saved sales', error);
    return [];
  }
}

function writeLocalSales(sales) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sales));
  } catch (error) {
    console.error('Could not write saved sales', error);
  }
}

function saleRevisionTime(sale) {
  const updated = Date.parse(sale?.updatedAt || 0) || 0;
  const created = Date.parse(sale?.createdAt || 0) || 0;
  return Math.max(updated, created);
}

/** Merge order lists by id — never drop existing records. */
export function mergeSalesById(...lists) {
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

function ordersUrl(options) {
  const params = new URLSearchParams();
  if (options.date) params.set('date', options.date);
  if (options.from) params.set('from', options.from);
  if (options.to) params.set('to', options.to);
  if (options.id) params.set('id', options.id);
  if (options.stores) params.set('stores', '1');
  const query = params.toString();
  return query ? `${API_ENDPOINT}?${query}` : API_ENDPOINT;
}

async function fetchRemoteOrders(options) {
  const response = await fetch(ordersUrl(options || {}), { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Remote sales request failed: ${response.status}`);
  }

  const payload = await response.json();
  if (options && options.stores) return Array.isArray(payload.stores) ? payload.stores : [];
  return Array.isArray(payload.orders) ? payload.orders : [];
}

function isActiveSale(sale) {
  return Boolean(sale) && sale.deleted !== true;
}

export async function loadSales(options) {
  const filter = options || {};
  if (typeof fetch !== 'function') {
    return readLocalSales().filter(isActiveSale);
  }

  try {
    const orders = await fetchRemoteOrders(filter);
    return orders.filter(isActiveSale);
  } catch (error) {
    console.warn('Using local sales fallback.', error);
    return readLocalSales().filter(isActiveSale);
  }
}

export async function loadStores() {
  try {
    return await fetchRemoteOrders({ stores: true });
  } catch (error) {
    console.warn('Could not load store directory.', error);
    return [];
  }
}

async function savePatch(sale) {
  const response = await fetch(API_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ patch: true, orders: [sale] })
  });

  if (!response.ok) {
    throw new Error(`Remote save request failed: ${response.status}`);
  }

  const payload = await response.json().catch(() => ({}));
  return Array.isArray(payload.orders) ? payload.orders.filter(isActiveSale) : [sale].filter(isActiveSale);
}

/** History must never be wiped — clear is intentionally disabled. */
export async function clearSales() {
  console.warn('clearSales is disabled: order history is permanent.');
  return loadSales();
}

export async function addSale(sale) {
  return savePatch(sale);
}

export async function deleteSale(id, sale) {
  if (!id) return loadSales();

  const current = sale || (await loadSales({ id })).find((entry) => entry.id === id);
  if (!current || current.deleted) {
    return loadSales(current?.saleDate ? { date: current.saleDate } : {});
  }

  const tombstone = {
    ...current,
    deleted: true,
    updatedAt: new Date().toISOString()
  };

  return savePatch(tombstone);
}
