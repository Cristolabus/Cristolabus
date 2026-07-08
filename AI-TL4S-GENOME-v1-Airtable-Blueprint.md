# AI-TL4S GENOME v1 — Airtable Implementation Blueprint

**Version:** 1.0
**Status:** Ready to build
**Target platform:** Airtable (Pro plan or above recommended)
**Migration path:** Supabase (Postgres) — schema designed with 1:1 field/relation portability
**Owner:** Cristóbal De La Nó Ruiz

---

## 0. Blueprint Reading Guide

- Every table has a primary key called `id` (Airtable auto-record ID) plus a human-readable `slug` (unique text) used as the future Supabase `id` after export.
- **Required (R)** fields are enforced by form validation and automation checks.
- **Optional (O)** fields are safe to leave blank; automations skip them.
- Field types follow Airtable's native types (Single line text, Long text, Single select, Multiple select, Attachment, URL, Email, Phone, Number, Currency, Percent, Date, Date+time, Checkbox, Linked record, Rollup, Lookup, Count, Formula, Duration, Rating, Barcode, Button, Created time, Last modified time, Created by, Last modified by, Autonumber, Collaborator).
- Linked-record fields are **bidirectional**; the reverse link is auto-created and named in `[brackets]` below.
- Formula fields include the exact Airtable formula, ready to paste.

---

## 1. Base Architecture

**Base name:** `AI-TL4S GENOME v1`

**Tables (9):**

| # | Table | Role | Approx. records year 1 |
|---|-------|------|-----------------------:|
| 1 | Tools | Master catalogue of AI tools | 2 000 |
| 2 | Categories | Taxonomy — capability groupings | 60 |
| 3 | Use Cases | Concrete jobs-to-be-done | 200 |
| 4 | Industries | Vertical markets served | 40 |
| 5 | Evaluations | Time-stamped scoring events per tool | 4 000 |
| 6 | Collections | Curated public bundles ("Top 10 …") | 150 |
| 7 | Labs | Experiments / benchmarks / write-ups | 80 |
| 8 | Tool Stacks | Multi-tool workflows recommended by TL4S | 120 |
| 9 | Newsletter Mentions | Every time a tool appears in a newsletter | 1 500 |

**Interfaces (built after tables):**
- **Editorial Cockpit** — review queue + kanban
- **Scoring Dashboard** — leaderboards, distribution charts
- **Publishing Console** — collection & lab publishing
- **Public Preview** — read-only Gold Standard view

---

## 2. Table Specifications

### 2.1 Tools

Master catalogue. One row = one AI tool.

