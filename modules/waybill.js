// Read a waybill (ზედნადები) from Excel, PDF, or a photo and match
// each row to the product catalog with the quantity printed on the document.

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cellText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normCode(value) {
  return cellText(value).toUpperCase().replace(/\s+/g, '');
}

function normName(value) {
  return cellText(value)
    .toLowerCase()
    .replace(/[\s.,\-–—_/|()]+/g, '');
}

function parseNumber(value) {
  const text = cellText(value).replace(/\s/g, '').replace(',', '.');
  if (!text || !/^\d+(\.\d+)?$/.test(text)) return null;
  const number = Number(text);
  if (!Number.isFinite(number) || number <= 0 || number >= 1000000) return null;
  if (Number.isInteger(number) && number >= 2020 && number <= 2035) return null;
  return number;
}

function numbersIn(text) {
  const matches = String(text || '').match(/\d+(?:[.,]\d+)?/g) || [];
  return matches.map(parseNumber).filter((value) => value != null);
}

function headerIndex(row, keys, blocked) {
  return row.findIndex((cell) => {
    const value = cellText(cell).toLowerCase();
    if ((blocked || []).some((word) => value.includes(word))) return false;
    return keys.some((key) => value.includes(key));
  });
}

function findHeader(rows) {
  const limit = Math.min(rows.length, 20);
  for (let index = 0; index < limit; index += 1) {
    const row = rows[index].map(cellText);
    const qty = headerIndex(row, ['რაოდენობა', 'quantity', 'qty']);
    const code = headerIndex(row, ['კოდი', 'შტრიხკოდი', 'code', 'sku']);
    const name = headerIndex(row, ['დასახელება', 'საქონელი', 'პროდუქტი', 'name'], ['კოდი', 'ფასი', 'რაოდენ']);
    if (qty >= 0 && (code >= 0 || name >= 0)) {
      return { index, qty, code, name };
    }
  }
  return null;
}

function codePattern(code) {
  const parts = normCode(code).split('/').filter(Boolean).map(escapeRegExp);
  if (!parts.length) return null;
  return new RegExp(`(?:^|[^A-Z0-9])(${parts.join('\\s*/\\s*')})(?:$|[^A-Z0-9])`, 'i');
}

function matchByCode(products, source) {
  const compact = normCode(source);
  if (!compact) return null;
  const exact = products.find((product) => normCode(product.code) === compact);
  if (exact) return { product: exact, matchedText: compact };

  const sorted = products
    .map((product) => ({ product, pattern: codePattern(product.code) }))
    .filter((entry) => entry.pattern)
    .sort((a, b) => normCode(b.product.code).length - normCode(a.product.code).length);

  for (const entry of sorted) {
    const match = String(source).match(entry.pattern);
    if (match) return { product: entry.product, matchedText: match[1] };
  }
  return null;
}

function matchByName(products, source) {
  const compact = normName(source);
  if (compact.length < 6) return null;
  let best = null;
  products.forEach((product) => {
    const name = normName(product.name);
    if (name.length < 6) return;
    if (compact.includes(name) || name.includes(compact)) {
      if (!best || name.length > normName(best.name).length) best = product;
    }
  });
  return best ? { product: best, matchedText: '' } : null;
}

function quantityFromNumbers(values, price) {
  const nums = values.filter((value) => value > 0);
  if (!nums.length) return null;
  for (let index = 0; index < nums.length - 2; index += 1) {
    const qty = nums[index];
    const unit = nums[index + 1];
    const amount = nums[index + 2];
    if (Math.abs(qty * unit - amount) <= Math.max(0.08, amount * 0.02)) return qty;
  }
  if (price > 0) {
    for (let index = 0; index < nums.length - 1; index += 1) {
      const left = nums[index];
      const right = nums[index + 1];
      if (Math.abs(left * price - right) <= Math.max(0.08, right * 0.03)) return left;
      if (Math.abs(right * price - left) <= Math.max(0.08, left * 0.03)) return right;
    }
  }
  const integers = nums.filter((value) => Math.abs(value - Math.round(value)) < 0.001);
  if (integers.length && integers.length < nums.length) return integers[0];
  return nums[0];
}

function quantityFromLine(line, matchedText, price) {
  let rest = String(line || '');
  if (matchedText) {
    rest = rest.replace(matchedText, ' ');
  }
  return quantityFromNumbers(numbersIn(rest), price);
}

function addItem(bucket, product, quantity) {
  const qty = Number(quantity);
  if (!product || !Number.isFinite(qty) || qty <= 0) return;
  const existing = bucket.find((item) => item.code === product.code);
  if (existing) {
    existing.quantity += qty;
    return;
  }
  bucket.push({
    code: product.code,
    name: product.name,
    quantity: qty
  });
}

function waybillNumber(text) {
  const source = String(text || '');
  const labeled = source.match(/ზედნადებ(?:ის|ის ნომერი|ი)?[^\d]{0,24}(\d{6,})/i);
  if (labeled) return labeled[1];
  const numbered = source.match(/(?:№|N)\s*[:.]?\s*(\d{8,})/i);
  return numbered ? numbered[1] : '';
}

