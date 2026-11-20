export interface TrainedComplaintModel {
  version: string;
  algorithm: string;
  trainedAt: string;
  categories: string[];
  vocabulary: Record<string, number>; // term -> index
  idf: number[];
  weights: number[][]; // [numCategories][vocabSize]
  biases: number[]; // [numCategories]
  centroids: number[][]; // [numCategories][vocabSize] L2-normalized
}

export interface SparseVector {
  indices: number[];
  values: number[];
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'but', 'by',
  'for', 'from', 'had', 'has', 'have', 'he', 'her', 'his', 'i', 'if', 'in',
  'into', 'is', 'it', 'its', 'me', 'my', 'of', 'on', 'or', 'our', 'she',
  'so', 'that', 'the', 'their', 'them', 'there', 'these', 'they', 'this',
  'to', 'us', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'who',
  'will', 'with', 'you', 'your', 'very', 'still', 'just', 'get', 'got',
  'am', 'can', 'could', 'would', 'should', 'do', 'does', 'did',
  // Common Hinglish & Hindi filler particles (keep negations like nahi/नहीं/not/no!)
  'hai', 'hain', 'ho', 'tha', 'thi', 'the', 'ka', 'ki', 'ke', 'ko', 'se',
  'mein', 'me', 'par', 'pe', 'aur', 'ya', 'bhi', 'hi', 'kar', 'raha', 'rahi',
  'rahe', 'hua', 'hui', 'hue', 'kya', 'mera', 'meri', 'mere', 'humara',
  'है', 'हैं', 'हो', 'था', 'थी', 'थे', 'का', 'की', 'के', 'को', 'से',
  'में', 'पर', 'और', 'या', 'भी', 'ही', 'कर', 'रहा', 'रही', 'रहे',
  'हुआ', 'हुई', 'हुए', 'क्या', 'मेरा', 'मेरी', 'मेरे', 'हमारा',
]);

export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export function normalizeText(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isMeaningfulText(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const normalized = normalizeText(String(raw));
  if (!normalized) return false;
  const tokens = normalized.split(' ').filter((t) => t.length >= 1);
  return tokens.some((t) => t.length >= 2 || /[\u0900-\u097F]/.test(t));
}

export function extractTokens(raw: string): string[] {
  const normalized = normalizeText(raw);
  if (!normalized) return [];
  const words = normalized
    .split(' ')
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
  if (words.length === 0) return [];

  const tokens = [...words];
  for (let i = 0; i < words.length - 1; i++) {
    tokens.push(`${words[i]}_${words[i + 1]}`);
  }
  return tokens;
}

export function vectorizeWithVocabulary(
  text: string,
  vocabulary: Record<string, number>,
  idf: number[]
): { vector: Float64Array; nonZeroIndices: number[]; coverageRatio: number } {
  const vocabSize = idf.length;
  const vec = new Float64Array(vocabSize);
  const tokens = extractTokens(text);
  if (tokens.length === 0) {
    return { vector: vec, nonZeroIndices: [], coverageRatio: 0 };
  }

  const tf = new Map<number, number>();
  let matchedCount = 0;
  for (const tok of tokens) {
    const idx = vocabulary[tok];
    if (idx !== undefined) {
      tf.set(idx, (tf.get(idx) || 0) + 1);
      matchedCount++;
    }
  }

  let normSq = 0;
  const nonZeroIndices: number[] = [];
  for (const [idx, count] of tf.entries()) {
    const val = (1 + Math.log(count)) * idf[idx];
    vec[idx] = val;
    nonZeroIndices.push(idx);
    normSq += val * val;
  }

  if (normSq > 0) {
    const norm = Math.sqrt(normSq);
    for (const idx of nonZeroIndices) {
      vec[idx] /= norm;
    }
  }

  return {
    vector: vec,
    nonZeroIndices,
    coverageRatio: matchedCount / tokens.length,
  };
}

export function cosineSimilarityDense(
  a: Float64Array | number[],
  b: Float64Array | number[]
): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = a.length;
  for (let i = 0; i < len; i++) {
    const va = a[i];
    const vb = b[i];
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function sparseDotDense(sv: SparseVector, dense: Float64Array): number {
  let dot = 0;
  const { indices, values } = sv;
  for (let i = 0; i < indices.length; i++) {
    dot += values[i] * dense[indices[i]];
  }
  return dot;
}

function sparseCosine(a: SparseVector, b: SparseVector): number {
  let i = 0;
  let j = 0;
  let dot = 0;
  const ia = a.indices;
  const va = a.values;
  const ib = b.indices;
  const vb = b.values;
  while (i < ia.length && j < ib.length) {
    if (ia[i] === ib[j]) {
      dot += va[i] * vb[j];
      i++;
      j++;
    } else if (ia[i] < ib[j]) {
      i++;
    } else {
      j++;
    }
  }
  return dot; // Both sparse vectors are L2-normalized
}

export function softmax(logits: number[]): number[] {
  const maxLogit = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - maxLogit));
  const sum = exps.reduce((acc, v) => acc + v, 0);
  return exps.map((e) => e / (sum || 1));
}

