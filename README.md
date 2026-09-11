# 🎨 Interactive Image Editor

**Live demo: https://denimpatel.github.io/Image-editor/**

[![Deploy to GitHub Pages](https://github.com/DenimPatel/Image-editor/actions/workflows/deploy.yml/badge.svg)](https://github.com/DenimPatel/Image-editor/actions/workflows/deploy.yml)

A fast, free, entirely client-side image editor. Drop in a photo, adjust it, crop it, and
export — all in the browser, no server or upload involved.

![Interactive Image Editor screenshot](image.png)

## 📸 Features

- **Upload**: drag-and-drop, click-to-browse, or paste an image straight from the clipboard
  (JPEG, PNG, JPG).
- **EXIF-correct orientation**: phone photos load upright automatically.
- **Flip & rotate**: horizontal/vertical flip, 90° CW/CCW, and a free custom-angle slider.
- **Adjustments**: brightness, contrast, and saturation, each reset with a double-click.
- **Crop**: draggable crop box with 1:1 / 4:3 / 3:2 / 16:9 presets, a free mode, or a
  validated custom `W:H` ratio field.
- **Rule-of-thirds grid**: an overlay toggle that helps compose the shot — it's never baked
  into the exported file.
- **Export**: JPEG, PNG, WebP, or PDF, with a width selector, a quality slider, and a matte
  color for flattening transparency or filling rotated corners. PNG/WebP keep source alpha.
- **Live output size estimate**, computed from the real encoded file.
- **Undo / redo / reset**, with `⌘/Ctrl+Z`, `⇧⌘/Ctrl+Z`, and keyboard shortcuts for rotate
  (`[` `]`), flip (`f`), grid (`g`), and download (`⌘/Ctrl+S`).

## 🌟 Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) 20+

### Installation

```bash
git clone https://github.com/DenimPatel/Image-editor.git
cd Image-editor
npm install
```

### Run locally

```bash
npm run dev
```

### Build for production

```bash
npm run build
npm run preview   # serve the built dist/ output locally
```

### Other scripts

```bash
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit
npm test            # Vitest
npm run format      # Prettier
```

## 🚀 Usage

1. **Upload an image** — drag it in, click to browse, or paste from the clipboard.
2. **Edit** — flip, rotate, adjust brightness/contrast/saturation, and crop to the aspect
   ratio you need.
3. **Export** — pick a format and width, then download.

## 🏗️ How it's built

This app is a static React + TypeScript site built with Vite, deployed to GitHub Pages via
GitHub Actions. Every editing operation runs on an HTML `<canvas>` in the browser — nothing is
ever uploaded anywhere. See [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) for
the deployment pipeline.

> An earlier version of this project was a Python/Streamlit app that ran the same editing
> operations server-side. It has been retired in favor of this client-side rewrite, which
> deploys for free on GitHub Pages; the old implementation still lives in git history.

## 🤝 Contributing

Issues and pull requests are welcome!
