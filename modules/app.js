import { loadProducts } from './catalog.js?v=20261117a';
import { addSale, loadConsignmentAlerts, loadSales, loadStores } from './storage.js?v=20261124e';
import {
  buildSaleOrder,
  calculateSubtotal,
  formatDate,
  getDailyReport,
  getLocalDateString,
  getLocalTimeString,
  toCurrency
} from './orderutils.js?v=20261124e';
import {
  bindAddToCart,
  bindCartTableActions,
  bindClearCart,
  bindCompleteOrder,
  bindCancelEdit,
  bindOpenHistoryWindow,
  bindPriceChange,
  bindPriceInput,
  bindProductSearch,
  bindQuantityInput,
  bindReportDateChange,
  bindStoreAutocomplete,
  collectStoreDirectory,
  fillStoreFields,
  getFormValues,
  getPriceValue,
  getSelectedProductCode,
  renderCart,
  renderDailyReport,
  setMessage,
  setOrderFormMode,
  setPriceInput,
  setProductOptions,
  setReportDate,
  setSelectedProductDisplay,
  clearProductSelection,
  updateSubtotal
} from './ui.js?v=20261124e';
import { adjustVanStockForOrderEdit, deductSoldItems, initVanStockUI, renderVanStockTable } from './vanstock.js?v=20261124a';
import { verifyAdminDeleteCode } from './passwordprompt.js';

const EDIT_UNLOCK_KEY = 'orderEditUnlock';
const EDIT_UNLOCK_MS = 10 * 60 * 1000;

const state = {
  products: [],
  selectedProduct: null,
  reportDate: getLocalDateString(),
  cart: [],
  cartMeta: null,
  lastAddedSummary: null,
  storeDirectory: [],
  editingSale: null
};

function pricesDiffer(a, b) {
  return Math.abs(Number(a || 0) - Number(b || 0)) > 0.0001;
}

function cloneCartItems(items) {
  return (items || []).map((item) => ({
    code: item.code,
    name: item.name,
    quantity: Number(item.quantity || 0),
    unitPrice: Number(item.unitPrice || 0),
    catalogPrice: Number(item.catalogPrice ?? item.unitPrice ?? 0),
    priceModified: Boolean(item.priceModified),
    total: Number(item.total || Number(item.quantity || 0) * Number(item.unitPrice || 0))
  }));
}

function readEditUnlock(saleId) {
  try {
    const raw = sessionStorage.getItem(EDIT_UNLOCK_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    return data?.id === saleId && Date.now() - Number(data.at || 0) < EDIT_UNLOCK_MS;
  } catch (error) {
    return false;
  }
}

function clearEditUnlock() {
  sessionStorage.removeItem(EDIT_UNLOCK_KEY);
}

function clearEditQuery() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('edit')) return;
  url.searchParams.delete('edit');
  const next = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState({}, '', next);
}

function editingSummary(sale) {
  if (!sale) return '';
  const name = sale.storeName || 'უცნობი';
  const date = sale.saleDate ? formatDate(sale.saleDate) : '';
  return date ? `${name} (${date})` : name;
}

function applyEditingUi() {
  setOrderFormMode({
    editing: Boolean(state.editingSale),
    summary: editingSummary(state.editingSale)
  });
}

function resetCartState() {
  state.cart = [];
  state.cartMeta = null;
  state.lastAddedSummary = null;
  renderCart(state.cart, null);
}

function enterEditMode(sale) {
  state.editingSale = sale;
  state.cart = cloneCartItems(sale.items);
  state.cartMeta = {
    storeName: sale.storeName || '',
    storePhone: sale.storePhone || ''
  };
  state.lastAddedSummary = null;

  if (sale.saleDate) {
    state.reportDate = sale.saleDate;
    setReportDate(sale.saleDate);
  }

  fillStoreFields({
    storeName: sale.storeName || '',
    storePhone: sale.storePhone || '',
    storeAddress: sale.storeAddress || ''
  });
  setConsignmentForm(sale);

  applyEditingUi();
  renderCart(state.cart, null);
  resetSelectionToDefault();
  setMessage('შენახული შეკვეთა ჩაიტვირთა. შეცვალეთ და დააჭირეთ „განახლება და შენახვა“.');
}

function exitEditMode({ clearForm = true } = {}) {
  state.editingSale = null;
  clearEditUnlock();
  clearEditQuery();
  applyEditingUi();

  if (clearForm) {
    resetCartState();
    fillStoreFields({ storeName: '', storePhone: '', storeAddress: '' });
    setConsignmentForm(null);
    resetSelectionToDefault();
  }
}

