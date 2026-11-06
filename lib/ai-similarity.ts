/**
 * Local text similarity for tickets: TF-IDF vectors compared by cosine, with a
 * small bonus for a shared category or service. Pure and dependency-free, so it
 * runs under the privacy gate (nothing leaves the box) and is unit-testable.
 *
 * `focus` is the text that carries the meaning (a ticket's title, or a
 * resolution note) and counts {@link FOCUS_WEIGHT} times as much as `context`.
 */

export type SimilarityDoc = {
  id: number;
  focus: string;
  context: string;
  categoryId?: string | null;
  serviceId?: string | null;
};

export type SimilarityMatch = {
  id: number;
  /** 0..1 */
  score: number;
  /** Terms both texts share, most significant first. */
  sharedTerms: string[];
  sameCategory: boolean;
  sameService: boolean;
};

export type SimilarityCluster = {
  /** Lowest ticket id in the cluster; every other member is similar to it. */
  seedId: number;
  ticketIds: number[];
  /** Terms most members share, most common first. */
  sharedTerms: string[];
};

const FOCUS_WEIGHT = 3;
const MAX_CONTEXT_CHARS = 2000;
const MIN_TERM_LENGTH = 3;
/** Added to the text score per shared category / service, only when the texts already overlap. */
const CONTEXT_BONUS = 0.05;
const MAX_SHARED_TERMS = 5;

const STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "can", "has", "have", "had", "was", "were", "will",
  "with", "this", "that", "from", "they", "been", "your", "our", "when", "what", "which", "who", "how", "why",
  "its", "any", "also", "just", "than", "then", "there", "their", "them", "into", "out", "over", "about",
  "please", "thanks", "thank", "hello", "hi", "dear", "regards", "hallo", "danke", "bitte", "und", "der",
  "die", "das", "ist", "nicht", "ich", "wir", "mit", "von", "für", "auf", "den", "dem", "ein", "eine", "kann",
  "habe", "haben", "wird", "wurde", "sind", "bei", "aber", "oder", "sich", "noch", "auch", "nach",
]);

/** Folds simple plurals and "-ing" so "logins" and "login" (or "failing" and "fail") meet. */
function stem(term: string): string {
  if (term.length > 4 && term.endsWith("ies")) return `${term.slice(0, -3)}y`;
  if (term.length > 3 && term.endsWith("s") && !/(ss|us|is)$/.test(term)) return term.slice(0, -1);
  if (term.length > 6 && term.endsWith("ing")) return term.slice(0, -3);
  return term;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= MIN_TERM_LENGTH && !STOPWORDS.has(t))
    .map(stem);
}

type Vector = {
  id: number;
  weights: Map<string, number>;
  norm: number;
  categoryId: string | null;
  serviceId: string | null;
};

function termCounts(doc: SimilarityDoc): Map<string, number> {
  const counts = new Map<string, number>();
  for (const term of tokenize(doc.focus)) counts.set(term, (counts.get(term) ?? 0) + FOCUS_WEIGHT);
  for (const term of tokenize(doc.context.slice(0, MAX_CONTEXT_CHARS))) counts.set(term, (counts.get(term) ?? 0) + 1);
  return counts;
}

function buildVectors(docs: readonly SimilarityDoc[]): Vector[] {
  const counted = docs.map((doc) => ({ doc, counts: termCounts(doc) }));
  const docFrequency = new Map<string, number>();
  for (const { counts } of counted) {
    for (const term of counts.keys()) docFrequency.set(term, (docFrequency.get(term) ?? 0) + 1);
  }
  return counted.map(({ doc, counts }) => {
    const weights = new Map<string, number>();
    let squares = 0;
    for (const [term, count] of counts) {
      const idf = Math.log((docs.length + 1) / ((docFrequency.get(term) ?? 0) + 1)) + 1;
      const weight = (1 + Math.log(count)) * idf;
      weights.set(term, weight);
      squares += weight * weight;
    }
    return {
      id: doc.id,
      weights,
      norm: Math.sqrt(squares),
      categoryId: doc.categoryId ?? null,
      serviceId: doc.serviceId ?? null,
    };
  });
}

