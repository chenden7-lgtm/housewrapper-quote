const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');

const TEMPLATE_PATH = path.join(__dirname, 'assets', 'warranty_template.pdf');
const FONT_PATH = path.join(__dirname, 'assets', 'NotoSansTC-Regular.ttf');

let cachedTemplateBytes = null;
let cachedFontBytes = null;

function loadAssets() {
  if (!cachedTemplateBytes) {
    cachedTemplateBytes = fs.readFileSync(TEMPLATE_PATH);
  }
  if (!cachedFontBytes) {
    cachedFontBytes = fs.readFileSync(FONT_PATH);
  }
}

/**
 * Generate a pristine vector warranty card PDF with custom text overlaid.
 *
 * Coordinates (derived directly from Adobe Illustrator artboard and sub-pixel diff analysis):
 * Page size: 595.276 pt x 841.89 pt (Standard A4)
 * Left column start: X = 137.0 pt, max width = 163 pt
 * Right column start: X = 376.0 pt, max width = 146 pt
 *
 * Baselines (Y coordinates from bottom):
 * Row 1: 614.5 pt (車主姓名 / 車主車牌)
 * Row 2: 589.5 pt (車主電話 / 原始車色)
 * Row 3: 563.2 pt (車型車種 / 施工品牌)
 * Row 4: 536.0 pt (完工日期 / 施工型號)
 */
async function generateWarrantyPDF(data) {
  loadAssets();

  const pdfDoc = await PDFDocument.load(cachedTemplateBytes);
  pdfDoc.registerFontkit(fontkit);
  const customFont = await pdfDoc.embedFont(cachedFontBytes, { subset: true });

  const pages = pdfDoc.getPages();
  const page = pages[0];

  const baseFontSize = 11;
  const textColor = rgb(0.12, 0.12, 0.12);

  // Helper to draw text with automatic font scaling if text exceeds max width
  function drawFittedText(text, x, y, maxWidth) {
    if (!text) return;
    const str = String(text).trim();
    if (!str) return;

    let fontSize = baseFontSize;
    let textWidth = customFont.widthOfTextAtSize(str, fontSize);

    if (textWidth > maxWidth) {
      fontSize = Math.max(7, Math.floor((fontSize * (maxWidth / textWidth)) * 10) / 10);
    }

    page.drawText(str, {
      x,
      y,
      size: fontSize,
      font: customFont,
      color: textColor
    });
  }

  // Format date nicely if provided (e.g. 2026-10-28 -> 2026/10/28)
  const formattedDate = (data.completion_date || '').replace(/-/g, '/');

  // Format plate uppercase
  const formattedPlate = (data.license_plate || '').toUpperCase().trim();

  // Draw 8 fields
  // Left Column
  drawFittedText(data.customer_name || '', 137.0, 614.5, 163.0);
  drawFittedText(data.customer_phone || '', 137.0, 589.5, 163.0);
  drawFittedText(data.car_model || '', 137.0, 563.2, 163.0);
  drawFittedText(formattedDate, 137.0, 536.0, 163.0);

  // Right Column
  drawFittedText(formattedPlate, 376.0, 614.5, 146.0);
  drawFittedText(data.original_color || '', 376.0, 589.5, 146.0);
  drawFittedText(data.service_brand || '', 376.0, 563.2, 146.0);
  drawFittedText(data.service_model || '', 376.0, 536.0, 146.0);

  // Set PDF Metadata
  pdfDoc.setTitle(`好室多膜 保固卡 - ${data.customer_name || ''} - ${formattedPlate}`);
  pdfDoc.setAuthor('好室多膜 HOUSE WRAPPER');
  pdfDoc.setSubject('車體包膜品質與售後服務保障說明');
  pdfDoc.setProducer('好室多膜 保固卡自動產生系統');

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

module.exports = {
  generateWarrantyPDF
};