async function maybeStartEditingFromQuery() {
  const editId = new URLSearchParams(window.location.search).get('edit');
  if (!editId) return;

  const sales = await loadSales({ id: editId });
  const sale = sales.find((entry) => entry.id === editId);
  if (!sale) {
    clearEditUnlock();
    clearEditQuery();
    setMessage('რედაქტირებისთვის შეკვეთა ვერ მოიძებნა.');
    return;
  }

  const alreadyUnlocked = readEditUnlock(editId);
  if (!alreadyUnlocked) {
    const allowed = await verifyAdminDeleteCode('რედაქტირებისთვის შეიყვანეთ კოდი');
    if (!allowed) {
      clearEditUnlock();
      clearEditQuery();
      return;
    }
  }

  clearEditUnlock();
  enterEditMode(sale);
}

function resetSelectionToDefault() {
  state.selectedProduct = null;
  clearProductSelection();

  const quantityInput = document.querySelector('#quantity');
  if (quantityInput) {
    quantityInput.value = '1';
  }

  setPriceInput(0);
  refreshCurrentSubtotal();
}

function refreshCurrentSubtotal() {
  const quantity = Number(getFormValues().quantity || 1);
  const price = Number(getPriceValue() || state.selectedProduct?.price || 0);
  updateSubtotal(calculateSubtotal(quantity, price));
}

function consignmentBox() {
  return document.querySelector('#consignmentCheck');
}

function consignmentDueInput() {
  return document.querySelector('#consignmentDue');
}

function consignmentOn() {
  return Boolean(consignmentBox()?.checked);
}

function consignmentDueValue() {
  return consignmentDueInput()?.value || '';
}

function setConsignmentForm(sale) {
  const box = consignmentBox();
  const due = consignmentDueInput();
  const wrap = document.querySelector('#consignmentDueWrap');
  const on = Boolean(sale?.consignment) && !sale?.consignmentSettled;
  if (box) box.checked = on;
  if (due) due.value = on ? sale.consignmentDue || '' : '';
  if (wrap) wrap.hidden = !on;
}

async function refreshConsignmentAlerts() {
  const box = document.querySelector('#consignmentAlerts');
  if (!box) return;
  let alerts = [];
  try {
    alerts = await loadConsignmentAlerts();
  } catch (error) {
    alerts = [];
  }
  if (!alerts.length) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  box.hidden = false;
  const safe = (value) =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/"/g, '&quot;');
  box.innerHTML = `<strong>ვადაგადაცილებული კონსიგნაცია: ${alerts.length}</strong>${alerts
    .map(
      (alert) => `
        <div class="consignment-alert-row">
          <span>${safe(alert.storeName || 'უცნობი')} · ${formatDate(alert.consignmentDue)} · ${toCurrency(alert.totalAmount)}</span>
          <button type="button" class="secondary-btn settle-consignment" data-sale-id="${safe(alert.id)}">გასტუმრებულია</button>
        </div>`
    )
    .join('')}`;
}

async function settleConsignment(saleId) {
  if (!saleId) return;
  const allowed = await verifyAdminDeleteCode('კონსიგნაციის გასტუმრებისთვის შეიყვანეთ კოდი');
  if (!allowed) return;
  const sales = await loadSales({ id: saleId });
  const sale = sales.find((entry) => entry.id === saleId);
  if (!sale) {
    setMessage('შეკვეთა ვერ მოიძებნა.');
    return;
  }
  await addSale({
    ...sale,
    consignmentSettled: true,
    updatedAt: new Date().toISOString()
  });
  await refreshView();
  setMessage('კონსიგნაცია მონიშნულია გასტუმრებულად.');
}

function isPhoneApp() {
  return document.documentElement.classList.contains('phone-app');
}

function showPhoneReport() {
  const panel = document.querySelector('.report-panel');
  if (!panel) return;
  panel.classList.add('is-open');
  if (panel.scrollIntoView) panel.scrollIntoView();
}

async function refreshStoreDirectory() {
  const sales = await loadSales({ date: state.reportDate });
  try {
    state.storeDirectory = await loadStores();
  } catch (error) {
    state.storeDirectory = collectStoreDirectory(sales);
  }
  return sales;
}

async function refreshView() {
  const sales = await refreshStoreDirectory();
  const report = getDailyReport(sales, state.reportDate);
  renderDailyReport(report, sales);

  const reportLabel = document.querySelector('#reportLabel');
  if (reportLabel) {
    reportLabel.textContent = `დღიური ანგარიში — ${formatDate(state.reportDate)}`;
  }

  renderCart(state.cart, state.lastAddedSummary);
  refreshCurrentSubtotal();
  await refreshConsignmentAlerts();
}

function handleProductPick(product) {
  state.selectedProduct = product;
  setSelectedProductDisplay(product);
  setPriceInput(product?.price || 0);

  const quantityInput = document.querySelector('#quantity');
  if (quantityInput) {
    quantityInput.value = '1';
  }

  refreshCurrentSubtotal();
}