| Field Name | Type | Description | R/O |
|---|---|---|---|
| `name` | Single line text | Primary field. Canonical tool name. | R |
| `slug` | Formula | `LOWER(SUBSTITUTE({name}," ","-"))` — unique key for Supabase export. | R |
| `tagline` | Single line text (140 chars) | One-sentence value prop. | R |
| `description_long` | Long text (rich) | Editorial write-up, markdown allowed. | O |
| `logo` | Attachment | Square logo, ≥512 px. | R |
| `screenshots` | Attachment (multi) | Up to 6. | O |
| `website_url` | URL | Homepage. | R |
| `pricing_url` | URL | Direct link to pricing page. | O |
| `signup_url` | URL | Affiliate or tracked link. | O |
| `vendor` | Single line text | Legal entity / company name. | R |
| `hq_country` | Single select | ISO country list. | O |
| `founded_year` | Number (integer) | 4-digit year. | O |
| `pricing_model` | Multiple select | Free, Freemium, Paid, Usage-based, One-time, Open-source, Enterprise. | R |
| `starting_price_usd` | Currency (USD) | Lowest paid tier / month. | O |
| `has_free_tier` | Checkbox | | O |
| `has_api` | Checkbox | | O |
| `has_sso` | Checkbox | Enterprise signal. | O |
| `soc2` | Checkbox | | O |
| `gdpr_ready` | Checkbox | | O |
| `data_training_opt_out` | Checkbox | Vendor allows opting out of training on user data. | O |
| `deployment` | Multiple select | Cloud SaaS, On-prem, Hybrid, Local-first, Browser extension, Desktop app, Mobile app. | O |
| `platforms` | Multiple select | Web, iOS, Android, macOS, Windows, Linux, CLI, VS Code, JetBrains, Slack, Chrome. | O |
| `categories` | Linked → Categories `[tools]` | Primary taxonomy. | R |
| `use_cases` | Linked → Use Cases `[tools]` | Jobs-to-be-done served. | R |
| `industries` | Linked → Industries `[tools]` | Verticals. | O |
| `alternatives` | Linked → Tools (self) `[alternative_of]` | Competitor / substitute tools. | O |
| `stage` | Single select | Detected, Researched, Tested, Evaluated, Published, Gold Standard, Deprecated. Default: Detected. | R |
| `status` | Single select | New, Under Review, Evaluated, Published, Gold Standard, Needs Update, Archived. Driven by automation. | R |
| `first_seen_at` | Date | Auto-set by "New tool" automation. | R |
| `last_reviewed_at` | Date | Last time an Evaluation was completed. Rollup MAX({Evaluations.evaluated_at}). | O |
| `next_review_due` | Formula | `DATEADD({last_reviewed_at}, 90, 'days')`. | O |
| `evaluations` | Linked → Evaluations `[tool]` | Every scoring event. | O |
| `latest_evaluation` | Lookup | Highest `evaluated_at` from Evaluations. | O |
| `trust_score` | Rollup | `MAX(values)` of `{Evaluations.trust_score}` filtered `is_latest = 1`. 0–100. | O |
| `business_score` | Rollup | Same pattern. | O |
| `creator_score` | Rollup | Same pattern. | O |
| `enterprise_score` | Rollup | Same pattern. | O |
| `learning_score` | Rollup | Same pattern. | O |
| `composite_score` | Formula | Weighted blend — see §5.6. | O |
| `is_gold_standard` | Formula | `IF(AND({composite_score}>=85,{trust_score}>=80,{status}!='Archived'),1,0)`. | O |
| `collections` | Linked → Collections `[tools]` | Bundles the tool appears in. | O |
| `labs` | Linked → Labs `[tools_featured]` | Labs that used this tool. | O |
| `tool_stacks` | Linked → Tool Stacks `[tools]` | Stacks that include the tool. | O |
| `newsletter_mentions` | Linked → Newsletter Mentions `[tool]` | | O |
| `mention_count` | Count | Rollup of `newsletter_mentions`. | O |
| `assigned_reviewer` | Collaborator | Editor owning the current review cycle. | R when status = Under Review |
| `internal_notes` | Long text | Editorial-only. | O |
| `public_url` | Formula | `"https://tl4s.com/tools/" & {slug}` — for automations posting to CMS. | O |
| `created_at` | Created time | | R |
| `created_by` | Created by | | R |
| `updated_at` | Last modified time | | R |

**Primary field:** `name`.

---

### 2.2 Categories

Capability taxonomy (max depth 2).

| Field Name | Type | Description | R/O |
|---|---|---|---|
| `name` | Single line text | Primary. e.g. "Voice Cloning". | R |
| `slug` | Formula | `LOWER(SUBSTITUTE({name}," ","-"))`. | R |
| `parent_category` | Linked → Categories (self) `[children]` | For 2-level hierarchy. | O |
| `description` | Long text | Public-facing definition. | R |
| `icon` | Attachment | SVG or PNG. | O |
| `tools` | Linked → Tools `[categories]` | | O |
| `tool_count` | Count | On `tools`. | O |
| `avg_composite_score` | Rollup | `AVERAGE({tools.composite_score})`. | O |
| `is_featured` | Checkbox | Surface on public directory. | O |
| `created_at` | Created time | | R |

---

### 2.3 Use Cases

Jobs-to-be-done. Bridges tools ↔ user intent.

| Field Name | Type | Description | R/O |
|---|---|---|---|
| `name` | Single line text | e.g. "Generate a launch video from a script". | R |
| `slug` | Formula | | R |
| `description` | Long text | | R |
| `persona` | Multiple select | Creator, Founder, Marketer, Developer, Educator, Student, Researcher, Ops, Executive. | R |
| `complexity` | Single select | Low, Medium, High. | O |
| `related_categories` | Linked → Categories | | O |
| `tools` | Linked → Tools `[use_cases]` | | O |
| `recommended_stack` | Linked → Tool Stacks `[use_cases]` | Suggested workflow. | O |
| `tool_count` | Count | | O |
| `created_at` | Created time | | R |

---

### 2.4 Industries

Vertical markets.

