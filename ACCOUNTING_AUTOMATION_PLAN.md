# Accounting Automation Plan: Google Sheets + LINE OA

## Executive Summary

This document outlines a phased plan to evolve the existing receipt-processing bot into a
**full accounting automation system** that covers the complete expense lifecycle — from receipt
capture through approval, reporting, and budget management — entirely through LINE OA and
Google Sheets.

---

## Current State

The existing system handles:
- LINE OA image messages → OpenAI Vision OCR → Google Sheets row append
- Two expense types: Office and Group Tour (with interactive tour-group selector)
- Thai-language UI and 4 expense categories
- HMAC-verified webhook, Dockerized deployment

**Gap:** The system only records expenses. It does not report, approve, alert, or analyse them.

---

## Target Architecture

```
LINE OA (user-facing)
  │  image / text / postback / rich-menu tap
  ▼
Express Webhook Server  ──►  OpenAI Vision (OCR)
  │
  ├──► Receipt Processor ──► Duplicate Detector ──► Google Sheets (raw data)
  │
  ├──► Approval Engine  ──► Manager LINE push ──► Approval postback
  │
  ├──► Report Scheduler ──► Google Sheets (pivot) ──► LINE push (Flex Message)
  │
  └──► Budget Monitor   ──► Google Sheets (budget) ──► Alert push
```

**Storage:** All data stays in Google Sheets (no additional database required).
Four sheets per spreadsheet:

| Sheet | Purpose |
|---|---|
| `Expenses` | Raw transaction log (existing) |
| `Budget` | Monthly budget per category |
| `Summary` | Auto-calculated pivot (formulas only) |
| `Config` | Team members, tour groups, thresholds |

---

## Phase 1 — Foundation Hardening (Week 1–2)

### 1.1 LINE Rich Menu

Set up a persistent Rich Menu at the bottom of every LINE OA conversation so users never
need to type commands.

**Rich Menu layout (2 × 3 grid):**

```
┌──────────────┬──────────────┬──────────────┐
│  📷 Scan     │  📊 Report   │  💰 Budget   │
│  Receipt     │  This Month  │  Status      │
├──────────────┼──────────────┼──────────────┤
│  📋 My       │  🔍 Search   │  ❓ Help     │
│  Expenses    │  Expense     │              │
└──────────────┴──────────────┴──────────────┘
```

Each tile sends a postback event that the webhook handles:
- `action=scan` — prompts user to send a photo
- `action=report` — sends this month's summary
- `action=budget` — sends current budget vs. actual
- `action=my_expenses` — lists the user's last 10 entries
- `action=search` — prompts for keyword/date range
- `action=help` — sends usage instructions

**Files to create/modify:**
- `src/services/richmenu.service.ts` — create/update rich menu via LINE API on startup
- `src/index.ts` — call `initRichMenu()` alongside `initSheetHeaders()`

---

### 1.2 Duplicate Receipt Detection

Before writing to Sheets, hash the image bytes (SHA-256) and compare against the last
90 days of hashes stored in a `Config` sheet column. If a match is found, reply with a
warning and skip the write.

**Files:**
- `src/services/duplicate.service.ts`
- `src/routes/webhook.ts` — add duplicate check step in pipeline

---

### 1.3 User Identity Mapping

Map LINE `userId` to a display name and department stored in the `Config` sheet.
On first interaction, prompt the user to enter their name and department via a quick-reply
message. Store the mapping so every Sheets row carries `Submitted By` and `Department`.

**New Sheets columns:**
`Date | Merchant | Amount | Category | Expense Type | Tour Group | Submitted By | Department | LINE Message ID | Recorded At | Image Hash`

**Files:**
- `src/services/user.service.ts`
- `src/types/index.ts` — extend `SheetRow`

---

### 1.4 Receipt Correction Flow

Allow a user to correct a misread receipt within 5 minutes of submission via a postback
`action=correct&messageId=xxx`. A carousel Flex Message lets them adjust amount, category,
or merchant name using quick replies.

---

## Phase 2 — Approval Workflow (Week 2–3)

### 2.1 Approval Rules Engine

Define per-department thresholds in the `Config` sheet:

| Department | Auto-approve ≤ | Requires 1 approver > | Requires 2 approvers > |
|---|---|---|---|
| Operations | 500 THB | 500 THB | 5,000 THB |
| Sales | 1,000 THB | 1,000 THB | 10,000 THB |
| Management | 5,000 THB | 5,000 THB | 50,000 THB |

**Approval flow:**

```
Receipt submitted
       │
   [amount ≤ threshold?]
       ├── YES ──► Auto-approved, write to Sheets with status=Approved
       └── NO  ──► Write with status=Pending, push approval request to manager LINE
                        │
                   Manager taps Approve / Reject in Flex Message
                        │
                   Webhook receives postback, updates Sheets row, notifies submitter
```

