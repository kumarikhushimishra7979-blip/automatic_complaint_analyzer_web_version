# System Architecture — Automatic Customer Complaint Analysis System

## 1. High-Level Overview
```
┌───────────────────────────┐         HTTPS / JSON / Blob        ┌──────────────────────────────┐
│  React + Vite Frontend    │ ◄────────────────────────────────► │  Express REST API (/api/*)   │
│  (AppLayout, Pages, Auth) │     JWT Bearer Authentication      │  (Auth, Datasets, Analyses)  │
└───────────────────────────┘                                    └──────────────┬───────────────┘
                                                                                │
                              ┌─────────────────────────┬───────────────────────┼────────────────────┐
                              ▼                         ▼                       ▼                    ▼
                    ┌──────────────────┐     ┌───────────────────┐   ┌──────────────────┐  ┌──────────────────┐
                    │ SQLite Database  │     │ Local File Store  │   │ Local ML Engine  │  │ Report Generator │
                    │ (WAL + Foreign   │     │ (Per-user sandbox │   │ (TF-IDF + LR +   │  │ (ExcelJS &       │
                    │  Keys + Indexes) │     │  path traversal   │   │  Cosine + KMeans)│  │  PDFKit Vector)  │
                    └──────────────────┘     │  protected)       │   └──────────────────┘  └──────────────────┘
                                             └───────────────────┘
```

## 2. Frontend Architecture (`src/`)
- **Routing**: `react-router-dom` with `ProtectedRoute` and `PublicOnlyRoute` guards.
- **Shared Application Shell (`AppLayout.tsx`)**: Persistent dark-navy sidebar (`#0F172A`), mobile drawer, breadcrumb top bar, and `<Outlet />`.
- **API Communication (`services/api.ts`)**: Centralized Axios client attaching JWT Bearer tokens and clearing expired sessions automatically on `401`.

## 3. Backend Architecture (`server/` & `server.ts`)
- **Routes (`server/routes/`)**: Thin HTTP controllers validating inputs and delegating to services.
- **Services (`server/services/`)**: Business logic for dataset inspection/configuration, batch analysis orchestration, and SQLite-backed statistics.
- **Security (`server/security.ts` & `server/utils/fileUtils.ts`)**: `bcryptjs` password hashing, signed JWTs, strict `user_id` ownership filtering on every query, magic-byte file validation, path traversal assertions, and Excel formula-injection neutralization.

## 4. ML Inference & Candidate Group Discovery (`server/ml/`)
1. **Model Loading (`modelLoader.ts`)**: Loads and caches `server/ml/models/trained_model.json` once in memory.
2. **Batch Classification (`mlService.ts`)**: Streams dataset rows in batches of 100. Empty/non-alphanumeric descriptions receive `Empty Text`. Non-empty descriptions are vectorized with the trained TF-IDF vocabulary, scored by Multinomial Logistic Regression, and calibrated via class-centroid cosine similarity.
3. **Review Thresholding**: Scores below `0.40` (configurable) are flagged `Review` (`needs_review = 1`).
4. **Candidate Group Discovery (`modeling.ts`)**: All `Review` complaints in an analysis are embedded into a fresh subset TF-IDF space and clustered using spherical KMeans. Clusters meeting `MIN_CLUSTER_SIZE` and intra-cluster cosine similarity thresholds receive `Candidate Group N: <Keywords>` labels as human-verification suggestions.

## 5. Report Generation (`server/reporting/reportService.ts`)
- **Excel (`.xlsx`)**: Built via `exceljs` with three worksheets (`Complaint Results`, `Category Summary`, `Report Information`), frozen header rows, auto-filters, and formula-injection escaping.
- **PDF (`.pdf`)**: Built via `pdfkit` in landscape A4 layout with summary KPI cards, category table, vector horizontal bar chart, repeated table headers, wrapped descriptions, and page numbers.
