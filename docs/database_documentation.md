# Database Documentation

The application uses a relational SQLite database (`node:sqlite`) configured with `PRAGMA foreign_keys = ON` and `PRAGMA journal_mode = WAL`, managed through versioned automatic migrations (`schema_migrations`).

## Tables

### 1. `users`
- `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
- `username` (TEXT NOT NULL)
- `email` (TEXT NOT NULL UNIQUE) — Indexed via `idx_users_email`
- `password_hash` (TEXT NOT NULL)
- `is_active` (INTEGER NOT NULL DEFAULT 1)
- `created_at` (TEXT NOT NULL)

### 2. `datasets`
- `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
- `user_id` (INTEGER NOT NULL, FK -> `users.id` ON DELETE CASCADE) — Indexed via `idx_datasets_user_id`
- `filename`, `original_filename`, `file_format`, `file_size`, `storage_path`, `total_rows`
- `uploaded_at` (TEXT NOT NULL) — Indexed via `idx_datasets_uploaded_at`
- `complaint_column` (TEXT), `category_column` (TEXT)

### 3. `analyses`
- `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
- `user_id` (INTEGER NOT NULL, FK -> `users.id` ON DELETE CASCADE) — Indexed via `idx_analyses_user_id`
- `dataset_id` (INTEGER NOT NULL, FK -> `datasets.id` ON DELETE CASCADE) — Indexed via `idx_analyses_dataset_id`
- `analysis_status` (`Pending` | `Processing` | `Completed` | `Failed`) — Indexed via `idx_analyses_status`
- `total_complaints`, `processed_complaints`, `progress_percent`, `confidence_threshold`, `error_message`
- `started_at`, `completed_at`

### 4. `complaint_results`
- `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
- `analysis_id` (INTEGER NOT NULL, FK -> `analyses.id` ON DELETE CASCADE) — Indexed via `idx_results_analysis_id`
- `row_index` (INTEGER NOT NULL)
- `complaint_text` (TEXT NOT NULL)
- `existing_category` (TEXT)
- `predicted_category` (TEXT) — Indexed via `idx_results_predicted_category`
- `confidence_score` (REAL NOT NULL DEFAULT 0)
- `classification_status` (`Classified` | `Review` | `Empty Text`) — Indexed via `idx_results_status`
- `needs_review` (INTEGER NOT NULL DEFAULT 0)
- `candidate_group` (TEXT) — Indexed via `idx_results_candidate_group`
- `created_at` (TEXT NOT NULL)

### 5. `categories`
- `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
- `name` (TEXT NOT NULL UNIQUE)
- `description` (TEXT)
- `created_at` (TEXT NOT NULL)
