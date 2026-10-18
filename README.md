# Placecard Maker

A static, client-side web app for making printable fold-and-cut tent placecards.

- Upload a logo (PNG, JPG, SVG or WebP).
- Paste Name / Company rows straight from Excel or Google Sheets into the grid.
- Download a PDF with four cards per US Letter or A4 sheet.

Each card is folded across its middle into a tent. The top half is printed upside
down so that both faces read upright once folded, and the content on each face is
optically centered (logo plus text block centered on the cap height, not the line
box). Long names and companies wrap into balanced lines and shrink to fit.
Dashed lines mark the cuts; small ticks (or an optional faint line) mark the fold.

Nothing is uploaded anywhere. Names, settings and the logo are kept in your
browser's local storage only.

## Run locally

Open `index.html` through any static server, for example:

    npx serve .

## Deploy to GitHub Pages

Push this folder to a GitHub repository, then in **Settings → Pages** choose
"Deploy from a branch" with the `main` branch and `/ (root)` folder.

## Files

- `index.html`, `styles.css` — the page
- `app.js` — grid, logo upload, settings, preview and download
- `layout.js` — card layout and PDF drawing (uses [pdf-lib](https://pdf-lib.js.org))

Fonts (Poppins, Lato, Crimson Text, DM Serif Display) are loaded at runtime from
the Google Fonts repository via jsDelivr; you can also upload your own .ttf/.otf.
