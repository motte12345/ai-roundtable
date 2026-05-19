/**
 * GET /audio/topic-{id}/turn-{n}.mp3
 * R2 に保存された音声 MP3 を配信する。
 * 強くキャッシュ（1年・immutable）— 同じパスのファイルが上書きされない前提。
 */

const NOT_FOUND_HEADERS = {
  'Content-Type': 'text/plain; charset=utf-8',
  'Cache-Control': 'public, max-age=60',
};

export async function handleAudio(
  bucket: R2Bucket,
  pathname: string,
): Promise<Response> {
  // 先頭の '/' を取り除いて R2 キーに変換
  const key = pathname.replace(/^\//, '');
  if (!key.startsWith('audio/')) {
    return new Response('Not found', { status: 404, headers: NOT_FOUND_HEADERS });
  }
  if (!key.endsWith('.wav') && !key.endsWith('.mp3')) {
    return new Response('Not found', { status: 404, headers: NOT_FOUND_HEADERS });
  }

  const obj = await bucket.get(key);
  if (!obj) {
    return new Response('Not found', { status: 404, headers: NOT_FOUND_HEADERS });
  }

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('Access-Control-Allow-Origin', '*');
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', key.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg');
  }

  return new Response(obj.body, { headers });
}
