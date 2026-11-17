import { parseDistributionProducts } from '../netlify/functions/products.mjs';

const SHEET_ID = '19EC29L7CgHCk4XD7AZuqbmiz0KSFv-Nl';
const SHEET_GID = '1981413768';
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    return;
  }

  try {
    const response = await fetch(`${SHEET_CSV_URL}&t=${Date.now()}`, {
      cache: 'no-store',
      headers: { Accept: 'text/csv,text/plain,*/*' }
    });

    if (!response.ok) {
      throw new Error(`Google Sheet request failed: ${response.status}`);
    }

    const products = parseDistributionProducts(await response.text());
    if (!products.length) {
      throw new Error('Google Sheet returned no products.');
    }

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      ok: true,
      source: 'google-sheet',
      count: products.length,
      products
    });
  } catch (error) {
    res.status(502).json({ ok: false, error: String(error?.message || error) });
  }
}
