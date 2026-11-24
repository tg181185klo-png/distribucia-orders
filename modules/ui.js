import { formatDate, toCurrency } from './orderutils.js?v=20261124a';

const dom = {
  saleForm: document.querySelector('#saleForm'),
  storeName: document.querySelector('#storeName'),
  storePhone: document.querySelector('#storePhone'),
  storeAddress: document.querySelector('#storeAddress'),
  storeNameSuggestions: document.querySelector('#storeNameSuggestions'),
  productSearch: document.querySelector('#productSearch'),
  productSearchHint: document.querySelector('#productSearchHint'),
  productSearchWrap: document.querySelector('.product-search-wrap'),
  productSelect: document.querySelector('#productSelect'),
  productSuggestions: document.querySelector('#productSuggestions'),
  quantity: document.querySelector('#quantity'),
  priceInput: document.querySelector('#priceInput'),
  subtotalDisplay: document.querySelector('#subtotalDisplay'),
  formMessage: document.querySelector('#formMessage'),
  dailyReport: document.querySelector('#dailyReport'),
  totalDailySales: document.querySelector('#totalDailySales'),
  reportDate: document.querySelector('#reportDate'),
  clearBtn: document.querySelector('#clearOrders')
};

dom.addToCartBtn = document.querySelector('#addToCartBtn');
dom.clearCartBtn = document.querySelector('#clearCartBtn');
dom.cartTable = document.querySelector('#cartTable');
dom.completeOrderBtn = document.querySelector('#completeOrderBtn');
dom.cancelEditBtn = document.querySelector('#cancelEditBtn');
dom.openHistoryWindow = document.querySelector('#openHistoryWindow');
dom.cartTotal = document.querySelector('#cartTotal');
dom.cartSummary = document.querySelector('#cartSummary');
dom.orderFormTitle = document.querySelector('#orderFormTitle');
dom.cartTitle = document.querySelector('#cartTitle');
dom.editBanner = document.querySelector('#editBanner');

