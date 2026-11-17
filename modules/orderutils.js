export function getLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getLocalTimeString(date = new Date()) {
  return date.toLocaleTimeString('ka-GE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

export function formatDate(value) {
  if (!value) return '—';
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
}

export function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('ka-GE');
}

export function toCurrency(value) {
  return `${Number(value || 0).toLocaleString('ka-GE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} ლ`;
}

export function calculateSubtotal(quantity, price) {
  return Number(quantity || 0) * Number(price || 0);
}

export function getSortedSales(sales) {
  return [...sales].sort((a, b) => {
    const dateCompare = b.saleDate.localeCompare(a.saleDate);
    if (dateCompare !== 0) return dateCompare;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
}

export function buildSaleOrder(preview) {
  let items = [];

  if (Array.isArray(preview.items) && preview.items.length) {
    items = preview.items.map((item) => ({
      code: item.code,
      name: item.name,
      quantity: Number(item.quantity || 0),
      unitPrice: Number(item.unitPrice || 0),
      catalogPrice: Number(item.catalogPrice ?? item.unitPrice ?? 0),
      priceModified: Boolean(item.priceModified),
      total: Number(item.total || Number(item.quantity || 0) * Number(item.unitPrice || 0))
    }));
  }

  const totalAmount = items.reduce((sum, item) => sum + Number(item.total || 0), 0);

  const now = new Date().toISOString();

  return {
    id: preview.id || crypto.randomUUID(),
    storeName: (preview.storeName || '').trim(),
    storePhone: preview.storePhone || '',
    storeAddress: preview.storeAddress || '',
    saleDate: preview.saleDate,
    saleTime: preview.saleTime,
    status: preview.status || 'მიღებულია',
    notes: (preview.notes || '').trim(),
    items,
    totalAmount,
    createdAt: preview.createdAt || now,
    updatedAt: preview.updatedAt || now
  };
}

export function getDailyReport(sales, selectedDate) {
  const filtered = sales.filter((sale) => sale.saleDate === selectedDate);

  const byStore = filtered.reduce((map, sale) => {
    const current = map.get(sale.storeName) || {
      storeName: sale.storeName,
      salesCount: 0,
      units: 0,
      total: 0
    };

    current.salesCount += 1;
    current.units += sale.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    current.total += Number(sale.totalAmount || 0);
    map.set(sale.storeName, current);
    return map;
  }, new Map());

  const total = filtered.reduce((sum, sale) => sum + Number(sale.totalAmount || 0), 0);

  return {
    selectedDate,
    total,
    stores: [...byStore.values()].sort((a, b) => b.total - a.total)
  };
}
