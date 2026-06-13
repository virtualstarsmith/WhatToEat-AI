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

## Server State

No server state layer exists yet. When real recommendation APIs are introduced, add a dedicated service module rather than calling `wx.request` directly from multiple pages.

---

## Common Mistakes

Do not mutate `this.data` directly. Use `this.setData()` for values rendered by WXML so the view updates consistently.