| Field Name | Type | Description | R/O |
|---|---|---|---|
| `name` | Single line text | e.g. "Legal", "Higher Education". | R |
| `slug` | Formula | | R |
| `description` | Long text | | O |
| `regulatory_flags` | Multiple select | HIPAA, GDPR, SOX, FERPA, PCI, ITAR. | O |
| `tools` | Linked → Tools `[industries]` | | O |
| `collections` | Linked → Collections `[industries]` | | O |
| `tool_count` | Count | | O |
| `created_at` | Created time | | R |

---

### 2.5 Evaluations

Time-stamped scoring event. Immutable once `status = Completed`.

| Field Name | Type | Description | R/O |
|---|---|---|---|
| `evaluation_id` | Autonumber | Primary. Human ref: `EV-000123`. | R |
| `tool` | Linked → Tools `[evaluations]` | | R |
| `evaluator` | Collaborator | Person doing the review. | R |
| `status` | Single select | Pending, In Progress, Completed, Voided. Default: Pending. | R |
| `started_at` | Date+time | Auto-set when status → In Progress. | O |
| `evaluated_at` | Date+time | Auto-set when status → Completed. | O |
| `is_latest` | Checkbox | Only the latest completed eval per tool = TRUE. Managed by automation §7.5. | O |
| `plan_tested` | Single select | Free, Starter, Pro, Business, Enterprise. | R |
| `test_environment` | Long text | Hardware, browser, dataset used. | O |
| **Trust dimension** | | | |
| `t_reliability` | Rating (1–5) | Uptime, error rate over 30-day test. | R |
| `t_accuracy` | Rating (1–5) | Output correctness on standard prompts. | R |
| `t_safety` | Rating (1–5) | Guardrails, PII handling. | R |
| `t_transparency` | Rating (1–5) | Model card, docs, changelog. | R |
| `t_privacy` | Rating (1–5) | Data handling, opt-outs. | R |
| `trust_score` | Formula | See §5.1. 0–100. | R |
| **Business dimension** | | | |
| `b_roi_speed` | Rating (1–5) | Time-to-first-value. | R |
| `b_pricing_fairness` | Rating (1–5) | Cost vs. output. | R |
| `b_integrations` | Rating (1–5) | Native connectors, API depth. | R |
| `b_scalability` | Rating (1–5) | Team/seat/volume growth. | R |
| `b_support` | Rating (1–5) | Docs + response time. | R |
| `business_score` | Formula | See §5.2. | R |
| **Creator dimension** | | | |
| `c_output_quality` | Rating (1–5) | Aesthetic / brand quality. | R |
| `c_speed` | Rating (1–5) | Generation latency. | R |
| `c_iteration` | Rating (1–5) | Ease of remixing, versioning. | R |
| `c_style_control` | Rating (1–5) | Fine control, references. | R |
| `c_export_options` | Rating (1–5) | Formats, resolutions, license. | R |
| `creator_score` | Formula | See §5.3. | R |
| **Enterprise dimension** | | | |
| `e_security` | Rating (1–5) | SSO, SOC2, audit logs. | R |
| `e_compliance` | Rating (1–5) | GDPR, HIPAA, region residency. | R |
| `e_admin` | Rating (1–5) | RBAC, provisioning. | R |
| `e_slas` | Rating (1–5) | Uptime commitments. | R |
| `e_procurement` | Rating (1–5) | MSA, invoicing, DPA. | R |
| `enterprise_score` | Formula | See §5.4. | R |
| **Learning dimension** | | | |
| `l_docs` | Rating (1–5) | Quality of documentation. | R |
| `l_tutorials` | Rating (1–5) | Official learning resources. | R |
| `l_community` | Rating (1–5) | Discord/forum activity. | R |
| `l_curve` | Rating (1–5) | Time to competence (higher = faster). | R |
| `l_transferable` | Rating (1–5) | Skills useful beyond this tool. | R |
| `learning_score` | Formula | See §5.5. | R |
| **Meta** | | | |
| `composite_score` | Formula | See §5.6. | R |
| `verdict` | Single select | Adopt, Trial, Assess, Hold, Avoid. | R |
| `red_flags` | Multiple select | Data leak history, Vendor instability, Aggressive pricing changes, Poor support, Undocumented limits, Compliance gap. | O |
| `strengths` | Long text | | O |
| `weaknesses` | Long text | | O |
| `evidence_links` | Long text | URLs, screenshots refs. | O |
| `attachments` | Attachment | Screenshots, exported outputs. | O |
| `time_spent_minutes` | Duration | Effort tracked for capacity planning. | O |
| `created_at` | Created time | | R |
| `updated_at` | Last modified time | | R |

