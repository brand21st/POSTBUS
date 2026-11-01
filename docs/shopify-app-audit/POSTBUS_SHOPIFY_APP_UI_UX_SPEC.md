# PostBus Shopify App UI/UX Spec

**Date:** 2026-10-20  
**UI system:** Polaris App Home **iframe** model — `s-*` web components, App Bridge APIs (Navigation, Toast, Modal, Loading, Save Bar, Print, ID Token, User).  
**Do not** clone the current Tailwind dashboard into the iframe.

---

## 1. Navigation (refined after audit)

MVP nav:

1. Home  
2. Orders  
3. Shipments  
4. Labels  
5. Automation  
6. Settings (India Post, parcel, print, account link)

P1+: Tracking, NDR, Manifests, Billing (Shopify hosted plans + usage read-only), Support.

**Not in nav:** Admin, Affiliates, Inventory, AI, Developer keys, Wati.

---

## 2. Page specs

### Home

Setup guide until India Post verify + barcode range complete. Metrics cards: unbooked Shopify orders, booking failures, labels ready. Primary CTA: Orders needing booking.

Components: `s-page`, setup guide composition, `s-banner` for `RECOVERY_REQUIRED` count.

### Orders (Index)

`s-table` variant auto, `s-search-field`, filters (status, payment, date). Pagination: start with existing page/pageSize; **select-all must union pages or “select all matching filter” with explicit count** — do not copy `DataTable` header replace bug.

Bulk: Book India Post, Sync from Shopify. Confirm modal for book.

Empty state: connect/sync.

### Order detail

Sections: customer/address (edit if shipment open), lines, weight/dims, payment/COD breakdown (read-only Shopify totals + editable extra COD per existing rules), activity.

Actions: Book, Retry, Download label, View tracking.

### Shipments / Labels

Index + detail timeline. Labels: download PDF, Print (`print()`). Banner: USB printers need Print Agent.

### Automation / Settings

`s-switch` per flag with helper text. Settings: India Post account connection pattern; password fields; verify button; office pickers; barcode range.

Save Bar for dirty settings.

### Billing

Deep link to Shopify’s plan page (App Pricing). In-app: remaining quota from `billing_usage` (read).

---

## 3. Mapping from existing pages

See `POSTBUS_SHOPIFY_FEATURE_PARITY.md`. Dashboard home → Home. Orders list/detail → Orders. Shipments/labels → same. India Post integration → Settings onboarding. Shopify integration page → **deleted** (install is Shopify).

---

## 4. Admin extensions (P1)

| Extension | Target use | Notes |
|-----------|------------|-------|
| Admin action | Order More actions: Book with PostBus | Modal; calls BFF; merchant must still have CEPT ready |
| Admin block | Order card: PostBus status/AWB | Merchant pins block |
| Admin print | Print shipping label PDF | `s-admin-print-action` |
| Admin link | “Open PostBus workspace” | For bulk desk |

Main workspace stays App Home.

---

## 5. Feedback patterns

- Toast on book queued / label ready  
- Banner on recovery required (do not offer “Book again” without reconcile)  
- Spinner via App Bridge Loading on first paint  
- Errors: CEPT validation vs timeout (timeout → recovery copy)  
- Confirmation: bulk book N orders  

---

## 6. Responsive

Polaris table `listSlot` for mobile. Test Shopify Mobile: `print()` via App Bridge; ID tokens still required (incognito).

---

## 7. Accessibility / i18n

Unicode labels already support ML/TA/HI in PDFs. Admin UI language: English MVP (**ASSUMPTION** unless product requires Malayalam UI).
