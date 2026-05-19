/**
 * 議題タイトルからジャンルを推定する。
 * Host が closing で `[ジャンル]` を付け忘れた場合のフォールバック。
 *
 * スコア式（複数キーワードヒットで強化）+ パターン優先順位で「AI」が tech に流れすぎる
 * バイアスを抑止する。同点なら PATTERNS の上位に書かれたジャンルが勝つ。
 */

export const VALID_GENRES = ['sf', 'lifestyle', 'tech', 'ethics', 'philosophy'] as const;
export type Genre = (typeof VALID_GENRES)[number];

interface Pattern {
  genre: Genre;
  keywords: string[];
}

/**
 * パターン順序が同点時の勝者を決める。
 * 「AI倫理」のようなクロス領域は具体性の高い ethics/philosophy/sf を tech より優先したい。
 *
 * 順序: ethics → philosophy → sf → lifestyle → tech
 *   - 抽象概念（倫理・人生観・思考実験）が「AI」「ロボット」キーワードに勝てるようにする
 *   - tech は「純技術ワード」のみ。AI を含む議題でも内容が ethics/philosophy なら正しく分類される
 */
const PATTERNS: Pattern[] = [
  {
    genre: 'ethics',
    keywords: [
      '嘘', '正直', '公開', '透明', '社会', '格差', '差別',
      'プライバシー', '権利', '法', 'ルール', '規制', '責任',
      'モラル', '道徳', '倫理', '監視', '是非', '許容', '禁止', '公平', '不平等',
      '著作権', '知的財産', '所有権', '同意',
    ],
  },
  {
    genre: 'philosophy',
    keywords: [
      '努力', '才能', '友情', '愛', '幸福', '幸せ', '意味', '人生',
      '死', '自由', '運命', '夢', 'お金と時間', 'ハッピーエンド',
      '物語', '芸術', '美', '本質', '本物', '価値', '特権', '人間らしい', '人間性',
      '存在', '本当の', '真実',
      '創造性', '創造', '共存',
    ],
  },
  {
    genre: 'sf',
    keywords: [
      '宇宙', 'シミュレーション', '不老', 'タイムマシン', '異星', '別世界',
      'パラレル', '時間旅行', 'テセウス', '思考実験', '宇宙人', '未来人',
      '量子', 'ロボット意識', '仮想空間', '仮想世界', '仮想現実',
      '現実とは', 'は現実か',
      '意識のアップロード', '意識転送',
      '感情', '意識', '進化', '感覚', 'クローン',
    ],
  },
  {
    genre: 'lifestyle',
    keywords: [
      '朝食', '夕食', '食事', 'ペット', '猫', '犬', '住居', '田舎', '都会',
      '本', '読書', '電子書籍', '紙', '生活', '習慣', '寝', '睡眠',
      'コーヒー', '紅茶', '料理', '旅行', 'カフェ', 'ファッション',
    ],
  },
  {
    genre: 'tech',
    keywords: [
      // ※「AI」「ai」「ロボット」は外す: 抽象議題に巻き込まれて誤分類されるため
      // 純技術ワードのみ。AI を扱う議題は他ジャンルが先に拾う
      'スマート', 'デジタル', 'インターネット', 'SNS', 'リモート',
      'コンピュータ', 'プログラミング', 'プログラム', 'アルゴリズム', 'データ',
      'メタバース', 'ブロックチェーン', 'クラウド',
      // VR/AR は表記揺れ対策で大文字小文字両方
      'VR', 'AR',
    ],
  },
];

export function isValidGenre(value: unknown): value is Genre {
  return typeof value === 'string' && (VALID_GENRES as readonly string[]).includes(value);
}

/**
 * スコア式: タイトルに含まれるキーワード数の多いジャンルが勝つ。
 * 同点の場合は PATTERNS の先頭に近いジャンル（ethics > philosophy > sf > lifestyle > tech）が勝つ。
 * どのキーワードも一致しなければ null。
 */
export function inferGenre(title: string): Genre | null {
  const lower = title.toLowerCase();
  const scores: Record<Genre, number> = {
    sf: 0,
    lifestyle: 0,
    tech: 0,
    ethics: 0,
    philosophy: 0,
  };

  for (const pat of PATTERNS) {
    for (const kw of pat.keywords) {
      if (lower.includes(kw.toLowerCase())) {
        scores[pat.genre]++;
      }
    }
  }

  let best: Genre | null = null;
  let bestScore = 0;
  // PATTERNS 順で走査することで「同点なら上位パターン勝ち」を実現
  for (const pat of PATTERNS) {
    if (scores[pat.genre] > bestScore) {
      bestScore = scores[pat.genre];
      best = pat.genre;
    }
  }
  return best;
}
