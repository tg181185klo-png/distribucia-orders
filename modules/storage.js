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

async function fetchRemoteOrders() {
  const response = await fetch(API_ENDPOINT, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Remote sales request failed: ${response.status}`);
  }

  const payload = await response.json();
  return Array.isArray(payload.orders) ? payload.orders : [];
}

async function readRemoteSales() {
  const orders = await fetchRemoteOrders();
  const local = readLocalSales();
  const merged = mergeSalesById(orders, local);
  writeLocalSales(merged);
  return merged;
}

async function writeRemoteSales(sales) {
  const response = await fetch(API_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(sales)
  });

  if (!response.ok) {
    throw new Error(`Remote save request failed: ${response.status}`);
  }

  const payload = await response.json().catch(() => ({}));
  const saved = Array.isArray(payload.orders) ? payload.orders : sales;
  writeLocalSales(saved);
  return saved;
}

function isActiveSale(sale) {
  return Boolean(sale) && sale.deleted !== true;
}

async function loadAllSales() {
  if (typeof fetch !== 'function') {
    return readLocalSales();
  }

  try {
    return await readRemoteSales();
  } catch (error) {
    console.warn('Using local sales fallback.', error);
    return readLocalSales();
  }
}

export async function loadSales() {
  const sales = await loadAllSales();
  return sales.filter(isActiveSale);
}

export async function saveSales(sales) {
  const localMerged = mergeSalesById(readLocalSales(), sales);
  writeLocalSales(localMerged);

  if (typeof fetch !== 'function') {
    return localMerged;
  }

  try {
    // Always re-fetch remote first so concurrent entries are never overwritten.
    const remote = await fetchRemoteOrders();
    const merged = mergeSalesById(remote, localMerged);
    return await writeRemoteSales(merged);
  } catch (error) {
    console.warn('Could not sync sales to remote storage.', error);
    return localMerged;
  }
}

/** History must never be wiped — clear is intentionally disabled. */
export async function clearSales() {
  console.warn('clearSales is disabled: order history is permanent.');
  return loadSales();
}

export async function addSale(sale) {
  const sales = await loadSales();
  const nextSales = mergeSalesById(sales, [sale]);
  await saveSales(nextSales);
  return nextSales;
}

export async function deleteSale(id) {
  if (!id) return loadSales();

  const all = await loadAllSales();
  const sale = all.find((entry) => entry.id === id);
  if (!sale || sale.deleted) {
    return all.filter(isActiveSale);
  }

  const tombstone = {
    ...sale,
    deleted: true,
    updatedAt: new Date().toISOString()
  };

  await saveSales(all.map((entry) => (entry.id === id ? tombstone : entry)));
  return loadSales();
}
