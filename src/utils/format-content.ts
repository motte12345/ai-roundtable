/**
 * Host の closing 発言から「【まとめ】」セクションだけ取り出す。
 * 取り出せなければ null。
 */
export function extractSummary(closingContent: string): string | null {
  const normalized = closingContent.replace(/\\n/g, '\n');
  const m = normalized.match(/【まとめ】([\s\S]*?)(?=【次の議題候補】|$)/);
  if (!m) return null;
  const body = m[1].trim();
  return body.length > 0 ? body : null;
}

/**
 * 発言テキストを段落配列に変換する。
 *
 * - LLM が既に \n\n で段落分けしている場合: その通りに分割
 * - 改行ゼロのウォール of text: 句点（。！？）で文を分けて2文ごとに段落化
 * - Host の closing（【まとめ】等）や箇条書きはそのまま1段落として扱う
 */
export function splitParagraphs(content: string): string[] {
  // LLM がリテラル文字列 "\n\n" や "\n" を出力してしまった場合のフォールバック:
  // 実際の改行に置換する（過去の発言救済 + プロンプト指示が崩れた場合の保険）
  const normalized = content
    .replace(/\\n\\n/g, '\n\n')
    .replace(/\\n/g, '\n');
  const trimmed = normalized.trim();

  // すでに \n\n で段落分けされていればそれを尊重
  if (trimmed.includes('\n\n')) {
    return trimmed.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  }

  // Host のまとめ/箇条書き構造はそのまま（既に \n で構造化済み）
  if (trimmed.includes('【') || /^\s*[-•]\s/m.test(trimmed) || /^\s*\d+[.．、]/m.test(trimmed)) {
    return [trimmed];
  }

  // 句点で文単位に分割（句点を保持）
  const sentences = trimmed
    .split(/(?<=[。！？])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (sentences.length <= 2) return [trimmed];

  // 2文ごとに段落
  const paragraphs: string[] = [];
  for (let i = 0; i < sentences.length; i += 2) {
    paragraphs.push(sentences.slice(i, i + 2).join(''));
  }
  return paragraphs;
}