**Files:**
- `src/services/approval.service.ts`
- `src/routes/webhook.ts` — handle `action=approve` and `action=reject` postbacks
- New `SheetRow` field: `Status` (Pending | Approved | Rejected)

### 2.2 Manager Flex Message

```
┌─────────────────────────────────┐
│  💳 Expense Approval Request    │
│  ─────────────────────────────  │
│  From:    Somchai K. (Sales)    │
│  Merchant: Central Dept Store   │
│  Amount:  ฿ 3,200               │
│  Category: อุปกรณ์สำนักงาน       │
│  Date:    12 May 2026           │
│  ─────────────────────────────  │
│  [  ✅ Approve  ]  [ ❌ Reject ] │
└─────────────────────────────────┘
```

---

## Phase 3 — Automated Reporting (Week 3–4)

### 3.1 Report Types

| Report | Trigger | Recipient |
|---|---|---|
| Daily flash | 18:00 every weekday | Admin LINE group |
| Weekly summary | Monday 08:00 | Admin LINE group |
| Monthly close | 1st of month 09:00 | All managers |
| Budget alert | When category hits 80% of budget | Category owner |
| Anomaly alert | Amount > 2× average for category | Admin |

### 3.2 Daily Flash (Flex Message)

```
┌───────────────────────────────────┐
│  📊 Daily Expense Flash           │
│  12 May 2026                      │
│  ─────────────────────────────── │
│  Transactions today:  7           │
│  Total:           ฿ 14,320        │
│  ─────────────────────────────── │
│  🍽 Food & Drink      ฿  3,200   │
│  🏢 Office Supply     ฿  5,100   │
│  ✈ Travel             ฿  4,500   │
│  📦 Other             ฿  1,520   │
│  ─────────────────────────────── │
│  Budget used (May):   62%         │
│  [ View Full Report → ]           │
└───────────────────────────────────┘
```

### 3.3 Google Sheets Summary Tab

Auto-calculated formulas (no server computation):

```
=SUMIFS(Expenses!C:C, Expenses!E:E, "Approved",
        Expenses!A:A, ">="&DATE(YEAR(TODAY()),MONTH(TODAY()),1))
```

Pivot table broken down by Category × Week, updated whenever Sheets recalculates.

### 3.4 Report Scheduler

Use a lightweight cron runner (e.g., `node-cron`) inside the existing Express process:

**Files:**
- `src/services/scheduler.service.ts` — `node-cron` jobs
- `src/services/report.service.ts` — build Flex Message payloads from Sheets data
- `src/index.ts` — `initScheduler()` on startup

---

## Phase 4 — Budget Management (Week 4–5)

### 4.1 Budget Sheet Schema

```
Budget sheet columns:
Month | Category | Department | Budget THB | Rollover | Notes
```

Managers set budgets by sending a LINE message:
`/budget set อาหาร 20000` or via a Google Sheets edit (polled every hour).

### 4.2 Budget Commands (LINE text)

| Command | Example | Action |
|---|---|---|
| `/budget set <cat> <amt>` | `/budget set อาหาร 20000` | Set monthly budget |
| `/budget view` | `/budget view` | Show all budgets + usage |
| `/budget history <cat>` | `/budget history อาหาร` | Last 6 months for category |

### 4.3 Over-Budget Alert

```
┌──────────────────────────────────┐
│  ⚠️ Budget Alert                 │
│  ─────────────────────────────  │
│  Category: อาหารและเครื่องดื่ม   │
│  Budget:       ฿ 20,000          │
│  Spent so far: ฿ 17,450  (87%)  │
│  Remaining:    ฿  2,550          │
│  Days left in May: 19            │
└──────────────────────────────────┘
```

---

## Phase 5 — Multi-Team & Search (Week 5–6)

### 5.1 Department Separation

Each department gets its own Google Sheet tab. The server routes rows based on the
submitter's department stored in `Config`. Cross-department roll-ups live in `Summary`.

### 5.2 Expense Search via LINE

User sends: `ค้นหา central 1-15 พฤษภาคม`

Server parses the query, runs a filtered read on the Expenses sheet, and replies with
a scrollable Flex Message carousel (max 10 results per page with a "Next →" button).

**Files:**
- `src/services/search.service.ts`
- `src/services/nlp.service.ts` — simple date/keyword extractor (OpenAI function-calling)

### 5.3 Export to PDF

On-demand: user sends `/export May 2026`.

Server reads the filtered Sheets range, renders an HTML template using `handlebars`,
converts to PDF with `puppeteer`, uploads the file to LINE's content server, and sends
it as a file message.

**Files:**
- `src/services/export.service.ts`
- `src/templates/monthly-report.hbs`

---

## Technical Implementation Details

### Environment Variables (additions)

