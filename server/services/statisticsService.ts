import { getDb } from '../database.ts';

export interface DashboardSummary {
  total_datasets: number;
  total_complaints_uploaded: number;
  completed_analyses: number;
  available_reports: number;
  processing_analyses: number;
  failed_analyses: number;
  recent_datasets: {
    id: number;
    filename: string;
    total_rows: number;
    uploaded_at: string;
    file_format: string;
    complaint_column: string | null;
  }[];
}

export interface AnalysisStatistics {
  analysis_id: number;
  dataset_id: number;
  dataset_name: string;
  analysis_status: string;
  confidence_threshold: number;
  total_complaints: number;
  classified_count: number;
  review_count: number;
  empty_count: number;
  eligible_complaints: number;
  predicted_categories_count: number;
  candidate_groups_count: number;
  top3_categories_count: number;
  top3_categories_share: number;
  percentage_denominator_note: string;
  category_summary: {
    rank: number;
    category: string;
    count: number;
    percentage: number;
  }[];
  status_distribution: {
    status: string;
    count: number;
    percentage: number;
  }[];
  review_distribution: {
    label: string;
    count: number;
    percentage: number;
  }[];
  candidate_groups: {
    group_name: string;
    count: number;
    sample_complaints: string[];
  }[];
}

export function getDashboardSummary(userId: number): DashboardSummary {
  const db = getDb();

  const datasetAgg = db
    .prepare(
      `SELECT COUNT(*) as total_datasets, COALESCE(SUM(total_rows), 0) as total_rows
       FROM datasets WHERE user_id = ?`
    )
    .get(userId) as { total_datasets: number; total_rows: number };

  const completedAgg = db
    .prepare(
      `SELECT COUNT(*) as cnt FROM analyses WHERE user_id = ? AND analysis_status = 'Completed'`
    )
    .get(userId) as { cnt: number };

  const processingAgg = db
    .prepare(
      `SELECT COUNT(*) as cnt FROM analyses WHERE user_id = ? AND analysis_status IN ('Pending', 'Processing')`
    )
    .get(userId) as { cnt: number };

  const failedAgg = db
    .prepare(
      `SELECT COUNT(*) as cnt FROM analyses WHERE user_id = ? AND analysis_status = 'Failed'`
    )
    .get(userId) as { cnt: number };

  const recentDatasets = db
    .prepare(
      `SELECT id, filename, total_rows, uploaded_at, file_format, complaint_column
       FROM datasets
       WHERE user_id = ?
       ORDER BY datetime(uploaded_at) DESC, id DESC
       LIMIT 5`
    )
    .all(userId) as DashboardSummary['recent_datasets'];

  return {
    total_datasets: Number(datasetAgg?.total_datasets || 0),
    total_complaints_uploaded: Number(datasetAgg?.total_rows || 0),
    completed_analyses: Number(completedAgg?.cnt || 0),
    available_reports: Number(completedAgg?.cnt || 0),
    processing_analyses: Number(processingAgg?.cnt || 0),
    failed_analyses: Number(failedAgg?.cnt || 0),
    recent_datasets: recentDatasets,
  };
}