function normalizeSearch(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function hideSuggestList(listEl) {
  if (!listEl) return;
  listEl.hidden = true;
  listEl.innerHTML = '';
}

function showSuggestList(listEl, items, renderItem) {
  if (!listEl) return;

  if (!items.length) {
    hideSuggestList(listEl);
    return;
  }

  listEl.innerHTML = items.map(renderItem).join('');
  listEl.hidden = false;
}

export function setProductOptions(products, selectedCode = '') {
  const product = selectedCode
    ? products.find((entry) => entry.code === selectedCode) || null
    : null;

  if (dom.productSearchHint) {
    const names = (products || []).map((entry) => entry.name).filter(Boolean);
    dom.productSearchHint.textContent = names.length
      ? names.join(' · ')
      : 'ჩაწერეთ კოდი ან დასახელება';
  }

  if (product) {
    setSelectedProductDisplay(product);
    return;
  }

  if (dom.productSelect) {
    dom.productSelect.value = '';
  }

  if (dom.productSearch) {
    dom.productSearch.value = '';
  }

  syncProductHintVisibility();
  hideSuggestList(dom.productSuggestions);
}

function syncProductHintVisibility() {
  if (!dom.productSearchWrap) return;
  const hasValue = Boolean(dom.productSearch?.value.trim());
  dom.productSearchWrap.classList.toggle('has-value', hasValue);
}

export function setSelectedProductDisplay(product) {
  if (dom.productSelect) {
    dom.productSelect.value = product?.code || '';
  }

  if (dom.productSearch) {
    dom.productSearch.value = product ? `${product.code} — ${product.name}` : '';
  }

  syncProductHintVisibility();
  hideSuggestList(dom.productSuggestions);
}

export function clearProductSelection() {
  if (dom.productSelect) {
    dom.productSelect.value = '';
  }

  if (dom.productSearch) {
    dom.productSearch.value = '';
  }

  syncProductHintVisibility();
  hideSuggestList(dom.productSuggestions);
}

export function filterProducts(products, query) {
  const q = normalizeSearch(query);
  if (!q) return [];

  return products.filter((product) => {
    const code = normalizeSearch(product.code);
    const name = normalizeSearch(product.name);
    return code.includes(q) || name.includes(q);
  });
}

export function renderProductSuggestions(products, query, onPick) {
  const matches = filterProducts(products, query);
  showSuggestList(dom.productSuggestions, matches, (product, index) => {
    return `
      <button type="button" class="suggest-item" data-index="${index}" data-code="${escapeHtml(product.code)}">
        <strong>${escapeHtml(product.code)}</strong>
        <span>${escapeHtml(product.name)}</span>
        <em>${Number(product.price || 0).toFixed(2)} ლ</em>
      </button>`;
  });

  dom.productSuggestions?.querySelectorAll('.suggest-item').forEach((button) => {
    button.addEventListener('mousedown', (event) => {
      event.preventDefault();
      const code = button.dataset.code;
      const product = products.find((entry) => entry.code === code);
      if (product) onPick(product);
    });
  });
}

export function collectStoreDirectory(sales) {
  const byKey = new Map();

  (sales || []).forEach((sale) => {
    const name = String(sale.storeName || '').trim();
    const phone = String(sale.storePhone || '').trim();
    const address = String(sale.storeAddress || '').trim();
    if (!name && !phone && !address) return;

    const key = [
      normalizeSearch(name),
      normalizeSearch(phone),
      normalizeSearch(address)
    ].join('|');

    if (!byKey.has(key)) {
      byKey.set(key, {
        storeName: name,
        storePhone: phone,
        storeAddress: address
      });
    }
  });

  return [...byKey.values()].sort((a, b) =>
    a.storeName.localeCompare(b.storeName, 'ka') ||
    a.storePhone.localeCompare(b.storePhone, 'ka')
  );
}

function matchStoreField(directory, field, query) {
  const q = normalizeSearch(query);
  if (!q) return [];

  return directory
    .filter((entry) => normalizeSearch(entry[field]).includes(q))
    .slice(0, 40);
}

function findUniqueAutoMatch(directory, field, query) {
  const q = normalizeSearch(query);
  if (q.length < 2) return null;

  const matches = matchStoreField(directory, field, q);
  if (!matches.length) return null;

  const startsWith = matches.filter((entry) => normalizeSearch(entry[field]).startsWith(q));
  if (startsWith.length === 1) return startsWith[0];
  if (matches.length === 1) return matches[0];
  return null;
}

export function renderStoreSuggestions(listEl, matches, onPick) {
  showSuggestList(listEl, matches, (entry, index) => {
    const title = escapeHtml(entry.storeName || '—');
    const meta = [entry.storePhone, entry.storeAddress]
      .filter(Boolean)
      .map(escapeHtml)
      .join(' · ');
    return `
      <button type="button" class="suggest-item" data-index="${index}">
        <strong>${title}</strong>
        ${meta ? `<span>${meta}</span>` : ''}
      </button>`;
  });

  listEl?.querySelectorAll('.suggest-item').forEach((button) => {
    button.addEventListener('mousedown', (event) => {
      event.preventDefault();
      const index = Number(button.dataset.index);
      const entry = matches[index];
      if (entry) onPick(entry);
    });
  });
}

export function bindStoreAutocomplete(getDirectory, onPick) {
  const input = dom.storeName;
  const list = dom.storeNameSuggestions;
  if (!input || !list) return;

  const handleQuery = () => {
    const query = input.value;
    if (!normalizeSearch(query)) {
      hideSuggestList(list);
      return;
    }

    const directory = getDirectory();
    const matches = matchStoreField(directory, 'storeName', query);

    const unique = findUniqueAutoMatch(directory, 'storeName', query);
    if (unique) {
      onPick({ ...unique, storeName: query }, { auto: true, sourceField: 'storeName' });
    }

    renderStoreSuggestions(list, matches, (entry) => {
      onPick(entry, { auto: false, sourceField: 'storeName' });
      hideSuggestList(list);
    });
  };

  input.addEventListener('input', handleQuery);
  input.addEventListener('blur', () => {
    window.setTimeout(() => hideSuggestList(list), 150);
  });
}

export function bindProductSearch(getProducts, onPick) {
  if (!dom.productSearch) return;

  const handleQuery = () => {
    if (dom.productSelect) dom.productSelect.value = '';
    syncProductHintVisibility();

    const query = dom.productSearch.value;
    if (!normalizeSearch(query)) {
      hideSuggestList(dom.productSuggestions);
      return;
    }

    renderProductSuggestions(getProducts(), query, (product) => {
      onPick(product);
    });
  };

  dom.productSearch.addEventListener('input', handleQuery);

  dom.productSearch.addEventListener('blur', () => {
    window.setTimeout(() => hideSuggestList(dom.productSuggestions), 150);
  });

  dom.productSearch.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();

    const matches = filterProducts(getProducts(), dom.productSearch.value);
    if (matches[0]) onPick(matches[0]);
  });
}

