const SHEET_ID = '19EC29L7CgHCk4XD7AZuqbmiz0KSFv-Nl';
const SHEET_GID = '1981413768';
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store'
  };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  const source = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }

  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((entry) => entry.some((value) => String(value || '').trim()));
}

function parsePrice(value) {
  const raw = String(value || '')
    .trim()
    .replace(/\u00a0/g, '')
    .replace(/\s+/g, '')
    .replace(',', '.');

  const number = Number(raw);
  return Number.isFinite(number) ? Number(number.toFixed(2)) : 0;
}

function findColumnIndex(header, aliases) {
  const normalized = header.map((cell) => String(cell || '').trim().toLowerCase());
  for (const alias of aliases) {
    const index = normalized.indexOf(alias.toLowerCase());
    if (index >= 0) return index;
  }
  return -1;
}

function looksLikeProductCode(value) {
  const text = String(value || '').trim();
  return /^[\dA-Za-z][\dA-Za-z./_-]{0,30}$/.test(text);
}

function resolveCodeIndex(header, rows) {
  const named = findColumnIndex(header, ['ბარკოდი', 'კოდი', 'code', 'barcode']);
  if (named >= 0) return named;

  const sample = rows
    .slice(1, 15)
    .map((row) => String(row[0] || '').trim())
    .filter(Boolean);
  const codeLike = sample.filter(looksLikeProductCode);
  if (sample.length && codeLike.length >= Math.ceil(sample.length * 0.6)) return 0;
  return -1;
}

export function parseDistributionProducts(csvText) {
  const rows = parseCsv(csvText);
  if (!rows.length) return [];

  const header = rows[0].map((cell) => String(cell || '').trim());
  const codeIndex = resolveCodeIndex(header, rows);
  const nameIndex = findColumnIndex(header, ['დასახელება', 'პროდუქტი', 'name']);
  const priceIndex = findColumnIndex(header, ['დისტრიბუციის ფასი']);

  if (codeIndex < 0 || nameIndex < 0 || priceIndex < 0) {
    throw new Error('Sheet is missing barcode, name, or distribution price columns.');
  }

  const products = [];
  const seen = new Set();

  rows.slice(1).forEach((row) => {
    const code = String(row[codeIndex] || '').trim();
    const name = String(row[nameIndex] || '').trim();
    if (!code || !name || seen.has(code)) return;

    seen.add(code);
    products.push({
      code,
      name,
      price: parsePrice(row[priceIndex])
    });
  });

  return products;
}

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (req.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders() });
  }

  try {
    const response = await fetch(`${SHEET_CSV_URL}&t=${Date.now()}`, {
      cache: 'no-store',
      headers: { Accept: 'text/csv,text/plain,*/*' }
    });

    if (!response.ok) {
      throw new Error(`Google Sheet request failed: ${response.status}`);
    }

    const csvText = await response.text();
    const products = parseDistributionProducts(csvText);

    if (!products.length) {
      throw new Error('Google Sheet returned no products.');
    }

    return Response.json(
      { ok: true, source: 'google-sheet', count: products.length, products },
      { headers: corsHeaders() }
    );
  } catch (error) {
    return Response.json(
      { ok: false, error: String(error?.message || error) },
      { status: 502, headers: corsHeaders() }
    );
  }
};