**Locking rule:** once `status = Completed`, field-level permissions restrict editing of all rating fields — enforced via Airtable's per-field editing permissions (Pro+).

---

### 2.6 Collections

Curated bundles for the site & newsletter.

| Field Name | Type | Description | R/O |
|---|---|---|---|
| `title` | Single line text | e.g. "10 AI Video Tools Every Creator Needs 2026". | R |
| `slug` | Formula | | R |
| `subtitle` | Single line text | | O |
| `cover_image` | Attachment | | R |
| `intro` | Long text (rich) | Editorial intro. | R |
| `body` | Long text (rich) | Numbered write-up per tool. | O |
| `status` | Single select | Draft, In Review, Ready, Published, Archived. Default: Draft. | R |
| `theme` | Multiple select | Video, Audio, Text, Code, Design, Data, Automation, Enterprise, Education. | R |
| `industries` | Linked → Industries `[collections]` | | O |
| `tools` | Linked → Tools `[collections]` | Ordered via `tools_order`. | R |
| `tools_order` | Long text | JSON array of tool slugs in display order. Managed by Publishing interface. | O |
| `curator` | Collaborator | | R |
| `publish_date` | Date | | O |
| `newsletter_issue` | Linked → Newsletter Mentions | Anchor issue if promoted. | O |
| `public_url` | Formula | `"https://tl4s.com/collections/" & {slug}`. | O |
| `views_30d` | Number | Synced from analytics. | O |
| `created_at` | Created time | | R |
| `updated_at` | Last modified time | | R |

---

### 2.7 Labs

Experiments, benchmarks, deep dives.

| Field Name | Type | Description | R/O |
|---|---|---|---|
| `title` | Single line text | e.g. "Sora vs Runway vs Veo — 8 identical prompts". | R |
| `slug` | Formula | | R |
| `hypothesis` | Long text | What we set out to test. | R |
| `methodology` | Long text | Datasets, prompts, seeds, rubric. | R |
| `results_summary` | Long text (rich) | | O |
| `raw_data` | Attachment | CSVs, sheets. | O |
| `media` | Attachment | Videos/images produced. | O |
| `status` | Single select | Draft, Running, Analyzing, Published, Archived. | R |
| `run_started` | Date | | O |
| `run_completed` | Date | | O |
| `tools_featured` | Linked → Tools `[labs]` | | R |
| `winner` | Linked → Tools | Optional highlight. | O |
| `lead_researcher` | Collaborator | | R |
| `publish_date` | Date | | O |
| `related_collections` | Linked → Collections | | O |
| `public_url` | Formula | `"https://tl4s.com/labs/" & {slug}`. | O |
| `created_at` | Created time | | R |
| `updated_at` | Last modified time | | R |

---

### 2.8 Tool Stacks

Opinionated multi-tool workflows.

| Field Name | Type | Description | R/O |
|---|---|---|---|
| `name` | Single line text | e.g. "Solo Creator Video Studio". | R |
| `slug` | Formula | | R |
| `description` | Long text | | R |
| `persona` | Single select | Creator, Founder, Marketer, Developer, Educator, Ops. | R |
| `use_cases` | Linked → Use Cases `[recommended_stack]` | | R |
| `tools` | Linked → Tools `[tool_stacks]` | Ordered. | R |
| `stack_order` | Long text | JSON array of slugs. | O |
| `steps` | Long text (rich) | Step-by-step workflow. | R |
| `monthly_cost_estimate_usd` | Currency | Rollup `SUM({tools.starting_price_usd})` unless overridden. | O |
| `difficulty` | Single select | Beginner, Intermediate, Advanced. | R |
| `status` | Single select | Draft, Published, Archived. | R |
| `curator` | Collaborator | | R |
| `public_url` | Formula | `"https://tl4s.com/stacks/" & {slug}`. | O |
| `created_at` | Created time | | R |

---

### 2.9 Newsletter Mentions

One row per tool per newsletter issue.

