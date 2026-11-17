import { deleteSale, loadSales } from './storage.js?v=20260826b';
import { formatDate, getDailyReport, getLocalDateString, toCurrency } from './orderUtils.js';
import { ensurePdfFonts, PDF_FONT, preloadPdfFonts } from './pdfFonts.js';
import { verifyAdminDeleteCode } from './passwordPrompt.js';
import { adjustVanStockForOrderEdit } from './vanstock.js?v=20260826b';
import {
  buildProductOrderIndex,
  loadProducts,
  sortEntriesByCatalogOrder,
  sortItemsByCatalogOrder
} from './catalog.js?v=20261117a';

const elements = {
  historyDate: document.querySelector('#historyDate'),
  historyTotal: document.querySelector('#historyTotal'),
  historySummary: document.querySelector('#historySummary'),
  historyOrders: document.querySelector('#historyOrders'),
  exportBtn: document.querySelector('#exportHistoryBtn'),
  exportPdfBtn: document.querySelector('#exportHistoryPdfBtn'),
  periodFromDate: document.querySelector('#periodFromDate'),
  periodToDate: document.querySelector('#periodToDate'),
  exportPeriodBtn: document.querySelector('#exportPeriodBtn')
};

let catalogOrderIndex = null;

async function ensureCatalogOrderIndex() {
  if (!catalogOrderIndex) {
    const products = await loadProducts();
    catalogOrderIndex = buildProductOrderIndex(products);
  }

  return catalogOrderIndex;
}

function normalizeDateValue(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return null;
  }

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return raw;
  }

  const dotMatch = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (dotMatch) {
    return `${dotMatch[3]}-${dotMatch[2]}-${dotMatch[1]}`;
  }

  const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const day = String(slashMatch[1]).padStart(2, '0');
    const month = String(slashMatch[2]).padStart(2, '0');
    return `${slashMatch[3]}-${month}-${day}`;
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return getLocalDateString(parsed);
  }

  return null;
}

function getDateKey(value) {
  return normalizeDateValue(value) || '';
}

function getSelectedDate() {
  const normalized = normalizeDateValue(elements.historyDate?.value);
  return normalized || getLocalDateString();
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function createZip(entries) {
  const encoder = new TextEncoder();

  const toBytes = (value) => encoder.encode(value);
  const concat = (...arrays) => {
    const total = arrays.reduce((sum, arr) => sum + arr.length, 0);
    const merged = new Uint8Array(total);
    let offset = 0;

    arrays.forEach((arr) => {
      merged.set(arr, offset);
      offset += arr.length;
    });

    return merged;
  };

  const crc32 = (bytes) => {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) {
      crc ^= bytes[i];
      for (let bit = 0; bit < 8; bit += 1) {
        const mask = -(crc & 1);
        crc = (crc >>> 1) ^ (0xedb88320 & mask);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  };

  const records = entries.map(({ name, data }) => {
    const fileData = toBytes(data);
    const nameBytes = toBytes(name);
    const localHeader = new Uint8Array(30 + nameBytes.length + fileData.length);
    const localView = new DataView(localHeader.buffer);

    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, 0, true);
    localView.setUint16(12, 0, true);
    localView.setUint32(14, crc32(fileData), true);
    localView.setUint32(18, fileData.length, true);
    localView.setUint32(22, fileData.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);
    localHeader.set(fileData, 30 + nameBytes.length);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);

    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, 0, true);
    centralView.setUint32(16, crc32(fileData), true);
    centralView.setUint32(20, fileData.length, true);
    centralView.setUint32(24, fileData.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);

    centralHeader.set(nameBytes, 46);

    return { localHeader, centralHeader, fileData, nameBytes, crc: crc32(fileData), size: fileData.length };
  });

  const localParts = [];
  const centralParts = [];
  let offset = 0;

  records.forEach((record) => {
    const centralView = new DataView(record.centralHeader.buffer);
    centralView.setUint32(42, offset, true);
    localParts.push(record.localHeader);
    centralParts.push(record.centralHeader);
    offset += record.localHeader.length;
  });

  const localData = concat(...localParts);
  const centralDirectory = concat(...centralParts);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);

  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(4, 0, true);
  eocdView.setUint16(6, 0, true);
  eocdView.setUint16(8, records.length, true);
  eocdView.setUint16(10, records.length, true);
  eocdView.setUint32(12, centralDirectory.length, true);
  eocdView.setUint32(16, localData.length, true);
  eocdView.setUint16(20, 0, true);

  return concat(localData, centralDirectory, eocd);
}