export interface ClusterResult {
  clusterLabels: (string | null)[];
  discoveredGroups: {
    groupId: string;
    keywords: string[];
    size: number;
    avgSimilarity: number;
  }[];
}

function prepareSparseReviewVectors(reviewTexts: string[]) {
  const n = reviewTexts.length;
  const docTokens = reviewTexts.map((t) => extractTokens(t));
  const df = new Map<string, number>();

  for (const toks of docTokens) {
    const unique = new Set(toks);
    for (const tok of unique) {
      df.set(tok, (df.get(tok) || 0) + 1);
    }
  }

  // Cap vocabulary to top 1,500 recurring terms so clustering stays fast even on 3,000+ rows
  const MAX_VOCAB = 1500;
  const sortedTerms = Array.from(df.entries())
    .filter(([, count]) => n <= 20 || count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_VOCAB)
    .map(([term]) => term);

  const vocabTerms =
    sortedTerms.length > 0 ? sortedTerms : Array.from(df.keys()).slice(0, MAX_VOCAB);

  const vocabIndex = new Map<string, number>();
  vocabTerms.forEach((term, idx) => vocabIndex.set(term, idx));
  const dim = vocabTerms.length;

  const termWeights = vocabTerms.map((term) => {
    const docFreq = df.get(term) || 1;
    const base = 1 + Math.log((n + 2) / (docFreq + 1)) * 0.35;
    return docFreq >= 2 ? base * 1.45 : base * 0.75;
  });

  const sparseVectors: SparseVector[] = docTokens.map((toks) => {
    const counts = new Map<number, number>();
    for (const tok of toks) {
      const idx = vocabIndex.get(tok);
      if (idx !== undefined) {
        counts.set(idx, (counts.get(idx) || 0) + 1);
      }
    }
    const entries = Array.from(counts.entries()).sort((a, b) => a[0] - b[0]);
    const indices: number[] = [];
    const values: number[] = [];
    let normSq = 0;

    for (const [idx, c] of entries) {
      const val = (1 + Math.log(c)) * termWeights[idx];
      indices.push(idx);
      values.push(val);
      normSq += val * val;
    }

    if (normSq > 0) {
      const norm = Math.sqrt(normSq);
      for (let i = 0; i < values.length; i++) {
        values[i] /= norm;
      }
    }
    return { indices, values };
  });

  return { docTokens, vocabTerms, vocabIndex, dim, sparseVectors };
}

function finalizeDiscoveredClusters(
  n: number,
  minClusterSize: number,
  bestAssignments: number[],
  bestCentroids: Float64Array[],
  sparseVectors: SparseVector[],
  docTokens: string[][],
  vocabIndex: Map<string, number>
): ClusterResult {
  // Group indices by assigned cluster, pruning outliers below centroid similarity 0.25
  const groupsMap = new Map<number, number[]>();
  bestAssignments.forEach((c, idx) => {
    if (sparseVectors[idx].indices.length === 0) return;
    const centroidSim = bestCentroids[c]
      ? sparseDotDense(sparseVectors[idx], bestCentroids[c])
      : 1;
    if (centroidSim < 0.25) return;
    const list = groupsMap.get(c) || [];
    list.push(idx);
    groupsMap.set(c, list);
  });

  const clusterLabels: (string | null)[] = new Array(n).fill(null);
  const discoveredGroups: ClusterResult['discoveredGroups'] = [];
  let groupCounter = 1;

  for (const [, memberIndices] of groupsMap.entries()) {
    if (memberIndices.length < minClusterSize) continue;

    // Sample up to 30 members for fast bounded O(1) pairwise cohesion check
    const sampleLimit = Math.min(memberIndices.length, 30);
    const step = Math.max(1, Math.floor(memberIndices.length / sampleLimit));
    const sampled: number[] = [];
    for (let i = 0; i < memberIndices.length && sampled.length < sampleLimit; i += step) {
      sampled.push(memberIndices[i]);
    }

    let pairSum = 0;
    let pairCount = 0;
    for (let i = 0; i < sampled.length; i++) {
      for (let j = i + 1; j < sampled.length; j++) {
        pairSum += sparseCosine(sparseVectors[sampled[i]], sparseVectors[sampled[j]]);
        pairCount++;
      }
    }
    const avgPairwiseSim = pairCount > 0 ? pairSum / pairCount : 0;
    if (avgPairwiseSim < 0.18) continue;

    // Extract top descriptive unigram keywords for human-readable group label
    const termScores = new Map<string, number>();
    for (const idx of memberIndices) {
      const sv = sparseVectors[idx];
      const valueMap = new Map<number, number>();
      for (let p = 0; p < sv.indices.length; p++) {
        valueMap.set(sv.indices[p], sv.values[p]);
      }
      const toks = new Set(docTokens[idx].filter((t) => !t.includes('_')));
      for (const t of toks) {
        const vIdx = vocabIndex.get(t);
        if (vIdx !== undefined) {
          termScores.set(t, (termScores.get(t) || 0) + (valueMap.get(vIdx) || 0));
        }
      }
    }

    const topKeywords = Array.from(termScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([word]) => word);

    const keywordSummary =
      topKeywords.length > 0
        ? topKeywords.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
        : 'Emerging Issue';
    const groupLabel = `Candidate Group ${groupCounter}: ${keywordSummary}`;
    groupCounter++;

    for (const idx of memberIndices) {
      clusterLabels[idx] = groupLabel;
    }

    discoveredGroups.push({
      groupId: groupLabel,
      keywords: topKeywords,
      size: memberIndices.length,
      avgSimilarity: Number(avgPairwiseSim.toFixed(3)),
    });
  }

  return { clusterLabels, discoveredGroups };
}

