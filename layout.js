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

  // Lay out one face. Returns drawing ops in face space.
  function layoutFace(card, ctx) {
    const { faceW, faceH, fonts, s, logos } = ctx;
    const logo = logos.length > 0;
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

    // Logos sit side by side at a shared height (each adjustable by its own
    // scale), shrinking together if the row is wider than the safe area.
    let logoW = 0, logoH = 0, logoItems = [];
    if (logo) {
      const spacing = logos.length > 1 ? (s.logoSpacing ?? 14) : 0;
      logoItems = logos.map((l) => {
        const h = s.logoSize * (l.scale || 1);
        return { index: l.index, w: h * (l.width / l.height), h };
      });
      const rawW = logoItems.reduce((a, l) => a + l.w, 0) + spacing * (logoItems.length - 1);
      const k = rawW > maxTextW ? maxTextW / rawW : 1;
      logoItems.forEach((l) => { l.w *= k; l.h *= k; });
      logoItems.spacing = spacing * k;
      logoW = rawW * k;
      logoH = Math.max(...logoItems.map((l) => l.h));
    }

    // Every card shares the same fixed lines, measured from the fold, so
    // logos, names and companies sit at identical heights on all cards and on
    // both faces. The lines come from a typical card (one-line name plus
    // one-line company) centred on the face; longer text grows downward
    // toward the table edge and shrinks if it would run past the margin.
    const nameRefF = fonts[s.nameBold ? 'bold' : 'regular'];
    const nameCap = capHeight(nameRefF, s.nameSize);
    const refTextH = nameCap + GROUP_GAP * s.nameSize + s.companySize * LEADING;
    const below = logo && s.logoPos === 'below';
    const logoBlock = logo ? logoH + s.gap : 0;
    const refTop = (faceH - (logoBlock + refTextH)) / 2 + (s.nudge || 0);
    const logoY = below ? refTop + refTextH + s.gap : refTop;
    const nameBase = (below ? refTop : refTop + logoBlock) + nameCap;
    const companyBase = nameBase + GROUP_GAP * s.nameSize + s.companySize * LEADING;
    const nameGroup = card.name && card.name.trim() ? groups[0] : null;
    const companyGroup = groups.find((g) => g !== nameGroup) || null;

    // Baselines for each line, given the current sizes.
    const placeLines = () => {
      const lines = [];
      let base = nameBase;
      if (nameGroup) {
        nameGroup.lines.forEach((t, i) => {
          if (i) base += nameGroup.size * LEADING;
          lines.push({ g: nameGroup, t, base });
        });
      }
      if (companyGroup) {
        base = nameGroup
          ? Math.max(companyBase, base + GROUP_GAP * nameGroup.size + companyGroup.size * LEADING)
          : companyBase;
        companyGroup.lines.forEach((t, i) => {
          if (i) base += companyGroup.size * LEADING;
          lines.push({ g: companyGroup, t, base });
        });
      }
      return lines;
    };

    // Text may run down to the bottom margin. When the logo sits below the
    // text, it keeps its line unless longer text pushes it down, and the text
    // leaves room for it above the margin.
    let lines = placeLines();
    const overflow = () => {
      const last = lines[lines.length - 1];
      if (!last) return 0;
      return below
        ? last.base - (faceH - VERT_MARGIN - logoH - s.gap)
        : last.base + 0.22 * last.g.size - (faceH - VERT_MARGIN);
    };
    for (let i = 0; i < 40 && overflow() > 0.01; i++) {
      // Shrink the company first so the name keeps its size where possible.
      const g = companyGroup && companyGroup.size > MIN_SIZE ? companyGroup : nameGroup;
      if (!g || g.size <= MIN_SIZE) break;
      const r = fitText(g.lines.join(' '), g.font, Math.max(MIN_SIZE, g.size * 0.97), maxTextW, g.lines.length);
      g.lines = r.lines; g.size = r.size;
      lines = placeLines();
    }

    if (logo) {
      const last = lines[lines.length - 1];
      const rowY = below && last ? Math.max(logoY, last.base + s.gap) : logoY;
      let x = (faceW - logoW) / 2;
      for (const l of logoItems) {
        // Each logo is centred on the row's middle line.
        ops.push({ type: 'image', index: l.index, x, y: rowY + (logoH - l.h) / 2, w: l.w, h: l.h });
        x += l.w + logoItems.spacing;
      }
    }
    for (const { g, t, base } of lines) {
      const w = g.font.widthOfTextAtSize(t, g.size);
      ops.push({ type: 'text', text: t, x: (faceW - w) / 2, y: base, size: g.size, font: g.font, color: g.color });
    }
    return ops;
  }

  // Map face-space ops onto the page. faceRect is in PDF space (y up).
  function drawFace(page, ops, faceRect, rotated, images) {
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
      } else if (op.type === 'image' && images[op.index]) {
        const p = map(op.x, op.y + op.h); // image origin is its bottom-left corner
        page.drawImage(images[op.index], { x: p.x, y: p.y, width: op.w, height: op.h, rotate: rot });
      }
    }
  }

  function drawGuides(page, paper, s) {
    const { w: W, h: H } = paper;
    // Small marks only: a short tick where each cut or fold meets the sheet edge.
    const mark = { thickness: 0.35, color: rgb(0.8, 0.8, 0.82) };
    const inset = 0.18 * PT_PER_IN; // edge dashes start inside the printer's unprintable margin
    const dash = 0.3 * PT_PER_IN;   // ...and end here, leaving a short visible tick
    const line = (x1, y1, x2, y2) => page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, ...mark });

    // Cuts: the vertical and horizontal centre lines of the sheet.
    line(W / 2, H - inset, W / 2, H - dash);
    line(W / 2, inset, W / 2, dash);
    line(inset, H / 2, dash, H / 2);
    line(W - inset, H / 2, W - dash, H / 2);

    if (s.foldStyle === 'none') return;
    // Folds: across the middle of each row of cards.
    for (const yFold of [H * 0.75, H * 0.25]) {
      line(inset, yFold, dash, yFold);
      line(W - inset, yFold, W - dash, yFold);
    }
  }

  /**
   * Build the PDF.
   * opts.cards     [{name, company}]
   * opts.settings  style settings (see app.js DEFAULTS)
   * opts.fonts     { regular: Uint8Array|null, bold: Uint8Array|null, standard: 'helvetica'|'times' }
   * opts.logos     [{ bytes: Uint8Array, type: 'png'|'jpg', scale }] (up to 3, drawn left to right)
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

    const images = [];
    for (const l of opts.logos || []) {
      images.push(l.type === 'jpg' ? await doc.embedJpg(l.bytes) : await doc.embedPng(l.bytes));
    }
    const logos = images.map((img, i) => ({ index: i, width: img.width, height: img.height, scale: opts.logos[i].scale || 1 }));

    let cards = opts.cards.slice();
    if (!cards.length) cards = [{ name: '', company: '' }];
    if (s.fillBlanks) while (cards.length % 4) cards.push({ name: '', company: '' });

    const cardW = paper.w / 2, cardH = paper.h / 2;
    const faceW = cardW, faceH = cardH / 2;
    const ctx = { faceW, faceH, fonts, s, logos };

    for (let i = 0; i < cards.length; i += 4) {
      const page = doc.addPage([paper.w, paper.h]);
      cards.slice(i, i + 4).forEach((card, k) => {
        const col = k % 2, row = Math.floor(k / 2);
        const cardX = col * cardW;
        const cardTop = paper.h - row * cardH;
        const ops = layoutFace(card, ctx);
        // Back face: upper half of the card, rotated. Front face: lower half, upright.
        drawFace(page, ops, { x: cardX, y: cardTop - faceH, w: faceW, h: faceH }, true, images);
        drawFace(page, ops, { x: cardX, y: cardTop - cardH, w: faceW, h: faceH }, false, images);
      });
      drawGuides(page, paper, s);
    }
    return doc.save();
  }

  const api = { buildPdf, PAPERS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PlaceCards = api;
})(typeof window !== 'undefined' ? window : globalThis);
