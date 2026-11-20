import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import { config } from './config.ts';

let dbInstance: DatabaseSync | null = null;

interface Migration {
  version: string;
  description: string;
  up: (db: DatabaseSync) => void;
}

const MIGRATIONS: Migration[] = [
  {
    version: '001_initial_schema',
    description:
      'Create users, datasets, analyses, complaint_results, and categories tables with indexes',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL,
          email TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

        CREATE TABLE IF NOT EXISTS datasets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          filename TEXT NOT NULL,
          original_filename TEXT NOT NULL,
          file_format TEXT NOT NULL,
          file_size INTEGER NOT NULL DEFAULT 0,
          storage_path TEXT NOT NULL,
          total_rows INTEGER NOT NULL DEFAULT 0,
          uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
          complaint_column TEXT,
          category_column TEXT,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_datasets_user_id ON datasets(user_id);
        CREATE INDEX IF NOT EXISTS idx_datasets_uploaded_at ON datasets(uploaded_at);

        CREATE TABLE IF NOT EXISTS analyses (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          dataset_id INTEGER NOT NULL,
          analysis_status TEXT NOT NULL DEFAULT 'Pending',
          total_complaints INTEGER NOT NULL DEFAULT 0,
          processed_complaints INTEGER NOT NULL DEFAULT 0,
          progress_percent REAL NOT NULL DEFAULT 0,
          confidence_threshold REAL NOT NULL DEFAULT 0.40,
          error_message TEXT,
          started_at TEXT NOT NULL DEFAULT (datetime('now')),
          completed_at TEXT,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (dataset_id) REFERENCES datasets(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_analyses_user_id ON analyses(user_id);
        CREATE INDEX IF NOT EXISTS idx_analyses_dataset_id ON analyses(dataset_id);
        CREATE INDEX IF NOT EXISTS idx_analyses_status ON analyses(analysis_status);

        CREATE TABLE IF NOT EXISTS complaint_results (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          analysis_id INTEGER NOT NULL,
          row_index INTEGER NOT NULL,
          complaint_text TEXT NOT NULL,
          existing_category TEXT,
          predicted_category TEXT,
          confidence_score REAL NOT NULL DEFAULT 0,
          classification_status TEXT NOT NULL,
          needs_review INTEGER NOT NULL DEFAULT 0,
          candidate_group TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (analysis_id) REFERENCES analyses(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_results_analysis_id ON complaint_results(analysis_id);
        CREATE INDEX IF NOT EXISTS idx_results_predicted_category ON complaint_results(predicted_category);
        CREATE INDEX IF NOT EXISTS idx_results_status ON complaint_results(classification_status);
        CREATE INDEX IF NOT EXISTS idx_results_candidate_group ON complaint_results(candidate_group);

        CREATE TABLE IF NOT EXISTS categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          description TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    },
  },
  {
    version: '002_seed_model_categories',
    description: 'Seed default enterprise complaint categories used by ML model',
    up: (db) => {
      const defaults = [
        ['Billing & Payments', 'Invoice errors, duplicate charges, refund delays, and payment failures'],
        ['Network & Connectivity', 'Service outages, dropped connections, slow speeds, and signal loss'],
        ['Delivery & Logistics', 'Late shipments, missing packages, damaged deliveries, and courier delays'],
        ['Customer Support', 'Unresolved tickets, hold times, callback failures, and support quality'],
        ['Account & Access', 'Login failures, locked accounts, password resets, and profile errors'],
        ['Product Defect', 'Damaged items, malfunctioning hardware, manufacturing flaws, and wear'],
        ['Subscription & Cancellation', 'Cancellation disputes, auto-renewal issues, plan changes, and fees'],
      ];
      const stmt = db.prepare(
        'INSERT OR IGNORE INTO categories (name, description) VALUES (?, ?)'
      );
      for (const [name, desc] of defaults) {
        stmt.run(name, desc);
      }
    },
  },
  {
    version: '003_seed_utility_categories',
    description: 'Seed 14 multilingual electricity & smart-meter complaint categories',
    up: (db) => {
      const utilityCategories = [
        ['Power supply interruption / meter powered but home disconnected', 'Power cuts, no light, pole/wire/transformer faults, or supply disconnected while meter powered'],
        ['Recharge/payment made but balance not updated', 'UPI or online recharge deducted but balance not credited to smart meter'],
        ['Unexpected / excess / wrong deduction or billing charges', 'High daily deduction, wrong arrear deduction, penalties, or excess charges'],
        ['App login / registration / app data / usage display', 'OTP issues, consumer number linking, app errors, or missing usage/balance data'],
        ['Meter damaged / faulty / display / blank / not working', 'Burnt/damaged meter, blank display screen, broken MCB or meter seal'],
        ['Bill generation / high bill / billing correction', 'High or average bills, missing bill generation, or billing rectification requests'],
        ['Meter not communicating', 'Offline smart meter, RF/network signal issues, or telemetry sync failure'],
        ['SMS / bill message / notification not received', 'Missing recharge alerts, low balance warnings, or bill SMS notifications'],
        ['Meter reading / consumption / deduction not happening', 'Frozen reading, zero consumption, or units/balance not deducting'],
        ['Load change / load increase or decrease', 'Sanctioned load increase or decrease (KW) applications'],
        ['Meter shifting / seal / replacement / wrong meter', 'Meter relocation, new installation, replacement, or wrong meter mapping'],
        ['Free electricity / subsidy / free units', 'Free unit schemes (e.g., 125 units) and government electricity subsidy issues'],
        ['Previous payment/arrears/incorrect payment adjustment', 'Old arrears mismatch and unadjusted previous payments'],
        ['Other / unclear / incomplete', 'Unclear, incomplete, or IVRS-only complaint entries'],
      ];
      const stmt = db.prepare(
        'INSERT OR IGNORE INTO categories (name, description) VALUES (?, ?)'
      );
      for (const [name, desc] of utilityCategories) {
        stmt.run(name, desc);
      }
    },
  },
];

export function initDatabase(customPath?: string): DatabaseSync {
  const targetPath = customPath || config.databasePath;
  if (targetPath !== ':memory:') {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  }
  const db = new DatabaseSync(targetPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const appliedStmt = db.prepare('SELECT version FROM schema_migrations WHERE version = ?');
  const insertMigration = db.prepare(
    'INSERT INTO schema_migrations (version, description) VALUES (?, ?)'
  );

  for (const migration of MIGRATIONS) {
    const existing = appliedStmt.get(migration.version);
    if (!existing) {
      db.exec('BEGIN TRANSACTION;');
      try {
        migration.up(db);
        insertMigration.run(migration.version, migration.description);
        db.exec('COMMIT;');
      } catch (err) {
        db.exec('ROLLBACK;');
        throw err;
      }
    }
  }

  // Recover any analyses left in Pending/Processing state from an interrupted server run
  db.prepare(
    `UPDATE analyses
     SET analysis_status = 'Failed',
         error_message = 'Interrupted by server restart',
         completed_at = COALESCE(completed_at, datetime('now'))
     WHERE analysis_status IN ('Pending', 'Processing')`
  ).run();

  dbInstance = db;
  return db;
}

export function getDb(): DatabaseSync {
  if (!dbInstance) {
    return initDatabase();
  }
  return dbInstance;
}

export function setDbForTesting(db: DatabaseSync): void {
  dbInstance = db;
}
