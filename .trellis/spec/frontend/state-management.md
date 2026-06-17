# State Management

> How state is managed in this project.

---

## Overview

The current project uses native Mini Program page state with `Page({ data, setData })`. Do not introduce a global state library for simple page interactions.

---

## State Categories

Page-only UI state belongs in `Page.data`. App-wide constants or shared startup data may live in `App.globalData`. Durable local values, such as launch logs or user preferences, should use `wx.getStorageSync` / `wx.setStorageSync` until server persistence is introduced.

---

## When to Use Global State

Promote state to `App.globalData` only when multiple pages need the same value during one app session. Keep derived display values page-local.

---

## Shared globalData Consumed by Multiple Pages — Invalidation

When multiple pages consume the same `App.globalData` value (e.g. `pois`, shared between `pages/index` and `pages/mystery`), an update that happens while a page is **inactive** leaves that page's page-local **derived state stale** (recommendation cards, opened mystery boxes). The inactive page's `onShow` must detect the change and discard its derived state.

**Pattern — version-stamp the shared data; consumers self-invalidate on `onShow`:**

- The producer stamps the data with a value that changes on every refresh. For POIs this is `globalData.poisLoadedAt` (`Date.now()` on each successful fetch) — see `utils/locationHelper.js` `fetchPois`.
- Each page records the version it last consumed on a page-instance field (`page._poisConsumedAt`) via `locHelper.markPoisConsumed(page)`, called whenever the page builds derived state from the data (`callRecommend`, `_resetMysteryBox`, `requestLocation`).
- In `onShow`, after `syncFromGlobal`, the page calls `locHelper.poisUpdatedSince(page)`; if the global version differs from its consumed version it discards derived state (`index` clears `cardsView` then re-recommends; `mystery` calls `_resetMysteryBox`).

Apply this to **any** future globalData field that more than one page derives display state from. Forgetting it reproduces the "switched location but the other tab still shows old results" bug.

---

## Cache for Location-Derived Data — Key on the Inputs

A TTL cache for data derived from a location (or any user input) **must include that input in the cache key**, not only the TTL. `fetchPois` originally returned cached `pois` whenever they were fresh within `POI_CACHE_TTL`, **regardless of coordinate** — so switching location within 5 min returned the *previous* location's POIs. The cache now also requires `globalData.poisCoord` to equal the requested coord. Apply the same rule to any cache whose source input can change between calls.

---

## Server State

No server state layer exists yet. When real recommendation APIs are introduced, add a dedicated service module rather than calling `wx.request` directly from multiple pages.

---

## Common Mistakes

Do not mutate `this.data` directly. Use `this.setData()` for values rendered by WXML so the view updates consistently.
