/**
 * 議題タイトルの類似度判定。
 * 2-gram（bigram）ベースの Jaccard 係数で意味の近さを近似する。
 *
 * - 「猫と犬、どちらと暮らすか」と「犬と猫、どちらが幸せか」
 *   → bigram 「猫と」「と犬」「犬と」「と猫」など多くが共有 → 重複判定
 * - 厳密な意味判定ではなく、明らかなパクリ・直近重複を防ぐ目的
 */

const DEFAULT_THRESHOLD = 0.45;

export function bigrams(s: string): Set<string> {
  const normalized = s
    .replace(/\s+/g, '')
    .replace(/[、。！？・「」『』（）()\[\]【】「」]/g, '');
  const result = new Set<string>();
  for (let i = 0; i < normalized.length - 1; i++) {
    result.add(normalized.slice(i, i + 2));
  }
  return result;
}

export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * 候補タイトルが既存タイトル集合に対して重複かどうか判定。
 */
export function isDuplicateTitle(
  candidate: string,
  existing: string[],
  threshold = DEFAULT_THRESHOLD,
): { duplicate: boolean; matchedWith?: string; similarity?: number } {
  const candBigrams = bigrams(candidate);
  let best = 0;
  let bestMatch: string | undefined;
  for (const ex of existing) {
    const sim = jaccardSimilarity(candBigrams, bigrams(ex));
    if (sim > best) {
      best = sim;
      bestMatch = ex;
    }
  }
  if (best > threshold) {
    return { duplicate: true, matchedWith: bestMatch, similarity: best };
  }
  return { duplicate: false, similarity: best };
}

/**
 * 主題語による意味的グルーピング。bigram Jaccard では拾えない言い換え（
 * 「AIは創造性を代替できるか」と「創造性はAIに代替されるか」など）に対する第2段防御。
 *
 * 「AI」「人間」のような頻出横断ワードはあえて含めない（含めると全部 overload する）。
 * 「議題の柱」になりやすい具体概念だけを定義する。
 */
const THEME_KEYWORDS: Record<string, string[]> = {
  happiness: ['幸福', '幸せ', '不幸', '幸せ'],
  creativity: ['創造', '創作', '芸術', 'アート', 'クリエイ'],
  emotion: ['感情', '気持ち', '共感', '心情'],
  consciousness: ['意識', '自我', '魂', '心'],
  virtual: ['仮想空間', 'メタバース', 'VR', '仮想世界'],
  ownership: ['所有', '保有', '持つこと'],
  effort_talent: ['努力', '才能', '素質', '天才'],
  relationship: ['友情', '友達', '絆', '人間関係', 'つながり', '繋がり'],
  freedom: ['自由', '束縛', '解放'],
  money: ['お金', '金銭', '富', '貧富', '経済格差', '通貨'],
  work: ['労働', '仕事', '職業', '雇用'],
  death_life: ['死', '生命', '老い', '不老', '寿命'],
  ethics: ['倫理', '道徳', '善悪'],
  identity: ['アイデンティティ', '個性', '自分らしさ', '人間らしさ'],
  time: ['時間', '永遠', '瞬間'],
  knowledge: ['学び', '教育', '学習', '知識'],
  meaning: ['意味', '目的', '価値'],
  art_creation: ['著作権', '創作物', '芸術作品'],
};

/** タイトルに含まれる主題ラベルの集合。複数主題に該当することもある */
export function extractThemes(title: string): Set<string> {
  const themes = new Set<string>();
  for (const [theme, keywords] of Object.entries(THEME_KEYWORDS)) {
    if (keywords.some((k) => title.includes(k))) themes.add(theme);
  }
  return themes;
}

/**
 * 候補タイトルが既存タイトル集合の中で「主題が偏りすぎ」かどうか判定。
 * 候補が持つ主題のいずれかについて、既存タイトル中の出現数が maxPerTheme を超えたら overload。
 */
export function isThemeOverloaded(
  candidate: string,
  existing: string[],
  maxPerTheme = 3,
): { overloaded: boolean; theme?: string; count?: number } {
  const candThemes = extractThemes(candidate);
  if (candThemes.size === 0) return { overloaded: false };
  for (const theme of candThemes) {
    const count = existing.filter((t) => extractThemes(t).has(theme)).length;
    if (count >= maxPerTheme) {
      return { overloaded: true, theme, count };
    }
  }
  return { overloaded: false };
}
