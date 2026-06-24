/**
 * D1 操作の薄いラッパー。
 */

export interface TopicRow {
  id: number;
  title: string;
  genre: string | null;
  status: 'pending' | 'active' | 'completed' | 'rejected';
  current_turn: number;
  source: 'seed' | 'host_proposed' | 'manual';
  started_at: number | null;
  completed_at: number | null;
  created_at: number;
  seo_title: string | null;
  highlights: string | null;
  votes: number;
  host_memo: string | null;
}

export interface MessageRow {
  id: number;
  topic_id: number;
  turn_no: number;
  speaker: 'host' | 'optimist' | 'skeptic' | 'zen';
  provider: string;
  model: string;
  content: string;
  created_at: number;
  audio_path: string | null;
}

export class DB {
  constructor(private d1: D1Database) {}

  // ---------- topics ----------

  async getActiveTopic(): Promise<TopicRow | null> {
    return await this.d1
      .prepare('SELECT * FROM topics WHERE status = ? ORDER BY started_at DESC LIMIT 1')
      .bind('active')
      .first<TopicRow>();
  }

  async getNextPendingTopic(): Promise<TopicRow | null> {
    // Host 提案 (host_proposed) を優先、次に seed をランダム
    const proposed = await this.d1
      .prepare(`SELECT * FROM topics WHERE status = 'pending' AND source = 'host_proposed' ORDER BY created_at ASC LIMIT 1`)
      .first<TopicRow>();
    if (proposed) return proposed;

    return await this.d1
      .prepare(`SELECT * FROM topics WHERE status = 'pending' AND source = 'seed' ORDER BY RANDOM() LIMIT 1`)
      .first<TopicRow>();
  }

  async getTopicById(id: number): Promise<TopicRow | null> {
    return await this.d1
      .prepare('SELECT * FROM topics WHERE id = ?')
      .bind(id)
      .first<TopicRow>();
  }

  async getRecentCompletedTopics(limit: number): Promise<TopicRow[]> {
    const result = await this.d1
      .prepare(`SELECT * FROM topics WHERE status IN ('active', 'completed') ORDER BY COALESCE(completed_at, started_at) DESC LIMIT ?`)
      .bind(limit)
      .all<TopicRow>();
    return result.results ?? [];
  }

  async getArchive(cursor: number, limit: number, genre?: string | null): Promise<TopicRow[]> {
    if (genre === '__other__') {
      // 未分類（genre IS NULL）絞込み
      const result = await this.d1
        .prepare(
          `SELECT * FROM topics WHERE status = 'completed' AND genre IS NULL AND id < ? ORDER BY id DESC LIMIT ?`,
        )
        .bind(cursor, limit)
        .all<TopicRow>();
      return result.results ?? [];
    }
    if (genre) {
      const result = await this.d1
        .prepare(
          `SELECT * FROM topics WHERE status = 'completed' AND genre = ? AND id < ? ORDER BY id DESC LIMIT ?`,
        )
        .bind(genre, cursor, limit)
        .all<TopicRow>();
      return result.results ?? [];
    }
    const result = await this.d1
      .prepare(`SELECT * FROM topics WHERE status = 'completed' AND id < ? ORDER BY id DESC LIMIT ?`)
      .bind(cursor, limit)
      .all<TopicRow>();
    return result.results ?? [];
  }

  /** 完了議題のジャンル別件数 */
  async getGenreCounts(): Promise<Array<{ genre: string | null; count: number }>> {
    const result = await this.d1
      .prepare(`SELECT genre, COUNT(*) as count FROM topics WHERE status = 'completed' GROUP BY genre`)
      .all<{ genre: string | null; count: number }>();
    return result.results ?? [];
  }

  // ---------- character profile ----------

  async getCharacterStats(speaker: string): Promise<{
    total_messages: number;
    total_topics: number;
    avg_length: number;
  }> {
    const row = await this.d1
      .prepare(
        `SELECT COUNT(*) AS total_messages, COUNT(DISTINCT topic_id) AS total_topics, AVG(LENGTH(content)) AS avg_length FROM messages WHERE speaker = ?`,
      )
      .bind(speaker)
      .first<{ total_messages: number; total_topics: number; avg_length: number | null }>();
    return {
      total_messages: row?.total_messages ?? 0,
      total_topics: row?.total_topics ?? 0,
      avg_length: row?.avg_length ? Math.round(row.avg_length) : 0,
    };
  }

