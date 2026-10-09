import { jaccard, normalizeText, tokenSet } from '../../shared/text';

/**
 * Pick the option that best matches any of the wanted synonyms.
 * Scores: exact 1.0 · prefix at a word boundary 0.9 · whole-word containment 0.8 · token overlap 0.5 + 0.3·jaccard (when jaccard ≥ 0.5).
 * Ties go to the shorter option; scores below `minScore` return null.
 */
export function bestMatch(wanted: string | string[], options: string[], minScore = 0.6): { option: string; score: number } | null {
  const ws = (Array.isArray(wanted) ? wanted : [wanted]).map((w) => ({ raw: w, n: normalizeText(w) })).filter((w) => w.n);
  let best: { option: string; score: number } | null = null;
  for (const option of options) {
    const o = normalizeText(option);
    if (!o) continue;
    for (const w of ws) {
      let score = 0;
      if (o === w.n) score = 1;
      else if (o.startsWith(`${w.n} `) || w.n.startsWith(`${o} `)) score = 0.9;
      else if (` ${o} `.includes(` ${w.n} `)) score = 0.8;
      else {
        const j = jaccard(tokenSet(w.raw), tokenSet(option));
        if (j >= 0.5) score = 0.5 + 0.3 * j;
      }
      if (score === 0) continue;
      if (!best || score > best.score || (score === best.score && option.length < best.option.length)) best = { option, score };
    }
  }
  return best && best.score >= minScore ? best : null;
}
