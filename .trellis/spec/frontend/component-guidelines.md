# Component Guidelines

> How components are built in this project.

---

## Overview

The current UI is implemented with native WeChat Mini Program pages and built-in components. Prefer page-local WXML/WXSS for simple screens; introduce custom components only after the same UI pattern appears in multiple pages.

---

## Component Structure

For page-level UI, keep structure in `.wxml`, behavior in `.js`, page config in `.json`, and styles in `.wxss`. Keep event handler names action-oriented, such as `selectTaste`, `shuffleRecommendation`, or `openLogs`.

---

## Props Conventions

When passing data through WXML, use `data-*` attributes for event payloads and read them from `event.currentTarget.dataset`. Keep payload values simple strings or ids.

---

## Styling Patterns

Use global styles in `app.wxss` only for app-wide page defaults and shared utility classes. Keep screen-specific layout and visual styles in the page's `.wxss` file. Prefer stable dimensions for buttons and repeated controls so tap states do not shift layout.

---

## Accessibility

Interactive elements should use native Mini Program components such as `button` when possible so built-in tap handling and platform behavior are preserved.

---

## Common Mistakes

Do not bind a UI tap directly to a method whose first argument is intended to be business data. WeChat passes the event object as the first argument; wrap the action in a no-argument handler when the method should use current page state.