function handleAddToCart() {
  const formValues = getFormValues();
  const { storeName, storePhone, quantity } = formValues;

  if (!storeName) {
    setMessage('გთხოვთ, შეავსეთ სახელი და გვარი.');
    return;
  }

  if (!state.selectedProduct || !getSelectedProductCode()) {
    setMessage('აირჩიეთ პროდუქტი სიიდან (კოდით ან სახელით).');
    return;
  }

  if (!state.editingSale && state.cart.length > 0 && state.cartMeta && state.cartMeta.storeName !== storeName) {
    if (!window.confirm('კალათაში არსებობს სხვა პირის ნივთები. მათი წაშლა და ახალის დაწყება გსურთ?')) {
      return;
    }

    state.cart = [];
    state.cartMeta = null;
  }

  const catalogPrice = Number(state.selectedProduct.price || 0);
  const unitPrice = Number(getPriceValue() || catalogPrice || 0);
  const qty = Number(quantity || 1);
  const priceModified = pricesDiffer(unitPrice, catalogPrice);
  const item = {
    code: state.selectedProduct.code,
    name: state.selectedProduct.name,
    quantity: qty,
    unitPrice,
    catalogPrice,
    priceModified,
    total: calculateSubtotal(qty, unitPrice)
  };

  const existing = state.cart.find((entry) => entry.code === item.code);
  if (existing) {
    existing.quantity = Number(existing.quantity || 0) + item.quantity;
    existing.unitPrice = item.unitPrice;
    existing.catalogPrice = item.catalogPrice;
    existing.priceModified = item.priceModified || existing.priceModified;
    existing.total = calculateSubtotal(existing.quantity, existing.unitPrice);
  } else {
    state.cart.push(item);
  }

  state.lastAddedSummary = {
    code: item.code,
    name: item.name,
    quantity: existing ? existing.quantity : item.quantity,
    total: existing ? existing.total : item.total,
    unitPrice: item.unitPrice,
    priceModified: existing ? existing.priceModified : item.priceModified
  };

  state.cartMeta = { storeName, storePhone: storePhone || '' };
  setMessage(`${item.name} დაემატა კალათაში.`);
  renderCart(state.cart, state.lastAddedSummary);
  resetSelectionToDefault();
}

function handleClearCart() {
  if (!state.cart.length) return;
  if (!window.confirm('ნამდვილად გსურთ კალათის გაწმენდა?')) return;

  state.cart = [];
  state.cartMeta = null;
  state.lastAddedSummary = null;
  renderCart(state.cart, null);
  setMessage('კალათა განახლებულია.');
}

function handleCartTableAction(action, code, value) {
  if (action === 'remove') {
    state.cart = state.cart.filter((entry) => entry.code !== code);
    if (state.lastAddedSummary?.code === code) {
      state.lastAddedSummary = null;
    }
    renderCart(state.cart, state.lastAddedSummary);
    return;
  }

  if (action === 'updateQty') {
    const item = state.cart.find((entry) => entry.code === code);
    if (!item) return;

    item.quantity = Number(value || 1);
    item.total = calculateSubtotal(item.quantity, item.unitPrice);

    if (state.lastAddedSummary?.code === code) {
      state.lastAddedSummary = {
        ...state.lastAddedSummary,
        quantity: item.quantity,
        total: item.total
      };
    }

    renderCart(state.cart, state.lastAddedSummary);
  }
}

async function handleCompleteOrder() {
  const formValues = getFormValues();
  const { storeName, storePhone, storeAddress } = formValues;

  if (!storeName) {
    setMessage('გთხოვთ, შეავსეთ სახელი და გვარი.');
    return;
  }

  if (!state.cart.length) {
    setMessage('კალათა ცარიელია. დაამატეთ პროდუქტი და სცადეთ თავიდან.');
    return;
  }

  if (consignmentOn() && !consignmentDueValue()) {
    setMessage('კონსიგნაციას სჭირდება თარიღი — როდის გაისტუმრებს.');
    return;
  }

  const total = state.cart.reduce((sum, item) => sum + Number(item.total || 0), 0);
  const isEditing = Boolean(state.editingSale);
  const confirmText = isEditing
    ? `დადასტურება: განახლება (${toCurrency(total)})?`
    : `დადასტურება: შენახვა (${toCurrency(total)})?`;
  if (!window.confirm(confirmText)) return;

  const previousItems = isEditing ? cloneCartItems(state.editingSale.items) : [];
  const sale = buildSaleOrder({
    id: state.editingSale?.id,
    createdAt: state.editingSale?.createdAt,
    updatedAt: new Date().toISOString(),
    items: state.cart,
    storeName,
    storePhone: storePhone || '',
    storeAddress: storeAddress || '',
    saleDate: isEditing ? (state.editingSale.saleDate || state.reportDate) : state.reportDate,
    saleTime: isEditing ? (state.editingSale.saleTime || getLocalTimeString()) : getLocalTimeString(),
    status: state.editingSale?.status || 'მიღებულია',
    notes: state.editingSale?.notes || '',
    consignment: consignmentOn(),
    consignmentDue: consignmentOn() ? consignmentDueValue() : '',
    consignmentSettled: consignmentOn() ? Boolean(state.editingSale?.consignmentSettled) : false
  });

  await addSale(sale);
  await refreshStoreDirectory();

  if (isEditing) {
    adjustVanStockForOrderEdit(previousItems, sale.items);
  } else {
    deductSoldItems(sale.items);
  }
  renderVanStockTable();

  const savedDate = sale.saleDate || state.reportDate;
  exitEditMode({ clearForm: true });

  if (isPhoneApp()) {
    state.reportDate = savedDate;
    setReportDate(state.reportDate);
    await refreshView();
    showPhoneReport();
    setMessage('შეკვეთა შენახულია. ქვემოთ დღევანდელი ანგარიშია.');
    return;
  }

  window.location.assign(`history.html?date=${encodeURIComponent(savedDate)}`);
}