```env
# Approval
MANAGER_LINE_USER_IDS=Uxxxx,Uyyy   # comma-separated manager LINE user IDs
APPROVAL_GROUP_ID=Cxxxx            # optional LINE group for approval queue

# Scheduler
REPORT_TIMEZONE=Asia/Bangkok
DAILY_REPORT_TIME=18:00
WEEKLY_REPORT_DAY=MON
MONTHLY_REPORT_HOUR=9

# Budget
BUDGET_ALERT_THRESHOLD=0.8         # 80%

# Sheets tabs
GOOGLE_BUDGET_SHEET_NAME=Budget
GOOGLE_SUMMARY_SHEET_NAME=Summary
GOOGLE_CONFIG_SHEET_NAME=Config
```

### New Dependencies

```json
{
  "node-cron": "^3.0.3",
  "handlebars": "^4.7.8",
  "puppeteer": "^22.0.0",
  "crypto": "built-in"
}
```

### Updated Directory Structure

```
src/
├── index.ts                      (startup orchestration)
├── routes/
│   └── webhook.ts                (event router)
├── services/
│   ├── approval.service.ts       ← NEW
│   ├── budget.service.ts         ← NEW
│   ├── duplicate.service.ts      ← NEW
│   ├── export.service.ts         ← NEW
│   ├── line.service.ts           (enhanced)
│   ├── nlp.service.ts            ← NEW
│   ├── report.service.ts         ← NEW
│   ├── richmenu.service.ts       ← NEW
│   ├── scheduler.service.ts      ← NEW
│   ├── search.service.ts         ← NEW
│   ├── sheets.service.ts         (enhanced)
│   ├── user.service.ts           ← NEW
│   └── vision.service.ts         (existing)
├── templates/
│   └── monthly-report.hbs        ← NEW
└── types/
    └── index.ts                  (extended)
```

---

## Google Sheets Setup Guide

### Step 1 — Spreadsheet Tabs

Create these four tabs in the target Google Spreadsheet:

1. **Expenses** — transaction log (auto-managed by server)
2. **Budget** — manually populated by finance team
3. **Summary** — formula-driven pivot (paste formulas from Appendix A)
4. **Config** — user map, tour groups, thresholds

### Step 2 — Summary Tab Formulas (Appendix A)

```
B2  =SUMPRODUCT((MONTH(Expenses!A2:A)=MONTH(TODAY()))*(YEAR(Expenses!A2:A)=YEAR(TODAY()))*(Expenses!F2:F="Approved")*Expenses!C2:C)
B3  =SUMPRODUCT((MONTH(Expenses!A2:A)=MONTH(TODAY()))*(Expenses!D2:D="อาหารและเครื่องดื่ม")*(Expenses!F2:F="Approved")*Expenses!C2:C)
```

### Step 3 — Config Tab Schema

```
Row 1 (header): LINE_USER_ID | Display Name | Department | Role | Active
Row 2+: Uxxxx | Somchai K. | Sales | Staff | TRUE
```

---

## LINE OA Setup Checklist

- [ ] LINE Official Account created (Messaging API enabled)
- [ ] Webhook URL set to `https://<your-domain>/webhook`
- [ ] Verify token set in LINE Developers Console
- [ ] Rich Menu created via API on first deploy (`initRichMenu()`)
- [ ] LINE group created for admin reports; group ID added to `REPORT_GROUP_ID`
- [ ] Manager LINE user IDs added to `MANAGER_LINE_USER_IDS`

---

## Deployment Checklist

- [ ] Google Service Account with Sheets API + Drive API enabled
- [ ] Service account JSON added as env var `GOOGLE_SERVICE_ACCOUNT_JSON`
- [ ] Spreadsheet shared with service account email
- [ ] All four sheet tabs created
- [ ] Docker image built and pushed: `docker build -t receipt-assistant .`
- [ ] Health check passing: `GET /health` returns `{ "status": "ok" }`
- [ ] LINE webhook verified in console

---

## Phased Delivery Timeline

| Week | Phase | Deliverable |
|---|---|---|
| 1 | 1.1 – 1.2 | Rich Menu live, duplicate detection active |
| 2 | 1.3 – 1.4 + 2.1 | User identity, correction flow, approval rules |
| 3 | 2.2 – 3.1 | Manager Flex approval, daily/weekly report push |
| 4 | 3.2 – 3.4 | Summary sheet formulas, cron scheduler |
| 5 | 4.1 – 4.3 | Budget sheet, budget commands, over-budget alerts |
| 6 | 5.1 – 5.3 | Department split, expense search, PDF export |

---

## Success Metrics

| Metric | Baseline | Target (after 30 days) |
|---|---|---|
| Manual data entry time | 15 min/receipt | < 30 sec/receipt |
| Expense report preparation | 4 hrs/month | Fully automated |
| Receipt submission rate | ~60% (paper-based) | > 95% (LINE) |
| Average approval cycle | 3–5 days | < 4 hours |
| Budget overrun incidents | Unknown | Reduced by 50% via alerts |

---

*Plan version 1.0 — May 2026*