| Field Name | Type | Description | R/O |
|---|---|---|---|
| `mention_id` | Autonumber | Primary. `NM-000123`. | R |
| `tool` | Linked → Tools `[newsletter_mentions]` | | R |
| `issue_number` | Number | Newsletter issue #. | R |
| `issue_title` | Single line text | | R |
| `send_date` | Date | | R |
| `mention_type` | Single select | Featured, Mention, Comparison, Deprecation Warning, Deal. | R |
| `position` | Single select | Top pick, Body, Sidebar, Footer. | O |
| `blurb` | Long text | Copy that appeared. | R |
| `link_clicks` | Number | Synced from ESP. | O |
| `open_rate_pct` | Percent | Issue-level. | O |
| `related_collection` | Linked → Collections `[newsletter_issue]` | | O |
| `related_lab` | Linked → Labs | | O |
| `curator` | Collaborator | | R |
| `created_at` | Created time | | R |

---

## 3. Relationship Map

```
                        ┌────────────┐
                        │ Categories │◄──────────┐
                        └─────┬──────┘           │
                              │ 1..N             │ parent/children
                              ▼                  │
                        ┌────────────┐           │
              ┌────────►│   Tools    │◄──────────┘
              │         └─────┬──────┘
              │               │ 1..N
              │               ▼
              │         ┌────────────┐
              │         │Evaluations │  (immutable snapshots)
              │         └────────────┘
              │
              │  M..N via link fields
              │
   ┌──────────┼─────────────────────────────────────────┐
   ▼          ▼          ▼            ▼            ▼    ▼
Use Cases  Industries Collections  Labs      Tool Stacks Newsletter Mentions
   │          │          │            │            │              │
   └──────────┴──────────┴────────────┴────────────┴──────────────┘
                                (all reference Tools)
```

**Self-links:**
- `Tools.alternatives ↔ Tools` (many-to-many competitor graph)
- `Categories.parent_category ↔ Categories.children` (2-level tree)

**Uniqueness:** `slug` on every table must be unique — enforced via automation §7.6.

---

## 4. Views

### 4.1 Tools

| View | Type | Filter | Sort | Group |
|---|---|---|---|---|
| **New** | Grid | `status = "New"` | `first_seen_at ↓` | — |
| **Under Review** | Kanban | `status = "Under Review"` | `assigned_reviewer` | Reviewer |
| **Evaluated** | Grid | `status = "Evaluated"` AND `composite_score` not empty | `composite_score ↓` | — |
| **Published** | Grid | `status = "Published"` | `updated_at ↓` | Primary Category |
| **Gold Standard** | Gallery | `is_gold_standard = 1` | `composite_score ↓` | Primary Category |
| **Needs Update** | Grid | `status = "Needs Update"` OR (`next_review_due` < TODAY() AND `status` ≠ "Archived") | `next_review_due ↑` | — |
| _Ops: All active_ | Grid | `status ≠ "Archived"` | `updated_at ↓` | Status |
| _Ops: By reviewer_ | Kanban | `status = "Under Review"` | — | `assigned_reviewer` |

### 4.2 Evaluations

| View | Type | Filter | Sort |
|---|---|---|---|
| **Pending** | Grid | `status = "Pending"` | `created_at ↑` |
| **In Progress** | Kanban (by evaluator) | `status = "In Progress"` | `started_at ↑` |
| **Completed** | Grid | `status = "Completed"` | `evaluated_at ↓` |
| _Ops: Latest only_ | Grid | `is_latest = 1` | `composite_score ↓` |

### 4.3 Collections

| View | Type | Filter | Sort |
|---|---|---|---|
| **Draft** | Grid | `status = "Draft"` OR `status = "In Review"` OR `status = "Ready"` | `updated_at ↓` |
| **Published** | Gallery | `status = "Published"` | `publish_date ↓` |

### 4.4 Labs

| View | Type | Filter | Sort |
|---|---|---|---|
| **Draft** | Grid | `status = "Draft"` | `updated_at ↓` |
| **Running** | Grid | `status IN ("Running","Analyzing")` | `run_started ↑` |
| **Published** | Gallery | `status = "Published"` | `publish_date ↓` |

### 4.5 Cross-table companion views

- **Categories › Directory** (Grid, `is_featured = 1`, sort `avg_composite_score ↓`).
- **Industries › Directory** (Grid, sort `tool_count ↓`).
- **Use Cases › By Persona** (Grid grouped by `persona`).
- **Tool Stacks › Published** (Gallery, `status = "Published"`).
- **Newsletter Mentions › This Month** (Grid, `send_date` in the last 30 days).

---

## 5. Scoring Logic

Each dimension is a **weighted average of 5 sub-ratings (1–5) rescaled to 0–100**.
Weights sum to 1.00 within each dimension so scores are directly comparable.

### 5.1 Trust Score (0–100)

