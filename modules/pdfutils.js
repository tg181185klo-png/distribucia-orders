import { loadProducts } from './catalog.js?v=20261117a';

const FONT_URL =
  'https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoSansGeorgian/NotoSansGeorgian-Regular.ttf';
const FONT_FILE = 'NotoSansGeorgian-Regular.ttf';
export const PDF_FONT = 'NotoSansGeorgian';

export const PDF_MARGIN = {
  top: 15,
  right: 12,
  bottom: 15,
  left: 12
};

export const PDF_PRODUCT_TABLE_HEAD = [
  ['კოდი', 'დასახელება', 'რაოდენობა', 'ერთეულის ღირებულება', 'ჯამი']
];

export function mapItemsToPdfTableRows(items) {
  return (items || []).map((item) => [
    item.code,
    item.name,
    String(item.quantity),
    formatPdfAmount(item.unitPrice),
    formatPdfAmount(item.total)
  ]);
}

export async function exportItemsPdf({
  title,
  metaLines = [],
  items,
  totalAmount,
  fileName
}) {
  const [doc, orderIndex] = await Promise.all([createGeorgianPdf(), loadProductOrderIndex()]);
  const sortedItems = sortItemsByCatalogOrder(items || [], orderIndex);
  let y = PDF_MARGIN.top;

  y = writePdfLine(doc, title, PDF_MARGIN.left, y, { fontSize: 16, lineHeight: 8 });

  metaLines.forEach((line, index) => {
    y = writePdfLine(doc, line, PDF_MARGIN.left, y + (index === 0 ? 2 : 0));
  });

  y = ensureContentFits(doc, y + 4, 20);
  y = writePdfTable(doc, y + 2, PDF_PRODUCT_TABLE_HEAD, mapItemsToPdfTableRows(sortedItems));

  y = ensureContentFits(doc, y + 8, 10);
  writePdfLine(
    doc,
    `ჯამი: ${formatPdfAmount(totalAmount)}`,
    doc.internal.pageSize.getWidth() - PDF_MARGIN.right,
    y,
    { fontSize: 12, textOptions: { align: 'right' } }
  );

  doc.save(fileName);
}

let fontBase64Promise = null;
let productOrderPromise = null;

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

async function loadGeorgianFontBase64() {
  if (!fontBase64Promise) {
    fontBase64Promise = fetch(FONT_URL)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Font request failed: ${response.status}`);
        }
        return response.arrayBuffer();
      })
      .then(arrayBufferToBase64);
  }

  return fontBase64Promise;
}

export async function loadProductOrderIndex() {
  if (!productOrderPromise) {
    productOrderPromise = loadProducts().then(
      (products) => new Map(products.map((product, index) => [String(product.code), index]))
    );
  }

  return productOrderPromise;
}

export function sortItemsByCatalogOrder(items, orderIndex) {
  return [...items].sort((left, right) => {
    const leftIndex = orderIndex.get(left.code) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = orderIndex.get(right.code) ?? Number.MAX_SAFE_INTEGER;
    return leftIndex - rightIndex;
  });
}

export function sortSummaryEntries(summaryMap, orderIndex) {
  return [...summaryMap.entries()].sort((left, right) => {
    const leftIndex = orderIndex.get(left[0]) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = orderIndex.get(right[0]) ?? Number.MAX_SAFE_INTEGER;
    return leftIndex - rightIndex;
  });
}

export function formatPdfAmount(value) {
  return `${Number(value || 0).toLocaleString('ka-GE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} ლ`;
}

export function formatPdfText(value) {
  return String(value ?? '—');
}

function getJsPdfConstructor() {
  return window.jspdf?.jsPDF || window.jspdf || window.jsPDF;
}

export async function createGeorgianPdf() {
  const jsPDFConstructor = getJsPdfConstructor();

  if (!jsPDFConstructor) {
    throw new Error('jsPDF not loaded');
  }

  const doc = new jsPDFConstructor({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  if (typeof doc.autoTable !== 'function') {
    throw new Error('jspdf-autotable not loaded');
  }

  const fontBase64 = await loadGeorgianFontBase64();
  doc.addFileToVFS(FONT_FILE, fontBase64);
  doc.addFont(FONT_FILE, PDF_FONT, 'normal');
  doc.setFont(PDF_FONT, 'normal');

  return doc;
}

export function writePdfLine(doc, text, x, y, options = {}) {
  doc.setFont(PDF_FONT, 'normal');
  doc.setFontSize(options.fontSize || 11);
  doc.text(String(text), x, y, options.textOptions || {});
  return y + (options.lineHeight || 6);
}

export function writePdfTable(doc, startY, head, body) {
  doc.autoTable({
    startY,
    head,
    body,
    margin: PDF_MARGIN,
    styles: {
      font: PDF_FONT,
      fontSize: 10,
      cellPadding: 2.5,
      overflow: 'linebreak',
      valign: 'middle'
    },
    headStyles: {
      font: PDF_FONT,
      fontStyle: 'normal',
      fillColor: [245, 245, 245],
      textColor: [0, 0, 0],
      lineWidth: 0.1,
      lineColor: [180, 180, 180]
    },
    bodyStyles: {
      font: PDF_FONT,
      fontStyle: 'normal'
    },
    alternateRowStyles: {
      fillColor: [252, 252, 252]
    },
    theme: 'grid',
    showHead: 'everyPage',
    columnStyles: {
      0: { cellWidth: 22 },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 22, halign: 'center' },
      3: { cellWidth: 32, halign: 'right' },
      4: { cellWidth: 28, halign: 'right' }
    }
  });

  return doc.lastAutoTable.finalY;
}

export function ensureContentFits(doc, nextY, requiredHeight = 12) {
  const pageHeight = doc.internal.pageSize.getHeight();
  const maxY = pageHeight - PDF_MARGIN.bottom;

  if (nextY + requiredHeight <= maxY) {
    return nextY;
  }

  doc.addPage();
  return PDF_MARGIN.top;
}