export function fillStoreFields(entry, options = {}) {
  const sourceField = options.sourceField || '';
  const auto = Boolean(options.auto);

  if (dom.storeName && (!auto || sourceField !== 'storeName')) {
    dom.storeName.value = entry?.storeName || '';
  }

  if (dom.storePhone) dom.storePhone.value = entry?.storePhone || '';
  if (dom.storeAddress) dom.storeAddress.value = entry?.storeAddress || '';
}

export function setPriceInput(price) {
  dom.priceInput.value = Number(price || 0).toFixed(2);
}

export function updateSubtotal(subtotal) {
  dom.subtotalDisplay.textContent = toCurrency(subtotal);
}

export function setMessage(message) {
  dom.formMessage.textContent = message;
}

export function renderCart(items, summary = null) {
  const cartTotal = (items || []).reduce((sum, item) => sum + Number(item.total || 0), 0);

  if (dom.cartTotal) {
    dom.cartTotal.textContent = toCurrency(cartTotal);
  }

  if (!items || items.length === 0) {
    dom.cartTable.innerHTML = '<p class="empty-state">კალათა ცარიელია.</p>';
    if (dom.cartSummary) {
      dom.cartSummary.innerHTML = '';
      dom.cartSummary.hidden = true;
    }
    return;
  }

  let html = `
    <table class="cart-table">
      <thead>
        <tr>
          <th>კოდი</th>
          <th>დასახელება</th>
          <th>რაოდენობა</th>
          <th>ერთი ფასი</th>
          <th>ჯამი</th>
          <th></th>
        </tr>
      </thead>
      <tbody>`;

  items.forEach((item) => {
    const priceClass = item.priceModified ? ' class="price-modified"' : '';
    html += `
      <tr data-code="${item.code}">
        <td>${item.code}</td>
        <td>${item.name}</td>
        <td><input data-field="quantity" data-code="${item.code}" type="number" min="1" value="${item.quantity}" /></td>
        <td${priceClass}>${toCurrency(item.unitPrice)}${item.priceModified ? ' ✎' : ''}</td>
        <td>${toCurrency(item.total)}</td>
        <td><button data-action="remove" data-code="${item.code}" class="danger-btn">წაშლა</button></td>
      </tr>`;
  });

  html += `</tbody></table>`;
  dom.cartTable.innerHTML = html;

  if (dom.cartSummary) {
    dom.cartSummary.innerHTML = '';
    dom.cartSummary.hidden = true;
  }
}

function renderOrderFoldList(sales) {
  if (!sales.length) {
    dom.dailyReport.innerHTML = '<p class="empty-state">ამ დღესათვის არცერთი შეკვეთა არ არის.</p>';
    return;
  }

  dom.dailyReport.innerHTML = `<div class="order-fold-list">${sales
    .map((sale) => {
      const lines = (sale.items || [])
        .map(
          (item) => `
            <div class="order-fold-line">
              <span>${escapeHtml(item.code ? `${item.code} — ` : '')}${escapeHtml(item.name || '')}</span>
              <span>${escapeHtml(item.quantity)} ც</span>
              <span>${toCurrency(item.total)}</span>
            </div>`
        )
        .join('');

      return `
        <details class="order-fold">
          <summary>
            <span class="order-fold-name">${escapeHtml(sale.storeName || 'უცნობი')}</span>
            <strong>${toCurrency(sale.totalAmount)}</strong>
          </summary>
          <div class="order-fold-body">
            ${lines || '<p class="empty-state">პროდუქტები არ არის.</p>'}
          </div>
        </details>`;
    })
    .join('')}</div>`;
}

