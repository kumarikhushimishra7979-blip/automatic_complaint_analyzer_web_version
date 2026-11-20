# Automatic Customer Complaint Analysis System

A complete, secure, full-stack web application for automated organizational customer complaint classification, low-confidence review flagging, emerging complaint group discovery (KMeans clustering + cosine similarity), analytical visualization, and Excel/PDF reporting.

## Main Features

- **User Authentication & Multi-User Isolation**: Registration, password strength enforcement, bcrypt password hashing, JWT authentication, and strict user-level ownership for datasets, analyses, and reports.
- **Dataset Management & Preview**: Upload `.csv` and `.xlsx` datasets with file magic-byte verification, path-traversal protection, 10-row streaming preview, and mandatory/optional column mapping.
- **Local ML Classification**: Uses a locally stored TF-IDF + Multinomial Logistic Regression + Cosine Similarity calibrated model (`server/ml/models/trained_model.json`) with configurable confidence threshold (`0.40` default) and zero external AI API calls.
- **Potential New Complaint Group Discovery**: Automatically clusters low-confidence (`Review`) complaints using spherical KMeans and cosine similarity cohesion checks to surface emerging complaint themes for human review.
- **Analytical Dashboard & Statistics**: Real-time progress polling, database-driven category summaries (excluding empty descriptions from percentages), distribution charts, and paginated/filterable result inspection.
- **Excel & PDF Reporting**: Multi-worksheet Excel (`.xlsx`) reports with formula-injection protection, frozen headers, and filters; Landscape PDF (`.pdf`) reports with summary metrics, embedded vector horizontal bar charts, repeated table headers, and page numbers.

## Technology Stack

- **Frontend**: React 19, Vite, Tailwind CSS, Axios, React Router DOM, Lucide React
- **Backend**: Node.js (v22+), Express, TypeScript (`tsx`), JWT (`jsonwebtoken`), `bcryptjs`, `multer`, `csv-parse`, `xlsx`, `exceljs`, `pdfkit`
- **Database**: SQLite (`node:sqlite`) with versioned SQL migrations (`schema_migrations`), foreign keys, and indexes

## Prerequisites

- Node.js v22 or higher
- npm

## Installation & Local Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure environment variables:
   ```bash
   cp .env.example .env
   ```
   Set a strong random `JWT_SECRET` in `.env` before running in shared or production environments.
3. Verify the trained ML model artifact exists at `server/ml/models/trained_model.json` (or regenerate it with `npx tsx server/ml/train_initial_model.ts`).
4. Start the development server on port 3000:
   ```bash
   npm run dev
   ```
5. Open `http://localhost:3000` in your browser.

## Running Tests & Verification

```bash
# Run backend & ML unit/integration tests
npm test

# Type-check TypeScript
npm run lint

# Build production frontend bundle
npm run build
```

## Documentation

- [User Manual](docs/user_manual.md)
- [Deployment Manual](docs/deployment_manual.md)
- [System Architecture](docs/system_architecture.md)
- [API Documentation](docs/api_documentation.md)
- [Database Documentation](docs/database_documentation.md)

## Known Limitations

- Background analysis tasks execute asynchronously inside the Node.js process (`setImmediate`); restarting the server mid-job marks interrupted jobs cleanly only if retried by the user.
- For large multi-node deployments, replacing the local SQLite database with a centralized RDBMS and dedicated worker queue is recommended.