export function parseWaybillTable(rows, products) {
  const table = (Array.isArray(rows) ? rows : []).map((row) =>
    (Array.isArray(row) ? row : [row]).map(cellText)
  );
  const catalog = Array.isArray(products) ? products : [];
  const items = [];
  const unknown = [];
  const header = findHeader(table);
  const fullText = table.map((row) => row.join(' ')).join('\n');

  if (header) {
    for (let index = header.index + 1; index < table.length; index += 1) {
      const row = table[index];
      const codeRaw = header.code >= 0 ? row[header.code] || '' : '';
      const nameRaw = header.name >= 0 ? row[header.name] || '' : '';
      const qty = parseNumber(row[header.qty]);
      if (!codeRaw && !nameRaw) continue;
      if (!qty) continue;
      const matched = matchByCode(catalog, codeRaw) || matchByName(catalog, nameRaw) || matchByCode(catalog, row.join(' '));
      if (matched) addItem(items, matched.product, qty);
      else unknown.push({ label: nameRaw || codeRaw, quantity: qty });
    }
  }

  if (!items.length) {
    table.forEach((row) => {
      const line = row.join(' ');
      if (!line) return;
      const matched = matchByCode(catalog, line) || matchByName(catalog, line);
      if (!matched) return;
      const qty = quantityFromLine(line, matched.matchedText, Number(matched.product.price || 0));
      if (!qty) return;
      addItem(items, matched.product, qty);
    });
  }

  return {
    items,
    unknown,
    waybillNo: waybillNumber(fullText)
  };
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-waybill-src="${src}"]`);
    if (existing) {
      if (existing.getAttribute('data-ready') === '1') resolve();
      else existing.addEventListener('load', () => resolve(), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.setAttribute('data-waybill-src', src);
    script.onload = () => {
      script.setAttribute('data-ready', '1');
      resolve();
    };
    script.onerror = () => reject(new Error('ვერ ჩაიტვირთა ფაილის წამკითხველი'));
    document.head.appendChild(script);
  });
}

async function rowsFromExcel(file) {
  if (!window.XLSX) {
    throw new Error('Excel ბიბლიოთეკა ვერ ჩაიტვირთა. განაახლეთ გვერდი.');
  }
  const data = new Uint8Array(await file.arrayBuffer());
  const workbook = window.XLSX.read(data, { type: 'array' });
  const rows = [];
  workbook.SheetNames.forEach((name) => {
    const sheetRows = window.XLSX.utils.sheet_to_json(workbook.Sheets[name], {
      header: 1,
      raw: false,
      defval: ''
    });
    sheetRows.forEach((row) => rows.push(row));
  });
  return rows;
}

async function rowsFromPdf(file, onProgress) {
  onProgress?.('PDF იკითხება…');
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
  const pdfjs = window.pdfjsLib;
  if (!pdfjs) throw new Error('PDF ვერ იკითხება ამ ბრაუზერში');
  pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const rows = [];
  for (let pageNo = 1; pageNo <= doc.numPages; pageNo += 1) {
    onProgress?.(`PDF გვერდი ${pageNo}/${doc.numPages}`);
    const page = await doc.getPage(pageNo);
    const content = await page.getTextContent();
    const lines = [];
    content.items.forEach((item) => {
      if (!item.str) return;
      const y = Math.round(item.transform[5]);
      let line = lines.find((entry) => Math.abs(entry.y - y) <= 2);
      if (!line) {
        line = { y, parts: [] };
        lines.push(line);
      }
      line.parts.push({ x: item.transform[4], text: item.str });
    });
    lines
      .sort((a, b) => b.y - a.y)
      .forEach((line) => {
        const text = line.parts
          .sort((a, b) => a.x - b.x)
          .map((part) => part.text)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (text) rows.push([text]);
      });
  }
  return rows;
}

async function prepareImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('ფოტო ვერ გაიხსნა. სცადეთ JPG ან PNG.'));
      element.src = url;
    });
    const maxWidth = 1800;
    const scale = Math.min(1, maxWidth / image.width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function rowsFromImage(file, onProgress) {
  onProgress?.('ფოტო იკითხება… პირველ ჯერზე ცოტა ხანს გასტანს.');
  await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js');
  if (!window.Tesseract) throw new Error('ფოტოს ამოცნობა ამ ბრაუზერში ვერ ჩაირთო');
  const canvas = await prepareImage(file);
  const result = await window.Tesseract.recognize(canvas, 'kat+eng', {
    logger(message) {
      if (message.status === 'recognizing text' && typeof message.progress === 'number') {
        onProgress?.(`ფოტო იკითხება… ${Math.round(message.progress * 100)}%`);
      }
    }
  });
  return String(result?.data?.text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => [line]);
}

export async function readWaybillFile(file, products, onProgress) {
  const name = String(file?.name || '').toLowerCase();
  const type = String(file?.type || '');
  let rows;
  if (type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|heic|heif)$/.test(name)) {
    rows = await rowsFromImage(file, onProgress);
  } else if (type === 'application/pdf' || name.endsWith('.pdf')) {
    rows = await rowsFromPdf(file, onProgress);
  } else {
    onProgress?.('Excel იკითხება…');
    rows = await rowsFromExcel(file);
  }
  return parseWaybillTable(rows, products);
}
