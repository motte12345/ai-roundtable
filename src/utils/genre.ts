export const GENRE_LABELS: Record<string, string> = {
  sf: 'SF・思考実験',
  lifestyle: 'ライフスタイル',
  tech: 'テクノロジー',
  ethics: '倫理・社会',
  philosophy: '哲学',
};

export function genreLabel(genre: string | null | undefined): string {
  if (!genre) return 'その他';
  return GENRE_LABELS[genre] ?? genre;
}