function evaluateSimplifiedSilhouette(
  sparseVectors: SparseVector[],
  assignments: number[],
  centroids: Float64Array[],
  k: number
): number {
  const n = sparseVectors.length;
  if (k <= 1) {
    // Baseline cohesion relative to single centroid
    let simSum = 0;
    for (let i = 0; i < n; i++) {
      simSum += sparseDotDense(sparseVectors[i], centroids[0]);
    }
    return (simSum / n) * 0.4;
  }

  const clusterCounts = new Array<number>(k).fill(0);
  for (let i = 0; i < n; i++) clusterCounts[assignments[i]]++;

  let silSum = 0;
  for (let i = 0; i < n; i++) {
    const own = assignments[i];
    if (clusterCounts[own] <= 1) {
      // Singletons contribute 0 so splitting into singletons never wins
      continue;
    }
    const ownSim = sparseDotDense(sparseVectors[i], centroids[own]);
    const a = Math.max(0, 1 - ownSim);

    let b = Infinity;
    for (let c = 0; c < k; c++) {
      if (c === own || clusterCounts[c] === 0) continue;
      const dist = Math.max(0, 1 - sparseDotDense(sparseVectors[i], centroids[c]));
      if (dist < b) b = dist;
    }
    if (b === Infinity) continue;
    const denom = Math.max(a, b);
    silSum += denom > 0 ? (b - a) / denom : 0;
  }
  return silSum / n;
}

/**
 * Synchronous KMeans candidate group discovery (sparse O(N * K * nnz) fast path).
 */
export function discoverCandidateGroups(
  reviewTexts: string[],
  minClusterSize = 2
): ClusterResult {
  const n = reviewTexts.length;
  if (n < minClusterSize) {
    return { clusterLabels: new Array(n).fill(null), discoveredGroups: [] };
  }

  const { docTokens, vocabTerms, vocabIndex, dim, sparseVectors } =
    prepareSparseReviewVectors(reviewTexts);

  if (vocabTerms.length === 0) {
    return { clusterLabels: new Array(n).fill(null), discoveredGroups: [] };
  }

  const maxK = Math.min(8, Math.max(1, n - 1));
  let bestAssignments = new Array<number>(n).fill(0);
  let bestCentroids: Float64Array[] = [];
  let bestScore = -Infinity;

  for (let k = 1; k <= maxK; k++) {
    const { assignments, centroids } = runSparseSphericalKMeans(
      sparseVectors,
      k,
      dim,
      12
    );
    const score = evaluateSimplifiedSilhouette(
      sparseVectors,
      assignments,
      centroids,
      k
    );
    if (score > bestScore) {
      bestScore = score;
      bestAssignments = assignments;
      bestCentroids = centroids;
    }
  }

  return finalizeDiscoveredClusters(
    n,
    minClusterSize,
    bestAssignments,
    bestCentroids,
    sparseVectors,
    docTokens,
    vocabIndex
  );
}

/**
 * Event-loop-friendly async KMeans candidate group discovery for large datasets (~3,000+ rows).
 */