function buildWorksheetXml(rows) {
  const body = rows
    .map(
      (row) => `
        <row r="${row.row}">
          ${row.cells
            .map((cell) => {
              const type = cell.type === 'number' ? 'n' : 'inlineStr';
              const inner = cell.type === 'number' ? `<v>${cell.value}</v>` : `<is><t>${escapeXml(cell.value)}</t></is>`;
              return `<c r="${cell.ref}" t="${type}">${inner}</c>`;
            })
            .join('')}
        </row>`
    )
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${body}</sheetData>
</worksheet>`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function getPdfFileName(sale) {
  const datePart = sale.saleDate || 'order';
  const timePart = (sale.saleTime || '').replace(/[:\s]/g, '-');
  const idPart = sale.id ? sale.id.slice(0, 8) : 'unknown';
  return `order-${datePart}-${timePart}-${idPart}.pdf`;
}

function formatPdfText(value) {
  return String(value || '—');
}

function formatPdfMoney(value) {
  return `${Number(value || 0).toLocaleString('ka-GE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} ლ`;
}

function ensurePdfMake() {
  return Boolean(window.pdfMake?.createPdf);
}

async function downloadPdf(docDefinition, filename) {
  if (!(await ensurePdfFonts())) return;
  window.pdfMake.createPdf(docDefinition).download(filename);
}

async function createOrderPdf(sale) {
  if (!ensurePdfMake()) {
    window.alert('PDF გენერატორი ვერ მოიძებნა. გთხოვთ, გადაამოწმოთ ინტერნეტი და გვერდი განაახლოთ.');
    return;
  }

  const orderIndex = await ensureCatalogOrderIndex();
  const sortedItems = sortItemsByCatalogOrder(sale.items || [], orderIndex);

  const itemRows = sortedItems.map((item) => [
    formatPdfText(item.code),
    formatPdfText(item.name),
    { text: String(item.quantity ?? ''), alignment: 'center' },
    { text: formatPdfMoney(item.unitPrice), alignment: 'right' },
    { text: formatPdfMoney(item.total), alignment: 'right' }
  ]);

  const docDefinition = {
    pageSize: 'A4',
    pageMargins: [42, 56, 42, 56],
    defaultStyle: {
      font: PDF_FONT,
      fontSize: 10,
      color: '#111827'
    },
    styles: {
      title: { fontSize: 16, bold: true, margin: [0, 0, 0, 12] },
      sectionTitle: { fontSize: 12, bold: true, margin: [0, 16, 0, 8] },
      metaLabel: { bold: true },
      totalLine: { fontSize: 12, bold: true, alignment: 'right', margin: [0, 12, 0, 0] }
    },
    content: [
      { text: 'დღიური შეკვეთის დეტალები', style: 'title' },
      {
        columns: [
          {
            width: '*',
            stack: [
              { text: [{ text: 'თარიღი: ', style: 'metaLabel' }, formatPdfText(sale.saleDate)] },
              { text: [{ text: 'დრო: ', style: 'metaLabel' }, formatPdfText(sale.saleTime)] },
              { text: [{ text: 'სახელი გვარი: ', style: 'metaLabel' }, formatPdfText(sale.storeName || 'უცნობი')] }
            ]
          },
          {
            width: '*',
            stack: [
              { text: [{ text: 'ტელეფონი: ', style: 'metaLabel' }, formatPdfText(sale.storePhone)] },
              ...(sale.storeAddress
                ? [{ text: [{ text: 'მისამართი: ', style: 'metaLabel' }, formatPdfText(sale.storeAddress)] }]
                : [])
            ]
          }
        ],
        columnGap: 20,
        margin: [0, 0, 0, 8]
      },
      { text: 'პროდუქტები', style: 'sectionTitle' },
      {
        table: {
          headerRows: 1,
          widths: [55, '*', 45, 65, 65],
          body: [
            [
              { text: 'კოდი', bold: true },
              { text: 'პროდუქტი', bold: true },
              { text: 'რაოდ.', bold: true, alignment: 'center' },
              { text: 'ერთ. ფასი', bold: true, alignment: 'right' },
              { text: 'ჯამი', bold: true, alignment: 'right' }
            ],
            ...itemRows
          ]
        },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => '#d0d0d0',
          vLineColor: () => '#d0d0d0',
          fillColor: (rowIndex) => (rowIndex === 0 ? '#f5f5f5' : null),
          paddingLeft: () => 6,
          paddingRight: () => 6,
          paddingTop: () => 5,
          paddingBottom: () => 5
        }
      },
      { text: `ჯამი: ${formatPdfMoney(sale.totalAmount)}`, style: 'totalLine' }
    ]
  };

  await downloadPdf(docDefinition, getPdfFileName(sale));
}

function isPriceModified(item) {
  if (!item) return false;
  if (item.priceModified === true) return true;

  if (item.catalogPrice != null && Number.isFinite(Number(item.catalogPrice))) {
    return Math.abs(Number(item.unitPrice || 0) - Number(item.catalogPrice || 0)) > 0.0001;
  }

  return false;
}

const YELLOW_FILL = {
  fill: {
    patternType: 'solid',
    fgColor: { rgb: 'FFFF00' }
  }
};

function applyCellStyle(sheet, address, style) {
  if (!sheet[address]) return;
  sheet[address].s = { ...(sheet[address].s || {}), ...style };
}

function createDailyOrdersXlsx(sales, date) {

  // Calculate total price for all items
  const totalPrice = sales.reduce((sum, sale) => {
    return sum + sale.items.reduce((itemSum, item) => itemSum + Number(item.total || 0), 0);
  }, 0);

  const detailRows = sales.flatMap((sale) =>
    (sale.items || []).map((item) => ({
      values: [
        sale.saleDate,
        sale.storeName || 'უცნობი',
        sale.storePhone || '',
        sale.storeAddress || '',
        item.code,
        item.name,
        Number(item.quantity || 0),
        Number(item.unitPrice || 0),
        Number(item.total || 0)
      ],
      priceModified: isPriceModified(item)
    }))
  );

  // Build detail sheet data
  const detailData = [
    ['თარიღი', 'სახელი გვარი', 'ტელეფონი', 'მისამართი', 'პროდუქტის კოდი', 'პროდუქტი', 'რაოდენობა', 'ერთეული ფასი', 'ჯამი'],
    ...detailRows.map((row) => row.values),
    // Add empty row and totals
    ['', '', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', 'ჯამური ფასი:', totalPrice.toFixed(2)]
  ];

  const detailSheet = window.XLSX.utils.aoa_to_sheet(detailData);

  detailRows.forEach((row, index) => {
    if (!row.priceModified) return;
    applyCellStyle(detailSheet, `H${index + 2}`, YELLOW_FILL);
  });

  const summaryMap = buildDailyProductSummary(sales);
  const summaryEntries = [...summaryMap.entries()];

  const summarySheet = window.XLSX.utils.aoa_to_sheet([
    ['პროდუქტის კოდი', 'პროდუქტი', 'რაოდენობა', 'ერთეული ფასი', 'ჯამური ფასი'],
    ...summaryEntries.map(([code, values]) => {
      const qty = Number(values.quantity || 0);
      const averageUnitPrice = qty ? Number((values.price / qty).toFixed(2)) : 0;
      return [code, values.name, qty, averageUnitPrice, Number(values.price.toFixed(2))];
    })
  ]);

  summaryEntries.forEach(([, values], index) => {
    if (!values.priceModified) return;
    applyCellStyle(summarySheet, `D${index + 2}`, YELLOW_FILL);
  });

  const workbook = window.XLSX.utils.book_new();

  window.XLSX.utils.book_append_sheet(workbook, detailSheet, 'დეტალური');
  window.XLSX.utils.book_append_sheet(workbook, summarySheet, 'ჯამური_პროდუქტების_მიხედვით');

  const workbookBuffer = window.XLSX.write(workbook, {
    bookType: 'xlsx',
    type: 'array',
    cellStyles: true
  });

  return new Blob([new Uint8Array(workbookBuffer)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
}

function buildDailyProductSummary(sales) {
  const summaryMap = new Map();

  sales.forEach((sale) => {
    (sale.items || []).forEach((item) => {
      const current = summaryMap.get(item.code) || {
        name: item.name,
        quantity: 0,
        price: 0,
        priceModified: false
      };
      current.quantity += Number(item.quantity || 0);
      current.price += Number(item.unitPrice || 0) * Number(item.quantity || 0);
      current.priceModified = current.priceModified || isPriceModified(item);
      summaryMap.set(item.code, current);
    });
  });

  return summaryMap;
}

async function createDailySummaryPdf(sales, date) {
  if (!ensurePdfMake()) {
    window.alert('PDF გენერატორი ვერ მოიძებნა. გთხოვთ, გადაამოწმოთ ინტერნეტი და გვერდი განაახლოთ.');
    return;
  }

  const summaryMap = buildDailyProductSummary(sales);
  const totalAmount = [...summaryMap.values()].reduce((sum, record) => sum + Number(record.price || 0), 0);
  const orderIndex = await ensureCatalogOrderIndex();

  const rows = sortEntriesByCatalogOrder([...summaryMap.entries()], orderIndex).map(([code, values]) => {
    const qty = Number(values.quantity || 0);
    const unitPrice = qty ? Number((values.price / qty).toFixed(2)) : 0;
    return [
      formatPdfText(code),
      formatPdfText(values.name),
      { text: String(qty), alignment: 'center' },
      { text: formatPdfMoney(unitPrice), alignment: 'right' },
      { text: formatPdfMoney(values.price), alignment: 'right' }
    ];
  });

  const docDefinition = {
    pageSize: 'A4',
    pageMargins: [42, 56, 42, 56],
    defaultStyle: {
      font: PDF_FONT,
      fontSize: 10,
      color: '#111827'
    },
    styles: {
      title: { fontSize: 16, bold: true, margin: [0, 0, 0, 12] },
      sectionTitle: { fontSize: 12, bold: true, margin: [0, 16, 0, 8] },
      metaLabel: { bold: true },
      totalLine: { fontSize: 12, bold: true, alignment: 'right', margin: [0, 12, 0, 0] }
    },
    content: [
      { text: 'დღიური ანგარიში', style: 'title' },
      {
        text: [{ text: 'თარიღი: ', style: 'metaLabel' }, formatPdfText(formatDate(date))],
        margin: [0, 0, 0, 8]
      },
      { text: 'ჯამური პროდუქტების მიხედვით', style: 'sectionTitle' },
      {
        table: {
          headerRows: 1,
          widths: [55, '*', 45, 65, 65],
          body: [
            [
              { text: 'კოდი', bold: true },
              { text: 'პროდუქტი', bold: true },
              { text: 'რაოდ.', bold: true, alignment: 'center' },
              { text: 'ერთ. ფასი', bold: true, alignment: 'right' },
              { text: 'ჯამი', bold: true, alignment: 'right' }
            ],
            ...rows
          ]
        },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => '#d0d0d0',
          vLineColor: () => '#d0d0d0',
          fillColor: (rowIndex) => (rowIndex === 0 ? '#f5f5f5' : null),
          paddingLeft: () => 6,
          paddingRight: () => 6,
          paddingTop: () => 5,
          paddingBottom: () => 5
        }
      },
      { text: `საერთო ჯამი: ${formatPdfMoney(totalAmount)}`, style: 'totalLine' }
    ]
  };

  await downloadPdf(docDefinition, `daily-summary-${date}.pdf`);
}

function renderSummary() {
  if (!elements.historySummary) {
    return;
  }

  elements.historySummary.innerHTML = '';
  elements.historySummary.hidden = true;
}

function renderOrders(sales) {
  if (!sales.length) {
    elements.historyOrders.innerHTML = '<p class="empty-state">ამ დღესათვის არცერთი შეკვეთა არ არის.</p>';
    return;
  }

  elements.historyOrders.innerHTML = sales
    .map((sale) => {
      return `
        <article class="sale-card">
            <div class="sale-header">
            <div>
            <div class="sale-store">${sale.storeName || 'უცნობი'}</div>
            <div class="sale-phone">${[
              sale.storePhone ? `ტელ: ${sale.storePhone}` : '',
              sale.storeAddress ? `მის: ${sale.storeAddress}` : ''
            ].filter(Boolean).join(' · ')}</div>
            </div>
            <div class="sale-header-actions">
            <button type="button" class="secondary-btn edit-order-btn" data-sale-id="${sale.id}">✏️ რედაქტირება</button>
            <button type="button" class="secondary-btn export-order-pdf" data-sale-id="${sale.id}">📄 PDF</button>
            <button type="button" class="danger-btn delete-order-btn" data-sale-id="${sale.id}">🗑️ წაშლა</button>
            </div>
          </div>
          <div class="sale-items">
            ${ (sale.items || []).map(item => `
              <div class="product-item">
                <span>${item.code} — ${item.name}</span>
                <span>${item.quantity} ც</span>
                <span class="${isPriceModified(item) ? 'price-modified' : ''}">${toCurrency(item.unitPrice)}${isPriceModified(item) ? ' ✎' : ''}</span>
                <span>${toCurrency(item.total)}</span>
              </div>
            `).join('')}
          </div>
          <div>
            <div class="meta">ჯამური ღირებულება:</div>
            <strong>${toCurrency(sale.totalAmount)}</strong>
          </div>
        </article>`;
    })
    .join('');
}

async function loadFilteredSales() {
  const dateKey = getDateKey(getSelectedDate());
  const sales = await loadSales();
  return sales
    .filter((sale) => getDateKey(sale.saleDate) === dateKey)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function refreshHistory() {
  const date = getSelectedDate();
  const filtered = await loadFilteredSales();
  const report = getDailyReport(filtered, date);

  elements.historyTotal.textContent = toCurrency(report.total || 0);
  elements.historyDate.value = date;
  renderSummary();
  renderOrders(filtered);
}

async function exportCurrentDay() {
  const filtered = await loadFilteredSales();

  if (!filtered.length) {
    window.alert('ამ დღესათვის არცერთი შეკვეთა არ არის.');
    return;
  }

  const blob = createDailyOrdersXlsx(filtered, getSelectedDate());
  downloadBlob(blob, `daily-orders-${getSelectedDate()}.xlsx`);
}

function getPeriodRange() {
  const from = normalizeDateValue(elements.periodFromDate?.value);
  const to = normalizeDateValue(elements.periodToDate?.value);

  if (!from || !to) {
    return null;
  }

  return from <= to ? { from, to } : { from: to, to: from };
}

async function loadSalesInRange(from, to) {
  const sales = await loadSales();
  return sales.filter((sale) => {
    const key = getDateKey(sale.saleDate);
    return key && key >= from && key <= to;
  });
}

function buildPeriodAggregates(sales) {
  const byProduct = new Map();
  const byStore = new Map();
  const byStoreProduct = new Map();
  let grandTotal = 0;

  sales.forEach((sale) => {
    const storeName = sale.storeName || 'უცნობი';
    const phone = String(sale.storePhone || '').trim();
    const address = String(sale.storeAddress || '').trim();
    const personKey = `${storeName}||${phone}||${address}`;

    const storeRecord = byStore.get(personKey) || {
      storeName,
      storePhone: phone,
      storeAddress: address,
      ordersCount: 0,
      quantity: 0,
      total: 0
    };
    storeRecord.ordersCount += 1;

    (sale.items || []).forEach((item) => {
      const qty = Number(item.quantity || 0);
      const sum = Number(item.total || qty * Number(item.unitPrice || 0));
      grandTotal += sum;

      const productRecord = byProduct.get(item.code) || { name: item.name, quantity: 0, total: 0 };
      productRecord.quantity += qty;
      productRecord.total += sum;
      byProduct.set(item.code, productRecord);

      storeRecord.quantity += qty;
      storeRecord.total += sum;

      const comboKey = `${personKey}||${item.code}`;
      const comboRecord = byStoreProduct.get(comboKey) || {
        storeName,
        storePhone: phone,
        storeAddress: address,
        code: item.code,
        name: item.name,
        quantity: 0,
        total: 0
      };
      comboRecord.quantity += qty;
      comboRecord.total += sum;
      byStoreProduct.set(comboKey, comboRecord);
    });

    byStore.set(personKey, storeRecord);
  });

  return { byProduct, byStore, byStoreProduct, grandTotal };
}

function createPeriodSummaryXlsx(sales, from, to) {
  const { byProduct, byStore, byStoreProduct, grandTotal } = buildPeriodAggregates(sales);

  const productRows = [...byProduct.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([code, values]) => {
      const qty = Number(values.quantity || 0);
      const avgUnitPrice = qty ? Number((values.total / qty).toFixed(2)) : 0;
      return [code, values.name, qty, avgUnitPrice, Number(values.total.toFixed(2))];
    });

  const productSheet = window.XLSX.utils.aoa_to_sheet([
    ['პერიოდი:', `${formatDate(from)} — ${formatDate(to)}`],
    [],
    ['პროდუქტის კოდი', 'პროდუქტი', 'ჯამური რაოდენობა', 'საშ. ერთეული ფასი', 'ჯამური თანხა'],
    ...productRows,
    [],
    ['', '', '', 'საერთო ჯამი:', Number(grandTotal.toFixed(2))]
  ]);

  const storeRows = [...byStore.values()]
    .sort((a, b) => b.total - a.total)
    .map((values) => [
      values.storeName,
      values.storePhone || '',
      values.storeAddress || '',
      Number(values.ordersCount || 0),
      Number(values.quantity || 0),
      Number(values.total.toFixed(2))
    ]);

  const storeSheet = window.XLSX.utils.aoa_to_sheet([
    ['პერიოდი:', `${formatDate(from)} — ${formatDate(to)}`],
    [],
    ['სახელი გვარი', 'ტელეფონი', 'მისამართი', 'შეკვეთები', 'ჯამური რაოდენობა', 'ჯამური თანხა'],
    ...storeRows,
    [],
    ['', '', '', '', 'საერთო ჯამი:', Number(grandTotal.toFixed(2))]
  ]);

  const comboRows = [...byStoreProduct.values()]
    .sort((a, b) => a.storeName.localeCompare(b.storeName, 'ka') || b.total - a.total)
    .map((record) => [
      record.storeName,
      record.storePhone || '',
      record.storeAddress || '',
      record.code,
      record.name,
      Number(record.quantity || 0),
      Number(record.total.toFixed(2))
    ]);

  const comboSheet = window.XLSX.utils.aoa_to_sheet([
    ['პერიოდი:', `${formatDate(from)} — ${formatDate(to)}`],
    [],
    ['სახელი გვარი', 'ტელეფონი', 'მისამართი', 'პროდუქტის კოდი', 'პროდუქტი', 'ჯამური რაოდენობა', 'ჯამური თანხა'],
    ...comboRows
  ]);

  const workbook = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(workbook, productSheet, 'ჯამი_პროდუქტებით');
  window.XLSX.utils.book_append_sheet(workbook, storeSheet, 'ჯამი_პირებით');
  window.XLSX.utils.book_append_sheet(workbook, comboSheet, 'პირი_პროდუქტი');

  const workbookBuffer = window.XLSX.write(workbook, {
    bookType: 'xlsx',
    type: 'array',
    cellStyles: true
  });

  return new Blob([new Uint8Array(workbookBuffer)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
}

async function exportPeriodSummary() {
  if (!window.XLSX) {
    window.alert('Excel ბიბლიოთეკა ვერ ჩაიტვირთა. გთხოვთ, განაახლოთ გვერდი.');
    return;
  }

  const range = getPeriodRange();
  if (!range) {
    window.alert('გთხოვთ, აირჩიოთ პერიოდის ორივე თარიღი ("დან" და "მდე").');
    return;
  }

  const filtered = await loadSalesInRange(range.from, range.to);
  if (!filtered.length) {
    window.alert('არჩეულ პერიოდში შეკვეთები ვერ მოიძებნა.');
    return;
  }

  const blob = createPeriodSummaryXlsx(filtered, range.from, range.to);
  downloadBlob(blob, `period-summary-${range.from}_${range.to}.xlsx`);
}

function initPeriodPickers() {
  const today = getLocalDateString();
  const monthStart = `${today.slice(0, 7)}-01`;

  if (elements.periodFromDate && !elements.periodFromDate.value) {
    elements.periodFromDate.value = monthStart;
  }

  if (elements.periodToDate && !elements.periodToDate.value) {
    elements.periodToDate.value = today;
  }
}

const queryDate = new URLSearchParams(window.location.search).get('date');
const normalizedQueryDate = normalizeDateValue(queryDate);
if (elements.historyDate) {
  // Always default to a concrete day (query param or today) so today's data loads automatically.
  elements.historyDate.value = normalizedQueryDate || getLocalDateString();
}
initPeriodPickers();

elements.historyDate?.addEventListener('change', refreshHistory);
elements.historyDate?.addEventListener('input', refreshHistory);
elements.exportBtn?.addEventListener('click', exportCurrentDay);
elements.exportPdfBtn?.addEventListener('click', async () => {
  const filtered = await loadFilteredSales();
  if (!filtered.length) {
    window.alert('ამ დღესათვის არცერთი შეკვეთა არ არის.');
    return;
  }

  await createDailySummaryPdf(filtered, getSelectedDate());
});
elements.historyOrders?.addEventListener('click', async (event) => {
  const editButton = event.target.closest('.edit-order-btn');
  if (editButton) {
    const saleId = editButton.dataset.saleId;
    if (!saleId) return;

    const allowed = await verifyAdminDeleteCode('რედაქტირებისთვის შეიყვანეთ კოდი');
    if (!allowed) return;

    sessionStorage.setItem(
      'orderEditUnlock',
      JSON.stringify({ id: saleId, at: Date.now() })
    );
    window.location.assign(`index.html?edit=${encodeURIComponent(saleId)}`);
    return;
  }

  const deleteButton = event.target.closest('.delete-order-btn');
  if (deleteButton) {
    const saleId = deleteButton.dataset.saleId;
    if (!saleId) return;

    const sales = await loadSales();
    const sale = sales.find((entry) => entry.id === saleId);
    if (!sale) {
      window.alert('შეკვეთა ვერ მოიძებნა.');
      return;
    }

    const allowed = await verifyAdminDeleteCode('წასაშლელად შეიყვანეთ კოდი');
    if (!allowed) return;

    const label = sale.storeName || 'შეკვეთა';
    if (!window.confirm(`ნამდვილად გსურთ „${label}“-ის წაშლა?`)) return;

    await deleteSale(saleId);
    adjustVanStockForOrderEdit(sale.items || [], []);
    await refreshHistory();
    return;
  }

  const button = event.target.closest('.export-order-pdf');
  if (!button) return;

  const saleId = button.dataset.saleId;
  if (!saleId) return;

  const sales = await loadSales();
  const sale = sales.find((entry) => entry.id === saleId);
  if (!sale) {
    window.alert('შეკვეთა ვერ მოიძებნა.');
    return;
  }

  await createOrderPdf(sale);
});
elements.exportPeriodBtn?.addEventListener('click', exportPeriodSummary);
preloadPdfFonts().catch(() => {});
ensureCatalogOrderIndex().catch(() => {});
refreshHistory();