export function renderDailyReport(report, sales) {
  dom.totalDailySales.textContent = toCurrency(report.total || 0);

  if (document.documentElement.classList.contains('phone-app')) {
    renderOrderFoldList(Array.isArray(sales) ? sales : []);
    return;
  }

  if (!report.stores.length) {
    dom.dailyReport.innerHTML = '<p class="empty-state">ამ დღესათვის არცერთი შეკვეთა არ არის.</p>';
    return;
  }

  dom.dailyReport.innerHTML = report.stores
    .map(
      (store) => `
        <article class="report-card">
          <div>
            <p class="report-label">სახელი გვარი</p>
            <h3>${store.storeName}</h3>
          </div>
          <div>
            <p><strong>შეკვეთები:</strong> ${store.salesCount}</p>
            <p><strong>რაოდენობა:</strong> ${store.units}</p>
            <p><strong>ჯამი:</strong> ${toCurrency(store.total)}</p>
          </div>
        </article>`
    )
    .join('');
}

export function getFormValues() {
  return {
    storeName: dom.storeName.value.trim(),
    storePhone: dom.storePhone?.value.trim() || '',
    storeAddress: dom.storeAddress?.value.trim() || '',
    quantity: Number(dom.quantity.value || 1)
  };
}

export function getPriceValue() {
  return Number(dom.priceInput.value || 0);
}

export function getSelectedProductCode() {
  return dom.productSelect?.value || '';
}

export function setReportDate(value) {
  dom.reportDate.value = value;
}

export function bindClearButton(handler) {
  dom.clearBtn?.addEventListener('click', handler);
}

export function bindProductChange(handler) {
  // Product selection is handled via searchable input bindings.
}

export function bindPriceChange(handler) {
  dom.priceInput?.addEventListener('change', handler);
}

export function bindPriceInput(handler) {
  dom.priceInput?.addEventListener('input', handler);
}

export function bindQuantityInput(handler) {
  dom.quantity?.addEventListener('input', handler);
}

export function bindReportDateChange(handler) {
  dom.reportDate?.addEventListener('change', handler);
}

export function bindAddToCart(handler) {
  dom.addToCartBtn?.addEventListener('click', handler);
}

export function bindClearCart(handler) {
  dom.clearCartBtn?.addEventListener('click', handler);
}

export function bindCompleteOrder(handler) {
  dom.completeOrderBtn?.addEventListener('click', handler);
}

export function bindCancelEdit(handler) {
  dom.cancelEditBtn?.addEventListener('click', handler);
}

export function setOrderFormMode({ editing = false, summary = '' } = {}) {
  if (dom.orderFormTitle) {
    dom.orderFormTitle.textContent = editing ? 'შეკვეთის რედაქტირება' : 'ახალი შეკვეთა';
  }

  if (dom.cartTitle) {
    dom.cartTitle.textContent = editing ? 'შენახული შეკვეთა' : 'ინ-პროგრეს შეკვეთა';
  }

  if (dom.completeOrderBtn) {
    dom.completeOrderBtn.textContent = editing ? 'განახლება და შენახვა' : 'დასრულება და შენახვა';
  }

  if (dom.cancelEditBtn) {
    dom.cancelEditBtn.hidden = !editing;
  }

  if (dom.editBanner) {
    if (editing) {
      dom.editBanner.hidden = false;
      dom.editBanner.textContent = summary
        ? `რედაქტირდება შენახული შეკვეთა: ${summary}`
        : 'რედაქტირდება შენახული შეკვეთა.';
    } else {
      dom.editBanner.hidden = true;
      dom.editBanner.textContent = '';
    }
  }

  document.querySelector('#saleForm')?.classList.toggle('is-editing', Boolean(editing));
}

export function bindCartTableActions(handler) {
  dom.cartTable?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    handler(btn.dataset.action, btn.dataset.code);
  });

  dom.cartTable?.addEventListener('input', (e) => {
    const input = e.target.closest('input[data-field]');
    if (!input) return;
    handler('updateQty', input.dataset.code, Number(input.value));
  });
}

export function bindOpenHistoryWindow(handler) {
  dom.openHistoryWindow?.addEventListener('click', handler);
}