Weights: reliability 0.25 · accuracy 0.25 · safety 0.20 · transparency 0.15 · privacy 0.15.

Formula (paste into `Evaluations.trust_score`):

```
ROUND(
  ({t_reliability}   * 0.25 +
   {t_accuracy}      * 0.25 +
   {t_safety}        * 0.20 +
   {t_transparency}  * 0.15 +
   {t_privacy}       * 0.15) * 20
, 1)
```

### 5.2 Business Score (0–100)

Weights: roi_speed 0.25 · pricing_fairness 0.20 · integrations 0.20 · scalability 0.20 · support 0.15.

```
ROUND(
  ({b_roi_speed}         * 0.25 +
   {b_pricing_fairness}  * 0.20 +
   {b_integrations}      * 0.20 +
   {b_scalability}       * 0.20 +
   {b_support}           * 0.15) * 20
, 1)
```

### 5.3 Creator Score (0–100)

Weights: output_quality 0.30 · speed 0.15 · iteration 0.20 · style_control 0.20 · export_options 0.15.

```
ROUND(
  ({c_output_quality} * 0.30 +
   {c_speed}          * 0.15 +
   {c_iteration}      * 0.20 +
   {c_style_control}  * 0.20 +
   {c_export_options} * 0.15) * 20
, 1)
```

### 5.4 Enterprise Score (0–100)

Weights: security 0.25 · compliance 0.25 · admin 0.15 · slas 0.20 · procurement 0.15.

```
ROUND(
  ({e_security}    * 0.25 +
   {e_compliance}  * 0.25 +
   {e_admin}       * 0.15 +
   {e_slas}        * 0.20 +
   {e_procurement} * 0.15) * 20
, 1)
```

### 5.5 Learning Score (0–100)

Weights: docs 0.25 · tutorials 0.20 · community 0.15 · curve 0.20 · transferable 0.20.

```
ROUND(
  ({l_docs}         * 0.25 +
   {l_tutorials}    * 0.20 +
   {l_community}    * 0.15 +
   {l_curve}        * 0.20 +
   {l_transferable} * 0.20) * 20
, 1)
```

### 5.6 Composite Score (0–100)

The composite is a **weighted mean of the five dimensional scores**. The default TL4S profile:

Trust 0.30 · Business 0.20 · Creator 0.20 · Enterprise 0.15 · Learning 0.15.

```
ROUND(
  {trust_score}      * 0.30 +
  {business_score}   * 0.20 +
  {creator_score}    * 0.20 +
  {enterprise_score} * 0.15 +
  {learning_score}   * 0.15
, 1)
```

**Verdict rubric** (auto-suggested; editor may override):

| Composite | Trust floor | Verdict |
|---:|---:|---|
| ≥ 85 | ≥ 80 | **Adopt** |
| 70–84 | ≥ 70 | **Trial** |
| 55–69 | ≥ 60 | **Assess** |
| 40–54 | — | **Hold** |
| < 40 or any red_flag | — | **Avoid** |

Formula for `verdict_suggested` (helper field):

```
IF(OR(FIND("Data leak",{red_flags}&""),FIND("Compliance gap",{red_flags}&"")),"Avoid",
IF(AND({composite_score}>=85,{trust_score}>=80),"Adopt",
IF(AND({composite_score}>=70,{trust_score}>=70),"Trial",
IF(AND({composite_score}>=55,{trust_score}>=60),"Assess",
IF({composite_score}>=40,"Hold","Avoid")))))
```

### 5.7 Persona-weighted composites (optional projections)

Store per-persona composites as extra formula fields on **Tools** — the same latest-eval rollups, re-weighted:

- **Creator profile:** Creator 0.40 · Trust 0.25 · Learning 0.15 · Business 0.15 · Enterprise 0.05
- **Enterprise profile:** Enterprise 0.35 · Trust 0.30 · Business 0.20 · Creator 0.05 · Learning 0.10
- **Founder profile:** Business 0.35 · Trust 0.25 · Creator 0.15 · Enterprise 0.10 · Learning 0.15
- **Educator profile:** Learning 0.40 · Trust 0.25 · Creator 0.15 · Business 0.10 · Enterprise 0.10

Ship as `composite_creator`, `composite_enterprise`, `composite_founder`, `composite_educator`. Public directory sorts by the visitor's chosen persona.

---

## 6. Editorial Workflow

**Pipeline states on `Tools.stage`:**

