/**
 * Cloudflare Workers AI MeloTTS で日本語テキストを音声化、R2 に保存する。
 *
 * - モデル: @cf/myshell-ai/melotts (Japanese 'jp')
 * - 出力: base64 エンコードされた MP3
 * - 保存先: R2 (`audio/topic-{topic_id}/turn-{turn_no}.mp3`)
 *
 * Workers AI 無料枠 10K neurons/day を意識し、失敗時は throw して呼び出し側で
 * フォールバック (Web Speech API) に任せる。
 */

export interface TtsEnv {
  AI: Ai;
  AUDIO: R2Bucket;
}

/**
 * MeloTTS は実際には WAV (RIFF) を返す（ドキュメントに反するが実測でそうなる）。
 * 拡張子・content-type を WAV に合わせる。
 * 容量は MP3 の数倍だが、R2 ストレージ無料枠 10GB に対しては数ヶ月分の余裕。
 */
export function audioPathFor(topicId: number, turnNo: number): string {
  return `audio/topic-${topicId}/turn-${turnNo}.wav`;
}

/**
 * 音声化前にテキストの先頭に付ける役職ラベル。
 * ながら聞きの観客が「誰の発言か」を音だけで判別できるようにする。
 */
export const SPEAKER_LABEL_FOR_TTS: Record<string, string> = {
  host: '司会',
  optimist: '楽観派',
  skeptic: '懐疑派',
  zen: '俯瞰派',
};

export function buildSpeechText(speaker: string, content: string): string {
  const label = SPEAKER_LABEL_FOR_TTS[speaker] ?? '';
  const cleaned = content.replace(/\s+/g, ' ').trim();
  return label ? `${label}、${cleaned}` : cleaned;
}

interface MeloTtsResponse {
  audio?: string; // base64-encoded MP3
}

/**
 * base64 文字列を Uint8Array に変換。
 */
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * 1発言ぶんの音声を生成して R2 に保存し、保存パスを返す。
 * 失敗時は null を返す（呼び出し側でフォールバック）。
 */
export async function generateAndStoreTts(
  text: string,
  topicId: number,
  turnNo: number,
  env: TtsEnv,
): Promise<string | null> {
  // 余分な空白・改行を除去（読み上げで不自然な間にならないように）
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0) return null;

  // 長すぎるテキストは MeloTTS が安定しない可能性があるので 500 文字でカット
  // 議論の発言は通常 150-250 字なので超えるケースは稀
  const safeText = cleaned.slice(0, 500);

  try {
    const result = (await env.AI.run('@cf/myshell-ai/melotts', {
      prompt: safeText,
      lang: 'jp',
    })) as MeloTtsResponse;

    if (!result?.audio) {
      console.warn(`[tts] no audio returned for topic=${topicId} turn=${turnNo}`);
      return null;
    }

    const bytes = base64ToBytes(result.audio);
    const path = audioPathFor(topicId, turnNo);
    await env.AUDIO.put(path, bytes, {
      httpMetadata: {
        contentType: 'audio/wav',
        cacheControl: 'public, max-age=31536000, immutable',
      },
    });
    return path;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[tts] generate failed (topic=${topicId} turn=${turnNo}): ${msg}`);
    return null;
  }
}
