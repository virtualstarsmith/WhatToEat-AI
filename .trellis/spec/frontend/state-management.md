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

## POI Identity — Stable poi_id, Never Array Index

A POI's identity (`poi_id`) must be a **stable unique identifier**, never the array index. Index-based ids drift the moment the POI pool is re-fetched, re-paginated, or re-sorted, which silently breaks session de-duplication (the same shop gets re-recommended, or fresh shops get wrongly excluded).

**Single source of truth — `utils/util.js` `makePoiId(poi)`:**

- Priority: high-de `poi.poi_id` (the Amap global id, transparently passed through by `cloudfunctions/getPoi/index.js` `normalizePoi`).
- Fallback: composite key `${location}|${name}` (matches getPoi's own cross-page dedup key) when `poi_id` is missing.

**Rules:**

- Every place that needs a per-POI id (scoring, candidate maps, exclude sets, opened-box dedup, AI response join) MUST call `makePoiId(poi)`. Do not re-derive the key locally.
- `cloudfunctions/getPoi/index.js` `normalizePoi` MUST keep passing `poi.id` through as `poi_id`; new POI sources must populate `poi_id` too.
- `excludeIds` / `openedIds` are page-local session state and are **not** persisted across app launches, so there is no storage migration concern when the id scheme changes.

This was originally codified in `.trellis/tasks/06-14-mystery-box-feature/design.md` and re-affirmed by `06-24-poi-id-stable` after the index page was found violating it (`String(idx)`). Do not reintroduce array-index ids.

---

## Scoring Primitives — Single Source, Parameterize the Weights

The distance/quality scoring primitives live in **one** place: `utils/scoring.js`. It exports:

- `distanceScore(distance)` — `Math.exp(-distance/800)`, exponential decay (~800m ≈ 10 min walk).
- `qualityScore(rating)` — `rating ? rating/5.0 : 0.3` (no rating ⇒ downgrade, not median).
- `scoreCandidates(pois, { weights, bonus, matcher, excludeIds })` — parameterized aggregation that returns `[{ poi_id, poi, score, matched }]`, with `poi_id` from `makePoiId`.

The two pages (index = "reliable", mystery = "surprise") share these **primitives** but pass **different weight profiles** — index `{d:0.5,q:0.5}`, mystery `{d:0.4,q:0.4,longtail:0.2}`. This is the split between *spec* (the formula) and *parameter* (the weights); do not collapse them back into per-page copies.

**Rules:**

- Do not redefine `distanceScore`/`qualityScore` in a page or another module. Import from `utils/scoring.js`. (`utils/mysteryBox.js` re-exports them only to preserve its existing export contract — they resolve to the same function.)
- Page-specific multipliers (`sceneMultiplier` in index, `timeAwareMultiplier` + `longTailBonus` in mystery) and selection logic (`topN`/`topNWithExplore` in index, `weightedRandomPick` in mystery) stay in their own files. `scoreCandidates` accepts them as `matcher`/`bonus` callbacks rather than hard-coding them — keep it that way; do not over-merge multiplier semantics into the shared module.
- When a new scoring consumer is added, inject its weights/multipliers as callbacks. Do not copy the formula.

Codified by `06-24-scoring-module` after `distanceScore`/`qualityScore` were found duplicated verbatim across `index.js` and `mysteryBox.js` (plus a deleted cloud function), with only the *weights* actually differing — a classic drift hazard.

---

## Scenes — Single Source (`config/scenes.js`), canonical+alias matching

Dining-scene definitions live in **one** place: `config/scenes.js`. It exports `SCENES` (6 scene declarations), `SCENE_NAMES`, `getScene(name)`, and `matchesScene(sceneName, poi)`. Each scene object carries the full spec: `name, toneClass, reasonTone, match { canonical: [alias...] }, weights, conflicts`. The old flat `config/sceneKeywords.js` is **deleted**; do not reintroduce it.

**Matching = canonical + alias union (substring `indexOf`), NOT word-boundary regex.** Adding a synonymous category (e.g. a new noodle-shop variant) means appending one alias under the right canonical — zero algorithm change. This is what fixed the 06-21 "面馆≠面食" root cause (previously patched by hand-stuffing keywords).

**Rules:**

- All scene matching (page multipliers, mystery `detectPoiScene`, conflict check) MUST call `matchesScene`. Do not write a new `keywords.some(k => haystack.indexOf(k))` loop.
- Page multipliers keep their own **coefficients** (index `sceneMultiplier` 1.0/0.5 hard; mystery `timeAwareMultiplier` 1.2/0.85 soft) — only the *matching* is unified, not the coefficients.
- `conflicts` is declared per scene and is treated symmetrically by `isSceneMismatch`. Cover all 6 scenes.
- Matching set only **expands** (alias union). A POI that matched before still matches.

Codified by `06-24-scene-system`.

---

## Shared Page Utilities & Components

**`utils/recommend.js`** holds page-shared pure helpers: `detectScene()`, `formatDistance(d)`, `formatRating(r)`, `pad2(n)`. The two pages previously duplicated these verbatim (with `detectScene` byte-identical). Import from here; do not redefine.

**`utils/aiRecommend.js`** is the single AI-call layer: `parseRecommendJson` (4-tier tolerant fallback), `tolerantParseRecommendations`, `streamAiText` (wx.cloud cloudbase textStream→eventStream dual-path accumulation), `callAiRecommend`. Both pages call it; the prompt is injected via the caller's messages. `parseRecommendJson` is a pure function with no wx dependency — **tests `require` it, they do not copy it**.

**Components** `components/restaurant-card` (props `card`/`variant` 'index'|'mystery'/'isMismatch`; events `navigate`/`copyaddr`/`coupon`) and `components/coupon-float` (props `platforms`/`show`; events `toggle`/`open`) are registered globally in `app.json` `usingComponents`. They reuse global `app.wxss` classes via `options.addGlobalClass: true` — do not duplicate card styles into the component wxss.

**Rules:**

- `callAIRecommend`/`callMysteryAIReason` delegate streaming to `streamAiText`; do not re-inline `createModel`/`streamText`/the accumulation loop.
- New AI-call consumers inject their prompt via `callAiRecommend({ messages })`; do not copy the streaming logic.
- Card/coupon UI edits happen in the component, not duplicated per page.

Codified by `06-24-recommend-module` and `06-24-ai-recommend`.

---

## Common Mistakes

Do not mutate `this.data` directly. Use `this.setData()` for values rendered by WXML so the view updates consistently.
