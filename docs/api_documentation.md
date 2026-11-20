# API Documentation

All endpoints are prefixed with `/api`. Protected endpoints require `Authorization: Bearer <access_token>`.

## Health
- `GET /api/health` (Public) — Returns `{ status: "ok", service, timestamp }`.

## Authentication (`/api/auth`)
- `POST /api/auth/register` (Public) — Body: `{ username, email, password, confirm_password }`. Returns `201` with `{ access_token, token_type, user }`.
- `POST /api/auth/login` (Public) — Body: `{ email, password }`. Returns `200` with `{ access_token, token_type, user }`.
- `GET /api/auth/me` (Protected) — Returns authenticated user profile.
- `PUT /api/auth/password` (Protected) — Body: `{ current_password, new_password, confirm_password }`.

## Dashboard
- `GET /api/dashboard/summary` (Protected) — Returns real database counts (`total_datasets`, `total_complaints_uploaded`, `completed_analyses`, `available_reports`, `processing_analyses`, `failed_analyses`, `recent_datasets`).

## Datasets (`/api/datasets`)
- `POST /api/datasets/upload` (Protected, `multipart/form-data` field `file`) — Validates `.csv`/`.xlsx` extension and file content, stores securely, returns `201` with `{ dataset, headers }`.
- `POST /api/datasets/import-sample` (Protected) — Imports the built-in sample complaint dataset for the authenticated user.
- `GET /api/datasets` (Protected) — Lists datasets owned by the authenticated user.
- `GET /api/datasets/{datasetId}` (Protected) — Returns dataset metadata (`404` if not owned by user).
- `GET /api/datasets/{datasetId}/preview` (Protected) — Returns `{ dataset, headers, total_rows, rows }` (first 10 rows).
- `PUT /api/datasets/{datasetId}/columns` (Protected) — Body: `{ complaint_column, category_column? }`. Validates columns against file headers.
- `DELETE /api/datasets/{datasetId}` (Protected) — Safely deletes dataset and file when no active analysis is running.

## Analyses (`/api/analyses`)
- `POST /api/analyses/{datasetId}/run` (Protected) — Body: `{ confidence_threshold? }`. Starts background batch classification + KMeans clustering (`202 Accepted`). Rejects duplicate active runs (`409`).
- `GET /api/analyses` (Protected) — Query: `page`, `page_size`. Returns paginated analysis history.
- `GET /api/analyses/{analysisId}` (Protected) — Returns analysis metadata.
- `GET /api/analyses/{analysisId}/progress` (Protected) — Returns `{ analysis_id, analysis_status, total_complaints, processed_complaints, progress_percent, error_message }`.
- `GET /api/analyses/{analysisId}/results` (Protected) — Query: `page`, `page_size`, `search`, `category`, `status`, `needs_review`, `candidate_group`. Returns paginated results.
- `GET /api/analyses/{analysisId}/statistics` (Protected) — Returns summary counts, `category_summary`, `status_distribution`, `review_distribution`, `candidate_groups`, and denominator note.

## Reports (`/api/reports`)
- `GET /api/reports/{analysisId}/excel` (Protected) — Downloads `.xlsx` workbook (completed analyses only).
- `GET /api/reports/{analysisId}/pdf` (Protected) — Downloads `.pdf` landscape report (completed analyses only).