function handleCancelEdit() {
  if (!state.editingSale) return;
  if (!window.confirm('რედაქტირება გაუქმდეს? ცვლილებები არ შეინახება.')) return;

  const date = state.editingSale.saleDate || state.reportDate;
  exitEditMode({ clearForm: true });
  window.location.assign(`history.html?date=${encodeURIComponent(date)}`);
}

function handleOpenHistoryWindow() {
  if (isPhoneApp()) {
    showPhoneReport();
    return;
  }
  window.location.assign(`history.html?date=${encodeURIComponent(state.reportDate)}`);
}

function handleOpenHistoryFromMainButton() {
  if (isPhoneApp()) {
    const panel = document.querySelector('.report-panel');
    if (panel && panel.classList.contains('is-open')) {
      panel.classList.remove('is-open');
      return;
    }
    showPhoneReport();
    return;
  }
  window.location.assign(`history.html?date=${encodeURIComponent(state.reportDate)}`);
}

function handlePriceChange(event) {
  const product = state.selectedProduct;
  if (!product) return;

  const proposed = Number(event.target.value);
  const original = Number(product.price || 0);

  if (!Number.isFinite(proposed)) {
    setPriceInput(original.toFixed(2));
    return;
  }

  if (!pricesDiffer(proposed, original)) return;

  if (!window.confirm('ნამდვილად გსურთ ფასის შეცვლა?')) {
    setPriceInput(original.toFixed(2));
    return;
  }

  setPriceInput(proposed.toFixed(2));
  refreshCurrentSubtotal();
}

function handleQuantityInput() {
  refreshCurrentSubtotal();
}

async function handleReportDateChange(event) {
  state.reportDate = event.target.value || getLocalDateString();
  await refreshView();
}

async function init() {
  state.products = await loadProducts();
  state.selectedProduct = null;
  setProductOptions(state.products);
  // Date picker always defaults to today's local date; today's report loads immediately.
  state.reportDate = getLocalDateString();
  setReportDate(state.reportDate);
  setPriceInput(0);
  renderCart(state.cart);
  initVanStockUI(state.products);
  await refreshView();
  applyEditingUi();
  if (isPhoneApp() && new URLSearchParams(window.location.search).get('report') === '1') {
    showPhoneReport();
  }
  await maybeStartEditingFromQuery();
}

bindProductSearch(() => state.products, handleProductPick);
bindStoreAutocomplete(
  () => state.storeDirectory,
  (entry, options = {}) => {
    fillStoreFields(entry, options);
    if (!options.auto) {
      setMessage(`შევსებულია: ${entry.storeName || entry.storePhone || 'მონაცემი'}`);
    }
  }
);
bindPriceChange(handlePriceChange);
bindPriceInput(refreshCurrentSubtotal);
bindQuantityInput(handleQuantityInput);
bindReportDateChange(handleReportDateChange);
bindAddToCart(handleAddToCart);
bindClearCart(handleClearCart);
bindCartTableActions(handleCartTableAction);
bindCompleteOrder(handleCompleteOrder);
bindCancelEdit(handleCancelEdit);
bindOpenHistoryWindow(handleOpenHistoryWindow);

document.querySelector('#historyBtn')?.addEventListener('click', handleOpenHistoryFromMainButton);
document.querySelector('#consignmentCheck')?.addEventListener('change', () => {
  const wrap = document.querySelector('#consignmentDueWrap');
  if (wrap) wrap.hidden = !consignmentOn();
});
document.body.addEventListener('click', (event) => {
  const button = event.target.closest('.settle-consignment');
  if (!button) return;
  event.preventDefault();
  settleConsignment(button.dataset.saleId);
});

init();
