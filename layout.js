/*
 * Placecard layout + PDF rendering.
 *
 * Each sheet holds a 2x2 grid of cards. Every card is folded across its
 * horizontal midline into a tent, so it has two faces of identical size:
 *   - the bottom half (front face) is drawn upright
 *   - the top half (back face) is drawn rotated 180 degrees
 * After folding, both faces read upright from their own side of the table.
 *
 * Content on each face is laid out in "face space" (origin at the face's
 * top-left, y pointing down, units in PDF points) and then mapped onto the
 * page, so the two faces are exact mirror images around the fold.
 */
(function (root) {
  'use strict';

  const PDFLib = root.PDFLib || (typeof require === 'function' ? require('pdf-lib') : null);
  const { PDFDocument, StandardFonts, rgb, degrees } = PDFLib;

  const PT_PER_IN = 72;
  const PAPERS = {
    letter: { w: 8.5 * PT_PER_IN, h: 11 * PT_PER_IN },
    a4: { w: 595.28, h: 841.89 },
  };

  const SIDE_MARGIN = 0.3 * PT_PER_IN;   // horizontal safe area on each face
  const VERT_MARGIN = 0.22 * PT_PER_IN;  // vertical safe area on each face
  const LEADING = 1.22;                  // line height as a multiple of font size
  const GROUP_GAP = 0.18;                // extra space between name and company, x name size
  const MIN_SIZE = 8;

  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    const n = m ? parseInt(m[1], 16) : 0x262637;
    return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  }

  // Height of capital letters above the baseline, used for optical centering.
  function capHeight(font, size) {
    const f = font.embedder && font.embedder.font;
    if (f) {
      if (f.capHeight && f.unitsPerEm) return (f.capHeight / f.unitsPerEm) * size;
      if (f.CapHeight) return (f.CapHeight / 1000) * size;
    }
    return 0.7 * size;
  }

  function greedyWrap(words, font, size, maxW) {
    const lines = [];
    let cur = '';
    for (const w of words) {
      const test = cur ? cur + ' ' + w : w;
      if (!cur || font.widthOfTextAtSize(test, size) <= maxW) cur = test;
      else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  // Wrap into as few lines as fit, then rebalance so the lines are as even
  // as possible ("Mirae Asset / Securities" rather than a long line + orphan).
  function balancedWrap(text, font, size, maxW) {
    const words = String(text).trim().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const target = greedyWrap(words, font, size, maxW).length;
    if (target <= 1) return [words.join(' ')];
    let lo = 0, hi = maxW;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (greedyWrap(words, font, size, mid).length <= target) hi = mid; else lo = mid;
    }
    return greedyWrap(words, font, size, hi);
  }

  function fits(lines, font, size, maxW, maxLines) {
    return lines.length <= maxLines && lines.every((l) => font.widthOfTextAtSize(l, size) <= maxW + 0.01);
  }

  // Shrink a text item until it fits within maxW in at most maxLines lines.
  function fitText(text, font, size, maxW, maxLines) {
    let s = size;
    let lines = balancedWrap(text, font, s, maxW);
    while (!fits(lines, font, s, maxW, maxLines) && s > MIN_SIZE) {
      s = Math.max(MIN_SIZE, s - 0.25);
      lines = balancedWrap(text, font, s, maxW);
    }
    return { lines, size: s };
  }

  function textBlockHeight(groups) {
    // From the cap-top of the first line to the baseline of the last line.
    let h = 0;
    let first = true;
    for (const g of groups) {
      g.lines.forEach((line, i) => {
        if (first) { h = capHeight(g.font, g.size); first = false; }
        else h += g.size * LEADING + (i === 0 ? g.gapBefore : 0);
      });
    }
    return h;
  }

  // Lay out one face. Returns drawing ops in face space.
  function layoutFace(card, ctx) {
    const { faceW, faceH, fonts, s, logo } = ctx;
    const maxTextW = faceW - 2 * SIDE_MARGIN;
    const ops = [];

    const groups = [];
    if (card.name && card.name.trim()) {
      const f = fonts[s.nameBold ? 'bold' : 'regular'];
      const r = fitText(card.name, f, s.nameSize, maxTextW, 2);
      groups.push({ ...r, font: f, color: hexToRgb(s.nameColor), gapBefore: 0 });
    }
    if (card.company && card.company.trim()) {
      const f = fonts[s.companyBold ? 'bold' : 'regular'];
      const r = fitText(card.company, f, s.companySize, maxTextW, 3);
      const gapBefore = groups.length ? GROUP_GAP * groups[0].size : 0;
      groups.push({ ...r, font: f, color: hexToRgb(s.companyColor), gapBefore });
    }

    let logoW = 0, logoH = 0;
    if (logo) {
      logoH = s.logoSize;
      logoW = logoH * (logo.width / logo.height);
      if (logoW > maxTextW) { logoW = maxTextW; logoH = logoW * (logo.height / logo.width); }
    }

    let textH = textBlockHeight(groups);
    const hasText = groups.length > 0;
    const gap = logo && hasText ? s.gap : 0;

    // If everything together is taller than the face, shrink the text to fit.
    const avail = faceH - 2 * VERT_MARGIN;
    if (hasText && logoH + gap + textH > avail) {
      const scale = Math.max(0.4, (avail - logoH - gap) / textH);
      for (const g of groups) {
        const r = fitText(g.lines.join(' '), g.font, Math.max(MIN_SIZE, g.size * scale), maxTextW, g.lines.length);
        g.lines = r.lines; g.size = r.size;
      }
      if (groups[1]) groups[1].gapBefore = GROUP_GAP * groups[0].size;
      textH = textBlockHeight(groups);
    }

    const blockH = logoH + gap + textH;
    let y = (faceH - blockH) / 2 + (s.nudge || 0);

    const drawLogo = () => {
      ops.push({ type: 'image', x: (faceW - logoW) / 2, y, w: logoW, h: logoH });
      y += logoH + gap;
    };
    const drawText = () => {
      let first = true;
      for (const g of groups) {
        g.lines.forEach((line, i) => {
          if (first) { y += capHeight(g.font, g.size); first = false; }
          else y += g.size * LEADING + (i === 0 ? g.gapBefore : 0);
          const w = g.font.widthOfTextAtSize(line, g.size);
          ops.push({ type: 'text', text: line, x: (faceW - w) / 2, y, size: g.size, font: g.font, color: g.color });
        });
      }
      y += gap;
    };

    if (logo && s.logoPos === 'below') { drawText(); drawLogo(); }
    else { if (logo) drawLogo(); drawText(); }
    return ops;
  }

  // Map face-space ops onto the page. faceRect is in PDF space (y up).
  function drawFace(page, ops, faceRect, rotated, logoImage) {
    const { x: fx, y: fy, w: fw, h: fh } = faceRect;
    // Upright: face top-left is (fx, fy+fh). Rotated 180: face top-left is (fx+fw, fy).
    const map = rotated
      ? (px, py) => ({ x: fx + fw - px, y: fy + py })
      : (px, py) => ({ x: fx + px, y: fy + fh - py });
    const rot = degrees(rotated ? 180 : 0);
    for (const op of ops) {
      if (op.type === 'text') {
        const p = map(op.x, op.y);
        page.drawText(op.text, { x: p.x, y: p.y, size: op.size, font: op.font, color: op.color, rotate: rot });
      } else if (op.type === 'image' && logoImage) {
        const p = map(op.x, op.y + op.h); // image origin is its bottom-left corner
        page.drawImage(logoImage, { x: p.x, y: p.y, width: op.w, height: op.h, rotate: rot });
      }
    }
  }

  function drawGuides(page, paper, s) {
    const { w: W, h: H } = paper;
    const cut = { thickness: 0.6, color: rgb(0.62, 0.62, 0.66), dashArray: [4, 3] };
    // Cut lines run the full sheet so they line up with a paper trimmer.
    page.drawLine({ start: { x: W / 2, y: 0 }, end: { x: W / 2, y: H }, ...cut });
    page.drawLine({ start: { x: 0, y: H / 2 }, end: { x: W, y: H / 2 }, ...cut });

    if (s.foldStyle === 'none') return;
    const fold = { thickness: 0.5, color: rgb(0.78, 0.78, 0.8) };
    const cardW = W / 2, cardH = H / 2;
    for (let r = 0; r < 2; r++) {
      const yFold = H - (r * cardH + cardH / 2);
      for (let c = 0; c < 2; c++) {
        const x0 = c * cardW, x1 = x0 + cardW;
        if (s.foldStyle === 'full') {
          page.drawLine({ start: { x: x0, y: yFold }, end: { x: x1, y: yFold }, ...fold, dashArray: [1, 2] });
        } else {
          const t = 0.22 * PT_PER_IN;
          page.drawLine({ start: { x: x0, y: yFold }, end: { x: x0 + t, y: yFold }, ...fold });
          page.drawLine({ start: { x: x1 - t, y: yFold }, end: { x: x1, y: yFold }, ...fold });
        }
      }
    }
  }

  /**
   * Build the PDF.
   * opts.cards     [{name, company}]
   * opts.settings  style settings (see app.js DEFAULTS)
   * opts.fonts     { regular: Uint8Array|null, bold: Uint8Array|null, standard: 'helvetica'|'times' }
   * opts.logo      { bytes: Uint8Array, type: 'png'|'jpg', width, height } | null
   */
  async function buildPdf(opts) {
    const s = opts.settings;
    const paper = PAPERS[s.paper] || PAPERS.letter;
    const doc = await PDFDocument.create();
    doc.setTitle('Placecards');
    doc.setCreator('Placecard Maker');

    const fonts = {};
    if (opts.fonts.regular) {
      if (root.fontkit) doc.registerFontkit(root.fontkit);
      else doc.registerFontkit(require('@pdf-lib/fontkit'));
      fonts.regular = await doc.embedFont(opts.fonts.regular, { subset: false });
      fonts.bold = opts.fonts.bold ? await doc.embedFont(opts.fonts.bold, { subset: false }) : fonts.regular;
    } else {
      const times = opts.fonts.standard === 'times';
      fonts.regular = await doc.embedFont(times ? StandardFonts.TimesRoman : StandardFonts.Helvetica);
      fonts.bold = await doc.embedFont(times ? StandardFonts.TimesRomanBold : StandardFonts.HelveticaBold);
    }

    let logoImage = null;
    if (opts.logo) {
      logoImage = opts.logo.type === 'jpg' ? await doc.embedJpg(opts.logo.bytes) : await doc.embedPng(opts.logo.bytes);
    }

    let cards = opts.cards.slice();
    if (!cards.length) cards = [{ name: '', company: '' }];
    if (s.fillBlanks) while (cards.length % 4) cards.push({ name: '', company: '' });

    const cardW = paper.w / 2, cardH = paper.h / 2;
    const faceW = cardW, faceH = cardH / 2;
    const ctx = { faceW, faceH, fonts, s, logo: logoImage ? { width: logoImage.width, height: logoImage.height } : null };

    for (let i = 0; i < cards.length; i += 4) {
      const page = doc.addPage([paper.w, paper.h]);
      cards.slice(i, i + 4).forEach((card, k) => {
        const col = k % 2, row = Math.floor(k / 2);
        const cardX = col * cardW;
        const cardTop = paper.h - row * cardH;
        const ops = layoutFace(card, ctx);
        // Back face: upper half of the card, rotated. Front face: lower half, upright.
        drawFace(page, ops, { x: cardX, y: cardTop - faceH, w: faceW, h: faceH }, true, logoImage);
        drawFace(page, ops, { x: cardX, y: cardTop - cardH, w: faceW, h: faceH }, false, logoImage);
      });
      drawGuides(page, paper, s);
    }
    return doc.save();
  }

  const api = { buildPdf, PAPERS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PlaceCards = api;
})(typeof window !== 'undefined' ? window : globalThis);