export async function discoverCandidateGroupsAsync(
  reviewTexts: string[],
  minClusterSize = 2
): Promise<ClusterResult> {
  const n = reviewTexts.length;
  if (n < minClusterSize) {
    return { clusterLabels: new Array(n).fill(null), discoveredGroups: [] };
  }

  const { docTokens, vocabTerms, vocabIndex, dim, sparseVectors } =
    prepareSparseReviewVectors(reviewTexts);

  if (vocabTerms.length === 0) {
    return { clusterLabels: new Array(n).fill(null), discoveredGroups: [] };
  }

  await yieldToEventLoop();

  const maxK = Math.min(8, Math.max(1, n - 1));
  let bestAssignments = new Array<number>(n).fill(0);
  let bestCentroids: Float64Array[] = [];
  let bestScore = -Infinity;

  for (let k = 1; k <= maxK; k++) {
    const { assignments, centroids } = runSparseSphericalKMeans(
      sparseVectors,
      k,
      dim,
      12
    );
    const score = evaluateSimplifiedSilhouette(
      sparseVectors,
      assignments,
      centroids,
      k
    );
    if (score > bestScore) {
      bestScore = score;
      bestAssignments = assignments;
      bestCentroids = centroids;
    }
    await yieldToEventLoop();
  }

  return finalizeDiscoveredClusters(
    n,
    minClusterSize,
    bestAssignments,
    bestCentroids,
    sparseVectors,
    docTokens,
    vocabIndex
  );
}

function runSparseSphericalKMeans(
  vectors: SparseVector[],
  k: number,
  dim: number,
  maxIter = 12
): { assignments: number[]; centroids: Float64Array[] } {
  const n = vectors.length;

  const toDense = (sv: SparseVector): Float64Array => {
    const d = new Float64Array(dim);
    for (let i = 0; i < sv.indices.length; i++) {
      d[sv.indices[i]] = sv.values[i];
    }
    return d;
  };

  // Pick first non-empty vector for deterministic seeding
  let seed0 = 0;
  for (let i = 0; i < n; i++) {
    if (vectors[i].indices.length > 0) {
      seed0 = i;
      break;
    }
  }
  const centroids: Float64Array[] = [toDense(vectors[seed0])];

  // Deterministic bounded farthest-first initialization (sample up to 250 points for O(1) seeding)
  const seedStep = Math.max(1, Math.floor(n / 250));
  while (centroids.length < k) {
    let bestIdx = seed0;
    let lowestMaxSim = Infinity;
    for (let i = 0; i < n; i += seedStep) {
      if (vectors[i].indices.length === 0) continue;
      let maxSim = -Infinity;
      for (const c of centroids) {
        const sim = sparseDotDense(vectors[i], c);
        if (sim > maxSim) maxSim = sim;
      }
      if (maxSim < lowestMaxSim) {
        lowestMaxSim = maxSim;
        bestIdx = i;
      }
    }
    centroids.push(toDense(vectors[bestIdx]));
  }

  let assignments = new Array<number>(n).fill(0);

  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    const nextAssignments = new Array<number>(n);

    for (let i = 0; i < n; i++) {
      const sv = vectors[i];
      let bestCluster = 0;
      let bestSim = -Infinity;
      for (let c = 0; c < k; c++) {
        const sim = sparseDotDense(sv, centroids[c]);
        if (sim > bestSim) {
          bestSim = sim;
          bestCluster = c;
        }
      }
      nextAssignments[i] = bestCluster;
      if (nextAssignments[i] !== assignments[i]) {
        changed = true;
      }
    }

    assignments = nextAssignments;
    if (!changed && iter > 0) break;

    // Recompute L2-normalized centroids using sparse accumulation
    const sums = Array.from({ length: k }, () => new Float64Array(dim));
    const counts = new Array<number>(k).fill(0);
    for (let i = 0; i < n; i++) {
      const c = assignments[i];
      counts[c]++;
      const sv = vectors[i];
      const target = sums[c];
      for (let p = 0; p < sv.indices.length; p++) {
        target[sv.indices[p]] += sv.values[p];
      }
    }

    for (let c = 0; c < k; c++) {
      if (counts[c] === 0) continue;
      const sumVec = sums[c];
      let normSq = 0;
      for (let d = 0; d < dim; d++) {
        const v = sumVec[d];
        if (v !== 0) normSq += v * v;
      }
      const norm = Math.sqrt(normSq);
      if (norm > 0) {
        for (let d = 0; d < dim; d++) {
          centroids[c][d] = sumVec[d] / norm;
        }
      }
    }
  }

  return { assignments, centroids };
}