  async getCharacterMessages(
    speaker: string,
    limit: number,
  ): Promise<Array<MessageRow & { topic_title: string }>> {
    const result = await this.d1
      .prepare(
        `SELECT m.*, t.title AS topic_title FROM messages m JOIN topics t ON m.topic_id = t.id WHERE m.speaker = ? ORDER BY m.id DESC LIMIT ?`,
      )
      .bind(speaker, limit)
      .all<MessageRow & { topic_title: string }>();
    return result.results ?? [];
  }

  /**
   * 議題を pending → active に遷移させる（CAS）。
   * 同時に複数 cron が走った場合、勝者だけが更新成功（changes > 0）し、
   * 敗者は何もしない。レース時の二重 startTopic を防ぐ。
   */
  async startTopic(id: number, now: number): Promise<boolean> {
    const result = await this.d1
      .prepare(`UPDATE topics SET status = 'active', started_at = ?, current_turn = 0 WHERE id = ? AND status = 'pending'`)
      .bind(now, id)
      .run();
    return (result.meta?.changes ?? 0) > 0;
  }

  async incrementTopicTurn(id: number, turn: number): Promise<void> {
    await this.d1
      .prepare(`UPDATE topics SET current_turn = ? WHERE id = ?`)
      .bind(turn, id)
      .run();
  }

  async completeTopic(id: number, now: number): Promise<void> {
    await this.d1
      .prepare(`UPDATE topics SET status = 'completed', current_turn = 11, completed_at = ? WHERE id = ?`)
      .bind(now, id)
      .run();
  }

  async addProposedTopic(title: string, genre: string | null, now: number): Promise<void> {
    await this.d1
      .prepare(`INSERT INTO topics (title, genre, status, source, created_at) VALUES (?, ?, 'pending', 'host_proposed', ?)`)
      .bind(title, genre, now)
      .run();
  }

  /** 全議題のタイトル一覧（重複検知用、rejected も含む） */
  async getAllTopicTitles(): Promise<string[]> {
    const result = await this.d1
      .prepare(`SELECT title FROM topics`)
      .all<{ title: string }>();
    return (result.results ?? []).map((r) => r.title);
  }

  /** 直近で完了した議題のタイトル（Host closing のコンテキスト用） */
  async getRecentCompletedTitles(limit: number): Promise<string[]> {
    const result = await this.d1
      .prepare(
        `SELECT title FROM topics WHERE status = 'completed' ORDER BY completed_at DESC LIMIT ?`,
      )
      .bind(limit)
      .all<{ title: string }>();
    return (result.results ?? []).map((r) => r.title);
  }

  /** pending 中の Host 提案議題タイトル（Host closing のコンテキスト用） */
  async getPendingProposedTitles(limit: number): Promise<string[]> {
    const result = await this.d1
      .prepare(
        `SELECT title FROM topics WHERE status = 'pending' AND source = 'host_proposed' ORDER BY created_at DESC LIMIT ?`,
      )
      .bind(limit)
      .all<{ title: string }>();
    return (result.results ?? []).map((r) => r.title);
  }

  async updateSeoTitle(id: number, seoTitle: string): Promise<void> {
    await this.d1
      .prepare(`UPDATE topics SET seo_title = ? WHERE id = ?`)
      .bind(seoTitle, id)
      .run();
  }

  async updateHighlights(id: number, highlightsJson: string): Promise<void> {
    await this.d1
      .prepare(`UPDATE topics SET highlights = ? WHERE id = ?`)
      .bind(highlightsJson, id)
      .run();
  }

  async updateHostMemo(id: number, memo: string): Promise<void> {
    await this.d1
      .prepare(`UPDATE topics SET host_memo = ? WHERE id = ?`)
      .bind(memo, id)
      .run();
  }

  async updateMessageAudioPath(messageId: number, audioPath: string): Promise<void> {
    await this.d1
      .prepare(`UPDATE messages SET audio_path = ? WHERE id = ?`)
      .bind(audioPath, messageId)
      .run();
  }

  // ---------- relations ----------

