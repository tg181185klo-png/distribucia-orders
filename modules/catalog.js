const PRODUCTS_API = '/api/products';
const PRODUCTS_CACHE_KEY = 'distribucia-products-v5';

function normalizeProducts(products) {
  return (Array.isArray(products) ? products : [])
    .map((product) => ({
      code: String(product.code || '').trim(),
      name: String(product.name || '').trim(),
      price: Number(product.price || 0)
    }))
    .filter((product) => product.code && product.name);
}

function readCachedProducts() {
  try {
    const raw = localStorage.getItem(PRODUCTS_CACHE_KEY);
    if (!raw) return [];
    return normalizeProducts(JSON.parse(raw));
  } catch (error) {
    console.warn('Could not read cached products', error);
    return [];
  }
}

function writeCachedProducts(products) {
  try {
    localStorage.setItem(PRODUCTS_CACHE_KEY, JSON.stringify(products));
  } catch (error) {
    console.warn('Could not cache products', error);
  }
}

async function loadLocalProducts() {
  const response = await fetch(new URL('./products.generated.json', import.meta.url), { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('products.generated.json could not be loaded');
  }

  return normalizeProducts(await response.json());
}

async function loadLiveProducts() {
  const response = await fetch(`${PRODUCTS_API}?t=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Live products request failed: ${response.status}`);
  }

  const payload = await response.json();
  const products = normalizeProducts(payload.products);
  if (!products.length) {
    throw new Error('Live products list is empty');
  }

  writeCachedProducts(products);
  return products;
}

export async function loadProducts() {
  try {
    return await loadLiveProducts();
  } catch (error) {
    console.warn('Using cached/local product prices.', error);
    const cached = readCachedProducts();
    if (cached.length) return cached;
    return loadLocalProducts();
  }
}

export function getDefaultProduct(products) {
  return products[0] || null;
}

export function getProductByCode(products, code) {
  return products.find((product) => product.code === code) || getDefaultProduct(products);
}

// Product order matches the Google Sheet / products.generated.json row sequence.
export function buildProductOrderIndex(products) {
  const orderIndex = new Map();
  (products || []).forEach((product, index) => {
    orderIndex.set(String(product.code || ''), index);
  });
  return orderIndex;
}

export function compareByCatalogOrder(codeA, codeB, orderIndex) {
  const a = String(codeA || '');
  const b = String(codeB || '');
  const indexA = orderIndex.has(a) ? orderIndex.get(a) : Number.MAX_SAFE_INTEGER;
  const indexB = orderIndex.has(b) ? orderIndex.get(b) : Number.MAX_SAFE_INTEGER;

  if (indexA !== indexB) {
    return indexA - indexB;
  }

  return a.localeCompare(b, 'ka');
}

export function sortItemsByCatalogOrder(items, orderIndex) {
  return [...(items || [])].sort((a, b) => compareByCatalogOrder(a.code, b.code, orderIndex));
}

export function sortEntriesByCatalogOrder(entries, orderIndex) {
  return [...(entries || [])].sort((a, b) => compareByCatalogOrder(a[0], b[0], orderIndex));
}
