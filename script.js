const STORAGE_KEY = 'distribucia-orders-v1';

const stock = [
  { code: '1/DB', name: 'ოვალური ვარცლი ლურჯი - L', price: 6.5 },
  { code: '2/DB', name: 'ოვალური ვარცლი ლურჯი - M', price: 5.95 },
  { code: '3/DB', name: 'ოვალური ვარცლი ლურჯი - S', price: 5.45 },
  { code: '4/DB', name: 'მრგვალი ვარცლი ლურჯი - S', price: 3.5 },
  { code: '5/1/BL', name: 'ინდუსტრიული ვარცლი შავი', price: 12.75 },
  { code: '5/DB', name: 'უნივერსალური ვარცლი ლურჯი', price: 8.5 },
  { code: '6/DB', name: 'გობი ერგონომიური სახელურებით ლურჯი - L', price: 4.65 }
];

const form = document.getElementById('orderForm');
const productSelect = document.getElementById('product');
const ordersTable = document.getElementById('ordersTable');
const formMessage = document.getElementById('formMessage');
const totalOrdersNode = document.getElementById('totalOrders');
const totalUnitsNode = document.getElementById('totalUnits');
const topProductNode = document.getElementById('topProduct');
const dailySummaryNode = document.getElementById('dailySummary');
const exportCsvBtn = document.getElementById('exportCsv');
const clearAllBtn = document.getElementById('clearAll');

function seededDate() {
  const today = new Date();
  return today.toISOString().slice(0, 10);
}

function loadOrders() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (error) {
    console.error('Could not parse saved orders', error);
    return [];
  }
}

function saveOrders(orders) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
}

function populateProducts() {
  productSelect.innerHTML = '';
  stock.forEach((item) => {
    const option = document.createElement('option');
    option.value = item.code;
    option.dataset.price = item.price;
    option.textContent = `${item.code} — ${item.name} (${item.price.toFixed(2)} ლ)`;
    productSelect.appendChild(option);
  });
}

function formatDate(value) {
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
}

function getSelectedProduct() {
  const selected = stock.find((item) => item.code === productSelect.value);
  return selected || stock[0];
}

function computeSummary(orders) {
  const totalOrders = orders.length;
  const totalUnits = orders.reduce((sum, order) => sum + Number(order.quantity || 0), 0);

  const productCounts = new Map();
  orders.forEach((order) => {
    const current = productCounts.get(order.productName) || 0;
    productCounts.set(order.productName, current + Number(order.quantity || 0));
  });

  const topProduct = [...productCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '—';

  const daily = new Map();
  orders.forEach((order) => {
    const key = order.orderDate;
    const current = daily.get(key) || { orders: 0, units: 0 };
    current.orders += 1;
    current.units += Number(order.quantity || 0);
    daily.set(key, current);
  });

  totalOrdersNode.textContent = totalOrders;
  totalUnitsNode.textContent = totalUnits;
  topProductNode.textContent = topProduct;

  const days = [...daily.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  if (!days.length) {
    dailySummaryNode.innerHTML = '<p class="empty-state">ჯერ no orders.</p>';
    return;
  }

  dailySummaryNode.innerHTML = days
    .map(([date, stats]) => `
      <div class="daily-item">
        <h4>${formatDate(date)}</h4>
        <div>შეკვეთები: ${stats.orders}</div>
        <div>რაოდენობა: ${stats.units}</div>
      </div>`)
    .join('');
}

function renderOrders(orders) {
  const sortedOrders = [...orders].sort((a, b) => b.orderDate.localeCompare(a.orderDate));
  const groups = new Map();

  sortedOrders.forEach((order) => {
    if (!groups.has(order.orderDate)) groups.set(order.orderDate, []);
    groups.get(order.orderDate).push(order);
  });

  if (!sortedOrders.length) {
    ordersTable.innerHTML = '<div class="empty-state">ჯერ no data. Add a new order to see it here.</div>';
    return;
  }

  ordersTable.innerHTML = [...groups.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, items]) => `
      <div class="day-group">
        <h3>${formatDate(date)}</h3>
        ${items
          .map(
            (order) => `
              <div class="order-row">
                <div>
                  <strong>${order.customer}</strong>
                  <small>${order.distributor}</small>
                </div>
                <div>
                  <span>${order.productCode} — ${order.productName}</span>
                  <small>${order.notes || 'No notes'}</small>
                </div>
                <div>
                  <span>რაოდენობა: ${order.quantity}</span>
                  <small>სტატუსი: ${order.status}</small>
                </div>
                <div>
                  <span>ფასი: ${Number(order.unitPrice).toFixed(2)} ლ</span>
                  <small>סה: ${Number(order.quantity * order.unitPrice).toFixed(2)} ლ</small>
                </div>
                <div>
                  <span>${order.contact || 'No contact'}</span>
                </div>
                <div>
                  <span>${new Date(order.receivedAt).toLocaleString('ka-GE')}</span>
                </div>
              </div>`
          )
          .join('')}
      </div>`)
    .join('');
}

function refreshView() {
  const orders = loadOrders();
  computeSummary(orders);
  renderOrders(orders);
}

function exportCsv() {
  const orders = loadOrders();
  if (!orders.length) {
    formMessage.textContent = 'CSV export unavailable: there are no saved orders yet.';
    return;
  }

  const headers = ['orderDate', 'receivedAt', 'distributor', 'customer', 'contact', 'productCode', 'productName', 'quantity', 'unitPrice', 'status', 'notes'];
  const rows = orders.map((order) => [
    order.orderDate,
    order.receivedAt,
    order.distributor,
    order.customer,
    order.contact,
    order.productCode,
    order.productName,
    order.quantity,
    order.unitPrice,
    order.status,
    order.notes
  ]);

  const csv = [headers, ...rows]
    .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'distribucia-orders.csv';
  link.click();
  URL.revokeObjectURL(url);
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const selected = getSelectedProduct();
  const quantity = Number(document.getElementById('quantity').value);
  const newOrder = {
    orderDate: document.getElementById('orderDate').value,
    distributor: document.getElementById('distributor').value.trim(),
    customer: document.getElementById('customer').value.trim(),
    contact: document.getElementById('contact').value.trim(),
    productCode: selected.code,
    productName: selected.name,
    unitPrice: selected.price,
    quantity,
    status: document.getElementById('status').value,
    notes: document.getElementById('notes').value.trim(),
    receivedAt: new Date().toISOString()
  };

  const orders = loadOrders();
  orders.push(newOrder);
  saveOrders(orders);
  form.reset();
  document.getElementById('orderDate').value = seededDate();
  document.getElementById('quantity').value = 1;
  document.getElementById('status').value = 'მიღებულია';
  formMessage.textContent = `შეკვეთა მიღებულია: ${newOrder.productName}`;
  refreshView();
});

exportCsvBtn.addEventListener('click', exportCsv);

clearAllBtn.addEventListener('click', () => {
  if (!confirm('Are you sure you want to clear all saved orders?')) return;
  localStorage.removeItem(STORAGE_KEY);
  refreshView();
  formMessage.textContent = 'All saved orders were cleared.';
});

populateProducts();
const today = seededDate();
if (document.getElementById('orderDate').value === '') {
  document.getElementById('orderDate').value = today;
}
refreshView();
