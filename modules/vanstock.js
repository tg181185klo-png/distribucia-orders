// Van (on-board) stock management.
// State lives ONLY in localStorage under its own key and never touches
// the remote Netlify Blobs sync in storage.js.

import { getLocalDateString, getLocalTimeString } from './orderUtils.js';
import { verifyAdminDeleteCode } from './passwordPrompt.js';

const VAN_STOCK_KEY = 'polimeri_van_stock_v1';
const VAN_STOCK_HISTORY_KEY = 'polimeri_van_stock_history_v1';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function loadVanStock() {
  try {
    const raw = localStorage.getItem(VAN_STOCK_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Could not read van stock', error);
    return [];
  }
}

export function saveVanStock(stock) {
  try {
    localStorage.setItem(VAN_STOCK_KEY, JSON.stringify(stock));
  } catch (error) {
    console.error('Could not write van stock', error);
  }
}

export function loadVanStockHistory() {
  try {
    const raw = localStorage.getItem(VAN_STOCK_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Could not read van stock history', error);
    return [];
  }
}

export function saveVanStockHistory(history) {
  try {
    localStorage.setItem(VAN_STOCK_HISTORY_KEY, JSON.stringify(history));
  } catch (error) {
    console.error('Could not write van stock history', error);
  }
}

function appendVanStockHistoryEvent(type, code, name, quantity) {
  const qty = Number(quantity || 0);
  if (!code || !Number.isFinite(qty) || qty <= 0) return;

  const history = loadVanStockHistory();
  history.push({
    date: getLocalDateString(),
    time: getLocalTimeString(),
    code,
    name: name || '',
    type,
    quantity: qty
  });
  saveVanStockHistory(history);
}

export function addToVanStock(code, name, quantity) {
  const qty = Number(quantity || 0);
  if (!code || !Number.isFinite(qty) || qty <= 0) {
    return loadVanStock();
  }

  const stock = loadVanStock();
  const existing = stock.find((entry) => entry.code === code);

  if (existing) {
    existing.quantity = Number(existing.quantity || 0) + qty;
    existing.name = name || existing.name;
  } else {
    stock.push({ code, name: name || '', quantity: qty });
  }

  saveVanStock(stock);
  appendVanStockHistoryEvent('added', code, name || existing?.name || '', qty);
  return stock;
}

// Subtracts sold quantities. Missing products are initialized at 0 first,
// so balances may go negative — the sales flow is never blocked.
export function deductSoldItems(items) {
  const stock = loadVanStock();

  (items || []).forEach((item) => {
    const qty = Number(item.quantity || 0);
    if (!item.code || !Number.isFinite(qty) || qty <= 0) return;

    let record = stock.find((entry) => entry.code === item.code);
    if (!record) {
      record = { code: item.code, name: item.name || '', quantity: 0 };
      stock.push(record);
    }

    record.quantity = Number(record.quantity || 0) - qty;
    if (!record.name && item.name) {
      record.name = item.name;
    }

    appendVanStockHistoryEvent('sold', item.code, item.name || record.name, qty);
  });

  saveVanStock(stock);
  return stock;
}

function quantityByCode(items) {
  const map = new Map();

  (items || []).forEach((item) => {
    if (!item?.code) return;
    const current = map.get(item.code) || { name: item.name || '', quantity: 0 };
    current.quantity += Number(item.quantity || 0);
    if (!current.name && item.name) current.name = item.name;
    map.set(item.code, current);
  });

  return map;
}

/** Rebalance van stock after an existing order is edited (sold more or returned). */
export function adjustVanStockForOrderEdit(previousItems, nextItems) {
  const previous = quantityByCode(previousItems);
  const next = quantityByCode(nextItems);
  const codes = new Set([...previous.keys(), ...next.keys()]);
  const stock = loadVanStock();

  codes.forEach((code) => {
    const prevRecord = previous.get(code);
    const nextRecord = next.get(code);
    const delta = Number(nextRecord?.quantity || 0) - Number(prevRecord?.quantity || 0);
    if (!delta) return;

    const name = nextRecord?.name || prevRecord?.name || '';
    let record = stock.find((entry) => entry.code === code);
    if (!record) {
      record = { code, name, quantity: 0 };
      stock.push(record);
    }

    record.quantity = Number(record.quantity || 0) - delta;
    if (!record.name && name) record.name = name;

    if (delta > 0) {
      appendVanStockHistoryEvent('sold', code, name || record.name, delta);
    } else {
      appendVanStockHistoryEvent('added', code, name || record.name, Math.abs(delta));
    }
  });

  saveVanStock(stock);
  return stock;
}

export function removeVanStockItem(code) {
  const stock = loadVanStock();
  const entry = stock.find((item) => item.code === code);
  if (!entry) return stock;

  const qty = Math.abs(Number(entry.quantity || 0));
  if (qty > 0) {
    appendVanStockHistoryEvent('deleted', entry.code, entry.name, qty);
  }

  const nextStock = stock.filter((item) => item.code !== code);
  saveVanStock(nextStock);
  return nextStock;
}

export function clearVanStock() {
  const stock = loadVanStock();
  stock.forEach((entry) => {
    const qty = Math.abs(Number(entry.quantity || 0));
    if (qty > 0) {
      appendVanStockHistoryEvent('deleted', entry.code, entry.name, qty);
    }
  });

  saveVanStock([]);
  return [];
}

function buildHistorySummaryRows(history) {
  const summaryMap = new Map();

  (history || []).forEach((entry) => {
    const date = entry.date || '';
    const code = entry.code || '';
    if (!date || !code) return;

    const key = `${date}|${code}`;
    if (!summaryMap.has(key)) {
      summaryMap.set(key, {
        date,
        code,
        name: entry.name || '',
        added: 0,
        deleted: 0,
        sold: 0
      });
    }

    const row = summaryMap.get(key);
    const qty = Number(entry.quantity || 0);
    if (entry.type === 'added') row.added += qty;
    else if (entry.type === 'deleted') row.deleted += qty;
    else if (entry.type === 'sold') row.sold += qty;
    if (!row.name && entry.name) row.name = entry.name;
  });

  return Array.from(summaryMap.values()).sort((a, b) => {
    const dateCompare = b.date.localeCompare(a.date);
    if (dateCompare !== 0) return dateCompare;
    return a.code.localeCompare(b.code);
  });
}

/* ===== UI ===== */

const ui = {
  modal: null,
  openBtn: null,
  closeBtn: null,
  productSelect: null,
  qtyInput: null,
  addBtn: null,
  clearBtn: null,
  exportBtn: null,
  tableWrap: null,
  message: null
};

function setVanStockMessage(text) {
  if (ui.message) {
    ui.message.textContent = text || '';
  }
}

export function renderVanStockTable() {
  if (!ui.tableWrap) return;

  const stock = loadVanStock();

  if (!stock.length) {
    ui.tableWrap.innerHTML = '<p class="empty-state">ბორტი ცარიელია — დაამატეთ პროდუქტი ზემოთ ფორმიდან.</p>';
    return;
  }

  const rows = stock
    .map((entry) => {
      const qty = Number(entry.quantity || 0);
      const qtyClass = qty < 0 ? 'van-qty-negative' : qty === 0 ? 'van-qty-zero' : 'van-qty-positive';
      return `
        <tr>
          <td>${escapeHtml(entry.code)}</td>
          <td>${escapeHtml(entry.name || '—')}</td>
          <td class="${qtyClass}">${qty}</td>
          <td class="van-stock-actions-cell">
            <button
              type="button"
              class="van-stock-delete-btn danger-btn"
              data-van-delete="${escapeHtml(entry.code)}"
              title="წაშლა"
            >🗑️</button>
          </td>
        </tr>`;
    })
    .join('');

  const totalUnits = stock.reduce((sum, entry) => sum + Number(entry.quantity || 0), 0);

  ui.tableWrap.innerHTML = `
    <table class="van-stock-table">
      <thead>
        <tr>
          <th>კოდი</th>
          <th>პროდუქტი</th>
          <th>ბორტზე (ც)</th>
          <th>მოქმედება</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr>
          <td colspan="2">სულ ერთეული</td>
          <td>${totalUnits}</td>
          <td></td>
        </tr>
      </tfoot>
    </table>`;
}

function openModal() {
  ui.modal?.classList.remove('is-hidden');
  renderVanStockTable();
}

function closeModal() {
  ui.modal?.classList.add('is-hidden');
  setVanStockMessage('');
}

function handleAddToTruck(products) {
  const code = ui.productSelect?.value;
  const qty = Number(ui.qtyInput?.value || 0);

  if (!code) {
    setVanStockMessage('აირჩიეთ პროდუქტი.');
    return;
  }

  if (!Number.isFinite(qty) || qty <= 0) {
    setVanStockMessage('შეიყვანეთ დადებითი რაოდენობა.');
    return;
  }

  const product = products.find((entry) => entry.code === code);
  addToVanStock(code, product?.name || '', qty);
  renderVanStockTable();
  setVanStockMessage(`${product?.name || code} — დაემატა ${qty} ც ბორტზე.`);

  if (ui.qtyInput) {
    ui.qtyInput.value = '1';
  }
}

async function handleDeleteStockItem(code) {
  const stock = loadVanStock();
  const entry = stock.find((item) => item.code === code);
  if (!entry) return;

  const allowed = await verifyAdminDeleteCode('წასაშლელად შეიყვანეთ კოდი');
  if (!allowed) return;

  const label = entry.name || entry.code;
  if (!window.confirm(`ნამდვილად გსურთ „${label}“ ბორტიდან წაშლა?`)) return;

  removeVanStockItem(code);
  renderVanStockTable();
  setVanStockMessage(`„${label}“ წაიშალა ბორტიდან.`);
}

function handleTableClick(event) {
  const button = event.target.closest('[data-van-delete]');
  if (!button || !ui.tableWrap?.contains(button)) return;
  const code = button.getAttribute('data-van-delete');
  if (!code) return;
  handleDeleteStockItem(code);
}

async function handleClearStock() {
  if (!loadVanStock().length) {
    setVanStockMessage('ბორტი უკვე ცარიელია.');
    return;
  }

  const allowed = await verifyAdminDeleteCode('განულებისთვის შეიყვანეთ კოდი');
  if (!allowed) return;

  if (!window.confirm('ნამდვილად გსურთ ბორტის ყველა ნაშთის განულება?')) return;

  clearVanStock();
  renderVanStockTable();
  setVanStockMessage('ბორტის ნაშთები განულდა.');
}

function downloadBlob(blob, filename) {
  if (window.navigator && typeof window.navigator.msSaveOrOpenBlob === 'function') {
    window.navigator.msSaveOrOpenBlob(blob, filename);
    return;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();

  setTimeout(() => {
    if (link.parentNode) {
      link.parentNode.removeChild(link);
    }
    URL.revokeObjectURL(url);
  }, 200);
}

function exportVanStockToExcel() {
  if (!window.XLSX) {
    window.alert('Excel ბიბლიოთეკა ვერ ჩაიტვირთა. გთხოვთ, განაახლოთ გვერდი.');
    return;
  }

  const stock = loadVanStock();
  const history = loadVanStockHistory();
  if (!stock.length && !history.length) {
    window.alert('ბორტი ცარიელია და ისტორიაც არ არის — ექსპორტი შეუძლებელია.');
    return;
  }

  const exportDate = getLocalDateString();
  const stockRows = stock.map((entry) => [
    entry.code,
    entry.name || '',
    Number(entry.quantity || 0)
  ]);
  const totalUnits = stock.reduce((sum, entry) => sum + Number(entry.quantity || 0), 0);

  const stockSheet = window.XLSX.utils.aoa_to_sheet([
    ['ბორტის ნაშთები'],
    ['თარიღი', exportDate],
    [],
    ['პროდუქტის კოდი', 'პროდუქტი', 'ბორტზე (ც)'],
    ...stockRows,
    [],
    ['', 'სულ ერთეული', totalUnits]
  ]);

  const summaryRows = buildHistorySummaryRows(history);
  const historyTotals = summaryRows.reduce(
    (acc, row) => ({
      added: acc.added + row.added,
      deleted: acc.deleted + row.deleted,
      sold: acc.sold + row.sold
    }),
    { added: 0, deleted: 0, sold: 0 }
  );

  const historySheet = window.XLSX.utils.aoa_to_sheet([
    ['ბორტის ისტორია — დღიური შეჯამება'],
    ['ექსპორტის თარიღი', exportDate],
    [],
    ['თარიღი', 'პროდუქტის კოდი', 'პროდუქტი', 'დაემატა (ც)', 'წაიშალა (ც)', 'გაიყიდა (ც)'],
    ...summaryRows.map((row) => [
      row.date,
      row.code,
      row.name,
      row.added,
      row.deleted,
      row.sold
    ]),
    [],
    ['', '', 'სულ', historyTotals.added, historyTotals.deleted, historyTotals.sold]
  ]);

  const workbook = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(workbook, stockSheet, 'ბორტის_ნაშთები');
  window.XLSX.utils.book_append_sheet(workbook, historySheet, 'ისტორია');

  const workbookBuffer = window.XLSX.write(workbook, {
    bookType: 'xlsx',
    type: 'array'
  });

  const blob = new Blob([new Uint8Array(workbookBuffer)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });

  downloadBlob(blob, `van-stock-${exportDate}.xlsx`);
  setVanStockMessage('Excel ფაილი ჩამოიტვირთა (ნაშთები + ისტორია).');
}

export function initVanStockUI(products) {
  ui.modal = document.querySelector('#vanStockModal');
  ui.openBtn = document.querySelector('#openVanStockBtn');
  ui.closeBtn = document.querySelector('#closeVanStockBtn');
  ui.productSelect = document.querySelector('#vanStockProductSelect');
  ui.qtyInput = document.querySelector('#vanStockQty');
  ui.addBtn = document.querySelector('#vanStockAddBtn');
  ui.clearBtn = document.querySelector('#vanStockClearBtn');
  ui.exportBtn = document.querySelector('#vanStockExportBtn');
  ui.tableWrap = document.querySelector('#vanStockTable');
  ui.message = document.querySelector('#vanStockMessage');

  if (!ui.modal) return;

  if (ui.productSelect) {
    ui.productSelect.innerHTML = '';
    (products || []).forEach((product) => {
      const option = document.createElement('option');
      option.value = product.code;
      option.textContent = `${product.code} — ${product.name}`;
      ui.productSelect.appendChild(option);
    });
  }

  ui.openBtn?.addEventListener('click', openModal);
  ui.closeBtn?.addEventListener('click', closeModal);
  ui.modal.addEventListener('click', (event) => {
    if (event.target === ui.modal) closeModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !ui.modal.classList.contains('is-hidden')) {
      closeModal();
    }
  });

  ui.tableWrap?.addEventListener('click', handleTableClick);
  ui.addBtn?.addEventListener('click', () => handleAddToTruck(products || []));
  ui.exportBtn?.addEventListener('click', exportVanStockToExcel);
  ui.clearBtn?.addEventListener('click', handleClearStock);

  renderVanStockTable();
}