function compare(a: Vector, b: Vector): SimilarityMatch {
  const [small, large] = a.weights.size <= b.weights.size ? [a.weights, b.weights] : [b.weights, a.weights];
  let dot = 0;
  const shared: { term: string; weight: number }[] = [];
  for (const [term, weight] of small) {
    const other = large.get(term);
    if (other === undefined) continue;
    dot += weight * other;
    shared.push({ term, weight: weight * other });
  }
  const sameCategory = a.categoryId !== null && a.categoryId === b.categoryId;
  const sameService = a.serviceId !== null && a.serviceId === b.serviceId;
  const textScore = a.norm === 0 || b.norm === 0 ? 0 : dot / (a.norm * b.norm);
  const bonus = textScore > 0 ? (Number(sameCategory) + Number(sameService)) * CONTEXT_BONUS : 0;
  return {
    id: b.id,
    score: Math.min(1, textScore + bonus),
    sharedTerms: shared
      .sort((x, y) => y.weight - x.weight)
      .slice(0, MAX_SHARED_TERMS)
      .map((s) => s.term),
    sameCategory,
    sameService,
  };
}

/** Candidates scoring at least `minScore` against `target`, best first. */
export function rankSimilar(
  target: SimilarityDoc,
  candidates: readonly SimilarityDoc[],
  minScore: number,
): SimilarityMatch[] {
  const [targetVector, ...candidateVectors] = buildVectors([target, ...candidates]);
  return candidateVectors
    .map((candidate) => compare(targetVector, candidate))
    .filter((match) => match.score >= minScore)
    .sort((a, b) => b.score - a.score);
}

/**
 * Groups docs around seeds: the lowest unclaimed id becomes a seed and claims
 * every unclaimed doc scoring at least `threshold` against it. Comparing to the
 * seed only (not to every member) keeps a chain of loosely related tickets from
 * merging into one cluster. Seeds that gather fewer than `minSize` docs claim nothing.
 */
export function clusterBySimilarity(
  docs: readonly SimilarityDoc[],
  options: { threshold: number; minSize: number },
): SimilarityCluster[] {
  const vectors = buildVectors([...docs].sort((a, b) => a.id - b.id));
  const claimed = new Set<number>();
  const clusters: SimilarityCluster[] = [];
  for (const seed of vectors) {
    if (claimed.has(seed.id)) continue;
    const members = vectors.filter(
      (v) => v.id !== seed.id && !claimed.has(v.id) && compare(seed, v).score >= options.threshold,
    );
    if (members.length + 1 < options.minSize) continue;
    const group = [seed, ...members];
    for (const member of group) claimed.add(member.id);
    clusters.push({ seedId: seed.id, ticketIds: group.map((v) => v.id), sharedTerms: commonTerms(group) });
  }
  return clusters;
}

/** Terms present in at least two members: most widespread first, then most significant. */
function commonTerms(group: readonly Vector[]): string[] {
  const totals = new Map<string, { members: number; weight: number }>();
  for (const member of group) {
    for (const [term, weight] of member.weights) {
      const total = totals.get(term) ?? { members: 0, weight: 0 };
      totals.set(term, { members: total.members + 1, weight: total.weight + weight });
    }
  }
  return [...totals]
    .filter(([, total]) => total.members >= 2)
    .sort((a, b) => b[1].members - a[1].members || b[1].weight - a[1].weight || a[0].localeCompare(b[0]))
    .slice(0, MAX_SHARED_TERMS)
    .map(([term]) => term);
}

/** One-line explanation of why a match was suggested. */
export function similarityReason(match: Pick<SimilarityMatch, "sharedTerms" | "sameCategory" | "sameService">): string {
  const parts: string[] = [];
  if (match.sharedTerms.length > 0) parts.push(`Shares ${match.sharedTerms.map((t) => `“${t}”`).join(", ")}`);
  if (match.sameService) parts.push("same service");
  if (match.sameCategory) parts.push("same category");
  return parts.join(" · ") || "Similar wording";
}

/** Open items before closed ones, best score first within each group. */
export function orderOpenFirst<T extends { open: boolean; score: number }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => Number(b.open) - Number(a.open) || b.score - a.score);
}