  /**
   * 各キャラが他キャラを発言中にどれだけ言及したかの集計。
   * 発言者ごとに total_messages と他キャラへの mention_count を返す。
   * Host は通常会議進行で他キャラ名を出すので、参考値として含める。
   */
  async getRelationMatrix(): Promise<Array<{
    from_speaker: string;
    total_messages: number;
    mentions_optimist: number;
    mentions_skeptic: number;
    mentions_zen: number;
    mentions_host: number;
  }>> {
    const result = await this.d1
      .prepare(
        `SELECT
          speaker AS from_speaker,
          COUNT(*) AS total_messages,
          SUM(CASE WHEN (content LIKE '%Optimist%' OR content LIKE '%楽観派%') THEN 1 ELSE 0 END) AS mentions_optimist,
          SUM(CASE WHEN (content LIKE '%Skeptic%' OR content LIKE '%懐疑派%') THEN 1 ELSE 0 END) AS mentions_skeptic,
          SUM(CASE WHEN (content LIKE '%Zen%' OR content LIKE '%俯瞰派%') THEN 1 ELSE 0 END) AS mentions_zen,
          SUM(CASE WHEN (content LIKE '%Host%' OR content LIKE '%司会%') THEN 1 ELSE 0 END) AS mentions_host
        FROM messages
        GROUP BY speaker`,
      )
      .all<{
        from_speaker: string;
        total_messages: number;
        mentions_optimist: number;
        mentions_skeptic: number;
        mentions_zen: number;
        mentions_host: number;
      }>();
    return result.results ?? [];
  }

  // ---------- candidates / votes ----------

  /**
   * 投票対象となる議題候補（pending かつ host_proposed）。
   * 票数の多い順、同票なら新しい順（id DESC）。
   */
  async getCandidates(limit: number, genre?: string | null): Promise<TopicRow[]> {
    if (genre === '__other__') {
      const result = await this.d1
        .prepare(
          `SELECT * FROM topics WHERE status = 'pending' AND source = 'host_proposed' AND genre IS NULL ORDER BY votes DESC, id DESC LIMIT ?`,
        )
        .bind(limit)
        .all<TopicRow>();
      return result.results ?? [];
    }
    if (genre) {
      const result = await this.d1
        .prepare(
          `SELECT * FROM topics WHERE status = 'pending' AND source = 'host_proposed' AND genre = ? ORDER BY votes DESC, id DESC LIMIT ?`,
        )
        .bind(genre, limit)
        .all<TopicRow>();
      return result.results ?? [];
    }
    const result = await this.d1
      .prepare(
        `SELECT * FROM topics WHERE status = 'pending' AND source = 'host_proposed' ORDER BY votes DESC, id DESC LIMIT ?`,
      )
      .bind(limit)
      .all<TopicRow>();
    return result.results ?? [];
  }

  /**
   * 候補議題のジャンル別件数（フィルタ UI 用）。
   */
  async getCandidateGenreCounts(): Promise<Array<{ genre: string | null; count: number }>> {
    const result = await this.d1
      .prepare(
        `SELECT genre, COUNT(*) as count FROM topics WHERE status = 'pending' AND source = 'host_proposed' GROUP BY genre`,
      )
      .all<{ genre: string | null; count: number }>();
    return result.results ?? [];
  }

  /**
   * 投票を記録する。同じ voter_hash が同じ topic に既に投票していれば false。
   * 成功した場合 votes カウンタも +1 する。
   */
  async recordVote(topicId: number, voterHash: string, now: number): Promise<boolean> {
    const insertResult = await this.d1
      .prepare(
        `INSERT OR IGNORE INTO topic_votes (topic_id, voter_hash, voted_at) VALUES (?, ?, ?)`,
      )
      .bind(topicId, voterHash, now)
      .run();
    const inserted = (insertResult.meta?.changes ?? 0) > 0;
    if (!inserted) return false;
    // 投票対象が pending かつ host_proposed の場合のみ加算
    await this.d1
      .prepare(
        `UPDATE topics SET votes = votes + 1 WHERE id = ? AND status = 'pending' AND source = 'host_proposed'`,
      )
      .bind(topicId)
      .run();
    return true;
  }

  // ---------- messages ----------

  async getMessagesByTopic(topicId: number): Promise<MessageRow[]> {
    const result = await this.d1
      .prepare(`SELECT * FROM messages WHERE topic_id = ? ORDER BY turn_no ASC`)
      .bind(topicId)
      .all<MessageRow>();
    return result.results ?? [];
  }