```
Detected → Researched → Tested → Evaluated → Published → Gold Standard
                                                   │
                                                   └──► Needs Update (loop)
                                                   └──► Deprecated (terminal)
```

**Definition of done per stage:**

| Stage | Owner | Entry criteria | Exit criteria |
|---|---|---|---|
| **Detected** | Any editor | Row created with `name`, `website_url`, `vendor`. | Basic metadata + primary category set. |
| **Researched** | Analyst | Categories, use cases, industries, pricing filled. | Assigned reviewer + test plan in `internal_notes`. |
| **Tested** | Reviewer | Evaluation row exists in `In Progress`. | All 25 ratings submitted. |
| **Evaluated** | Reviewer | Evaluation `Completed`, `verdict` set. | `composite_score ≥ 55` OR `verdict ∈ {Adopt, Trial, Assess}`. |
| **Published** | Editor | Public copy (`description_long`, `logo`) approved. | Live on tl4s.com/tools/{slug}. |
| **Gold Standard** | System | `composite_score ≥ 85` AND `trust_score ≥ 80` maintained for 2 consecutive evaluations. | Manual override or drop below thresholds. |

`Tools.status` is a **derived** label managed by automation §7.1 — editors change `stage`, automation syncs `status`.

---

## 7. Automations

Airtable Automations panel. Trigger types listed match the Airtable UI.

### 7.1 Stage → Status sync
- **Trigger:** When record updated → `Tools.stage`
- **Action:** Update record — map:
  - Detected/Researched → `status = New`
  - Tested → `status = Under Review`
  - Evaluated → `status = Evaluated`
  - Published → `status = Published`
  - Gold Standard → `status = Gold Standard`
  - Deprecated → `status = Archived`

### 7.2 Tool review reminders
- **Trigger:** Scheduled — every Monday 09:00 local.
- **Find records:** `Tools` where `next_review_due` ≤ TODAY() + 7 AND `status` ≠ "Archived".
- **Action:** Send Slack DM (or Gmail) to `assigned_reviewer` listing tools due; set `status = Needs Update` if `next_review_due < TODAY()`.

### 7.3 Score update reminders
- **Trigger:** Scheduled — 1st of each month.
- **Find records:** `Tools` where `latest_evaluation.evaluated_at` older than 90 days AND `status = Published`.
- **Action:** Create new `Evaluations` row (`status = Pending`, `tool` linked, `evaluator` = last reviewer); Slack notify.

### 7.4 Content opportunities
- **Trigger:** When a category accumulates ≥ 5 `Tools` with `composite_score ≥ 75` in the last 60 days.
- **Implementation:** Scheduled daily; scripting action runs `filterByFormula` grouping tools by primary category.
- **Action:** Create a `Collections` draft titled `"Best {category.name} tools — {YYYY-MM}"`, pre-link the qualifying tools, assign curator = category owner. Slack notify.

### 7.5 Latest evaluation flag
- **Trigger:** When `Evaluations.status` becomes `Completed`.
- **Steps:**
  1. Set current row `is_latest = 1`, `evaluated_at = NOW()`.
  2. Script — find sibling evaluations for same `tool` where `is_latest = 1` AND `evaluation_id ≠ current`; set them to `is_latest = 0`.
  3. Update `Tools.last_reviewed_at`.

### 7.6 Slug uniqueness guard
- **Trigger:** Record created on any table with a `slug` formula.
- **Action:** Scripting — count records where `slug = {this.slug}`; if > 1, append a numeric suffix to `name` and notify creator.

### 7.7 Collection opportunities
- **Trigger:** When ≥ 3 tools tagged with the same `industries` link reach `stage = Published` in the last 90 days.
- **Action:** Draft a `Collections` row scoped to that industry; assign the industry owner.

### 7.8 Lab opportunities
- **Trigger:** When ≥ 3 tools in the same `categories` link have `composite_score` within 5 points of each other AND all `stage = Published`.
- **Action:** Draft a `Labs` row titled `"Head-to-head: {tool_a} vs {tool_b} vs {tool_c}"`, pre-link `tools_featured`, assign lead researcher.

### 7.9 Newsletter follow-up
- **Trigger:** When `Newsletter Mentions` row created.
- **Action:** Set `Tools.status = Published` if not already; increment mention count is automatic via `Count`.

