// PDF fonts for pdfmake — DejaVu Sans covers Georgian text, digits, and symbols.
export const PDF_FONT = 'DejaVuSans';

const FONT_FILES = {
  normal: 'DejaVuSans.ttf',
  bold: 'DejaVuSans-Bold.ttf'
};

const FONT_URLS = {
  normal: 'https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans.ttf',
  bold: 'https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans-Bold.ttf'
};

let fontsReady = null;

function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

async function fetchFontBuffer(url) {
  const response = await fetch(url, { cache: 'force-cache' });
  if (!response.ok) {
    throw new Error(`Font request failed (${response.status}): ${url}`);
  }

  return response.arrayBuffer();
}

async function loadPdfFonts() {
  if (!window.pdfMake) {
    throw new Error('pdfMake is not available');
  }

  window.pdfMake.vfs = window.pdfMake.vfs || {};

  if (
    window.pdfMake.vfs[FONT_FILES.normal] &&
    window.pdfMake.vfs[FONT_FILES.bold] &&
    window.pdfMake.fonts?.[PDF_FONT]
  ) {
    return true;
  }

  const [regularBuffer, boldBuffer] = await Promise.all([
    fetchFontBuffer(FONT_URLS.normal),
    fetchFontBuffer(FONT_URLS.bold)
  ]);

  window.pdfMake.vfs[FONT_FILES.normal] = bufferToBase64(regularBuffer);
  window.pdfMake.vfs[FONT_FILES.bold] = bufferToBase64(boldBuffer);

  window.pdfMake.fonts = {
    ...(window.pdfMake.fonts || {}),
    [PDF_FONT]: {
      normal: FONT_FILES.normal,
      bold: FONT_FILES.bold,
      italics: FONT_FILES.normal,
      bolditalics: FONT_FILES.bold
    }
  };

  return true;
}

export function preloadPdfFonts() {
  if (!fontsReady) {
    fontsReady = loadPdfFonts().catch((error) => {
      fontsReady = null;
      throw error;
    });
  }

  return fontsReady;
}

export async function ensurePdfFonts() {
  if (!window.pdfMake?.createPdf) {
    window.alert('PDF გენერატორი ვერ მოიძებნა. გთხოვთ, გადაამოწმოთ ინტერნეტი და გვერდი განაახლოთ.');
    return false;
  }

  try {
    await preloadPdfFonts();
    return true;
  } catch (error) {
    console.error('PDF font load failed:', error);
    window.alert('PDF შრიფტის ჩატვირთვა ვერ მოხერხდა. გთხოვთ, გადაამოწმოთ ინტერნეტი და სცადეთ ხელახლა.');
    return false;
  }
}