  /** ある議題で実際に書き込まれたメッセージの最大 turn_no（無ければ 0）。 */
  async getMaxTurnNoForTopic(topicId: number): Promise<number> {
    const row = await this.d1
      .prepare(`SELECT COALESCE(MAX(turn_no), 0) AS max_turn FROM messages WHERE topic_id = ?`)
      .bind(topicId)
      .first<{ max_turn: number }>();
    return row?.max_turn ?? 0;
  }

  /**
   * メッセージ挿入。UNIQUE(topic_id, turn_no) 制約により、
   * 同じターンが二重に走った場合は勝者だけが書き込み成功。
   * INSERT OR IGNORE で敗者は黙ってスキップ（null を返す）。
   * 成功時は挿入された行の id を返す。
   */
  async addMessage(msg: {
    topic_id: number;
    turn_no: number;
    speaker: string;
    provider: string;
    model: string;
    content: string;
    created_at: number;
  }): Promise<number | null> {
    const result = await this.d1
      .prepare(`INSERT OR IGNORE INTO messages (topic_id, turn_no, speaker, provider, model, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        msg.topic_id,
        msg.turn_no,
        msg.speaker,
        msg.provider,
        msg.model,
        msg.content,
        msg.created_at,
      )
      .run();
    if ((result.meta?.changes ?? 0) === 0) return null;
    const id = result.meta?.last_row_id;
    return typeof id === 'number' ? id : null;
  }

  // ---------- meta ----------

  async getMeta(key: string): Promise<string | null> {
    const row = await this.d1
      .prepare('SELECT value FROM meta WHERE key = ?')
      .bind(key)
      .first<{ value: string }>();
    return row?.value ?? null;
  }

  async setMeta(key: string, value: string, now: number): Promise<void> {
    await this.d1
      .prepare(`INSERT INTO meta (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
      .bind(key, value, now)
      .run();
  }

  // ---------- bluesky ----------

  /**
   * 指定ターンの Bluesky post 参照（uri/cid）を取得。未投稿なら null。
   * bluesky_uri IS NOT NULL を条件にするので、投稿済みかどうかの冪等性ガードに使える。
   */
  async getMessageBskyRef(
    topicId: number,
    turnNo: number,
  ): Promise<{ uri: string; cid: string } | null> {
    const row = await this.d1
      .prepare(
        `SELECT bluesky_uri, bluesky_cid FROM messages WHERE topic_id = ? AND turn_no = ? AND bluesky_uri IS NOT NULL`,
      )
      .bind(topicId, turnNo)
      .first<{ bluesky_uri: string; bluesky_cid: string }>();
    return row ? { uri: row.bluesky_uri, cid: row.bluesky_cid } : null;
  }

  /**
   * topicId 内で turn_no < beforeTurn かつ投稿済みのうち、最も新しいターンの post ref を返す。
   * 親を「直前ターン固定」でなく「直近の投稿成功ターン」にすることで、途中ターンの投稿失敗
   * （一時的な Bluesky 障害など）からスレッドを自動復帰させる（カスケード停止を防ぐ）。
   */
  async getLatestPostedBskyRefBefore(
    topicId: number,
    beforeTurn: number,
  ): Promise<{ uri: string; cid: string } | null> {
    const row = await this.d1
      .prepare(
        `SELECT bluesky_uri, bluesky_cid FROM messages
         WHERE topic_id = ? AND turn_no < ? AND bluesky_uri IS NOT NULL
         ORDER BY turn_no DESC LIMIT 1`,
      )
      .bind(topicId, beforeTurn)
      .first<{ bluesky_uri: string; bluesky_cid: string }>();
    return row ? { uri: row.bluesky_uri, cid: row.bluesky_cid } : null;
  }

  /** メッセージに Bluesky post 参照を保存（投稿成功直後に呼ぶ） */
  async updateMessageBskyRef(
    messageId: number,
    uri: string,
    cid: string,
  ): Promise<void> {
    await this.d1
      .prepare(`UPDATE messages SET bluesky_uri = ?, bluesky_cid = ? WHERE id = ?`)
      .bind(uri, cid, messageId)
      .run();
  }
}
