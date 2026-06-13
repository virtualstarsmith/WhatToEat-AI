# Directory Structure

> How frontend code is organized in this project.

---

## Overview

This project currently uses the native WeChat Mini Program structure. Keep the app importable directly in WeChat Developer Tools without a build step unless a later task explicitly introduces one.

---

## Directory Layout

```text
.
├── app.js
├── app.json
├── app.wxss
├── project.config.json
├── sitemap.json
├── pages/
│   └── <page-name>/
│       ├── <page-name>.js
│       ├── <page-name>.json
│       ├── <page-name>.wxml
│       └── <page-name>.wxss
└── utils/
    └── <shared-helper>.js
```

---

## Module Organization

Each Mini Program page owns its `.js`, `.json`, `.wxml`, and `.wxss` files in the same `pages/<page-name>/` directory. Shared logic that is independent of a page belongs in `utils/`.

---

## Naming Conventions

Page directories and files use the same lowercase name, for example `pages/index/index.js`. Utility files use concise lower camel case or lowercase names such as `util.js`.

---

## Examples

`pages/index/` is the reference page module for the current app shell. `utils/util.js` is the reference location for small, reusable helpers such as formatting and random selection.