export function getAnalysisStatistics(
  userId: number,
  analysisId: number
): AnalysisStatistics | null {
  const db = getDb();
  const analysis = db
    .prepare(
      `SELECT a.id, a.dataset_id, a.analysis_status, a.confidence_threshold,
              d.filename as dataset_name
       FROM analyses a
       JOIN datasets d ON d.id = a.dataset_id
       WHERE a.id = ? AND a.user_id = ?`
    )
    .get(analysisId, userId) as
    | {
        id: number;
        dataset_id: number;
        analysis_status: string;
        confidence_threshold: number;
        dataset_name: string;
      }
    | undefined;

  if (!analysis) return null;

  const counts = db
    .prepare(
      `SELECT
         COUNT(*) as total_complaints,
         SUM(CASE WHEN classification_status = 'Classified' THEN 1 ELSE 0 END) as classified_count,
         SUM(CASE WHEN classification_status = 'Review' THEN 1 ELSE 0 END) as review_count,
         SUM(CASE WHEN classification_status = 'Empty Text' THEN 1 ELSE 0 END) as empty_count
       FROM complaint_results
       WHERE analysis_id = ?`
    )
    .get(analysisId) as {
    total_complaints: number;
    classified_count: number;
    review_count: number;
    empty_count: number;
  };

  const totalComplaints = Number(counts?.total_complaints || 0);
  const classifiedCount = Number(counts?.classified_count || 0);
  const reviewCount = Number(counts?.review_count || 0);
  const emptyCount = Number(counts?.empty_count || 0);
  const eligibleComplaints = Math.max(0, totalComplaints - emptyCount);

  // Category-wise summary excludes Empty Text rows; denominator is total eligible (non-empty) complaints
  const categoryRows = db
    .prepare(
      `SELECT predicted_category as category, COUNT(*) as count
       FROM complaint_results
       WHERE analysis_id = ?
         AND classification_status != 'Empty Text'
         AND predicted_category IS NOT NULL
       GROUP BY predicted_category
       ORDER BY count DESC, predicted_category ASC`
    )
    .all(analysisId) as { category: string; count: number }[];

  const categorySummary = categoryRows.map((r, idx) => ({
    rank: idx + 1,
    category: r.category,
    count: Number(r.count),
    percentage:
      eligibleComplaints > 0
        ? Number(((Number(r.count) / eligibleComplaints) * 100).toFixed(2))
        : 0,
  }));

  const top3CategoriesCount = categorySummary
    .slice(0, 3)
    .reduce((acc, item) => acc + item.count, 0);
  const top3CategoriesShare =
    eligibleComplaints > 0
      ? Number(((top3CategoriesCount / eligibleComplaints) * 100).toFixed(2))
      : 0;

  const statusDistribution = [
    {
      status: 'Classified',
      count: classifiedCount,
      percentage:
        totalComplaints > 0
          ? Number(((classifiedCount / totalComplaints) * 100).toFixed(2))
          : 0,
    },
    {
      status: 'Review',
      count: reviewCount,
      percentage:
        totalComplaints > 0
          ? Number(((reviewCount / totalComplaints) * 100).toFixed(2))
          : 0,
    },
    {
      status: 'Empty Text',
      count: emptyCount,
      percentage:
        totalComplaints > 0
          ? Number(((emptyCount / totalComplaints) * 100).toFixed(2))
          : 0,
    },
  ];

  const nonReviewEligible = Math.max(0, eligibleComplaints - reviewCount);
  const reviewDistribution = [
    {
      label: 'Confident Prediction (No Review)',
      count: nonReviewEligible,
      percentage:
        eligibleComplaints > 0
          ? Number(((nonReviewEligible / eligibleComplaints) * 100).toFixed(2))
          : 0,
    },
    {
      label: 'Manual Review Required',
      count: reviewCount,
      percentage:
        eligibleComplaints > 0
          ? Number(((reviewCount / eligibleComplaints) * 100).toFixed(2))
          : 0,
    },
  ];

  const groupRows = db
    .prepare(
      `SELECT candidate_group as group_name, COUNT(*) as count
       FROM complaint_results
       WHERE analysis_id = ? AND candidate_group IS NOT NULL AND candidate_group != ''
       GROUP BY candidate_group
       ORDER BY count DESC, candidate_group ASC`
    )
    .all(analysisId) as { group_name: string; count: number }[];

  const sampleStmt = db.prepare(
    `SELECT complaint_text FROM complaint_results
     WHERE analysis_id = ? AND candidate_group = ?
     ORDER BY row_index ASC
     LIMIT 3`
  );

  const candidateGroups = groupRows.map((g) => {
    const samples = sampleStmt.all(analysisId, g.group_name) as {
      complaint_text: string;
    }[];
    return {
      group_name: g.group_name,
      count: Number(g.count),
      sample_complaints: samples.map((s) => s.complaint_text),
    };
  });

  return {
    analysis_id: analysis.id,
    dataset_id: analysis.dataset_id,
    dataset_name: analysis.dataset_name,
    analysis_status: analysis.analysis_status,
    confidence_threshold: analysis.confidence_threshold,
    total_complaints: totalComplaints,
    classified_count: classifiedCount,
    review_count: reviewCount,
    empty_count: emptyCount,
    eligible_complaints: eligibleComplaints,
    predicted_categories_count: categorySummary.length,
    candidate_groups_count: candidateGroups.length,
    top3_categories_count: top3CategoriesCount,
    top3_categories_share: top3CategoriesShare,
    percentage_denominator_note: `Percentages are calculated over ${eligibleComplaints} eligible non-empty complaints (excluding ${emptyCount} empty text rows).`,
    category_summary: categorySummary,
    status_distribution: statusDistribution,
    review_distribution: reviewDistribution,
    candidate_groups: candidateGroups,
  };
}