### 7.10 Gold Standard promotion
- **Trigger:** When `Tools.composite_score` updated.
- **Condition:** `composite_score ≥ 85` AND `trust_score ≥ 80` AND last 2 completed evaluations both meet thresholds.
- **Action:** Set `stage = Gold Standard`, Slack #editorial.

### 7.11 Needs Update watchdog
- **Trigger:** Scheduled daily 06:00.
- **Find records:** `Tools` where `next_review_due < TODAY()` AND `status ∈ {Published, Gold Standard}`.
- **Action:** Set `status = Needs Update`, Slack `assigned_reviewer`.

### 7.12 Public sync (post-launch)
- **Trigger:** When `Tools.stage` changes to `Published` or `Gold Standard`.
- **Action:** Webhook → CMS/Supabase Edge Function, payload = record JSON incl. `public_url`.

---

## 8. Forms

### 8.1 Tool Submission Form (public)
Source: `Tools`. Public URL used on tl4s.com/submit.

Fields collected: `name` (R), `website_url` (R), `vendor` (R), `tagline` (R), `categories` (R — allow up to 3), `pricing_model` (R), `starting_price_usd` (O), `logo` (O), `screenshots` (O), submitter email (Q&A only). On submit: `stage = Detected`, `status = New`, `first_seen_at = TODAY()`.

### 8.2 Internal Evaluation Form
Source: `Evaluations`. Restricted to editorial collaborators.

Fields: `tool` (R), `plan_tested` (R), all 25 sub-ratings (R), `strengths`, `weaknesses`, `evidence_links`, `attachments`, `red_flags`, `verdict` (R), `time_spent_minutes`. On submit: `status = Completed`.

### 8.3 Collection Proposal Form
Source: `Collections`. Editors + guest curators.

Fields: `title` (R), `subtitle`, `theme` (R), `industries`, `tools` (R — min 5), `intro` (R). On submit: `status = Draft`.

### 8.4 Lab Proposal Form
Source: `Labs`. Researchers.

Fields: `title` (R), `hypothesis` (R), `methodology` (R), `tools_featured` (R — min 2). On submit: `status = Draft`.

---

## 9. Interfaces (build order)

1. **Editorial Cockpit** — kanban on `Tools.stage`, side panel with active `Evaluation`, one-click "Start Evaluation" button.
2. **Scoring Dashboard** — bar charts of `composite_score` by category, distribution of `trust_score`, leaderboard by verdict.
3. **Publishing Console** — Collections & Labs drafting, reorder linked tools via drag list, "Publish" button flipping `status`.
4. **Public Preview** — read-only view of Gold Standard tools with logo, scores, verdict; use as internal QA before CMS push.

---

## 10. Supabase Export Mapping

Every Airtable table maps 1:1 to a Postgres table. Linked-record fields become foreign keys or join tables.

| Airtable table | Supabase table | Notes |
|---|---|---|
| Tools | `tools` | Primary key: `slug`. Rollups become materialised view `tools_scores`. |
| Categories | `categories` | Self-join for `parent_slug`. |
| Use Cases | `use_cases` | |
| Industries | `industries` | |
| Evaluations | `evaluations` | `tool_slug` FK. Immutable via row-level policy. |
| Collections | `collections` | |
| Labs | `labs` | |
| Tool Stacks | `tool_stacks` | |
| Newsletter Mentions | `newsletter_mentions` | |

**Join tables (many-to-many):**
`tools_categories`, `tools_use_cases`, `tools_industries`, `tools_alternatives`, `collections_tools`, `collections_industries`, `labs_tools`, `stacks_tools`, `stacks_use_cases`.

**Score formulas** move from Airtable formula fields to Postgres generated columns or a `latest_evaluation` view — logic in §5 is portable verbatim.

---

## 11. Build Checklist

- [ ] Create base `AI-TL4S GENOME v1`.
- [ ] Create 9 tables in the order listed (linked tables need targets to already exist).
- [ ] Add every field per §2; set formulas from §5 and slug formulas from §2.
- [ ] Configure bidirectional link display names in `[brackets]`.
- [ ] Add all views per §4.
- [ ] Build 4 forms per §8.
- [ ] Wire 12 automations per §7. Enable each after dry-run on a copy of the base.
- [ ] Build the 4 interfaces in the order given.
- [ ] Seed: 60 Categories, 40 Industries, 200 Use Cases, 20 pilot Tools.
- [ ] Run 5 end-to-end evaluations to validate formulas.
- [ ] Snapshot base, export CSV per table for Supabase load test.

---

**End of blueprint.**
