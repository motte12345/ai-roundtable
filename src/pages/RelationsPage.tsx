/**
 * キャラ間の関係性可視化ページ。
 * 各キャラが議論中に他キャラを言及した頻度を表示する。
 *
 * - 行: 発言者（from）
 * - 列: 言及されたキャラ（to）
 * - セル: 言及回数 + 発言者の総発言数に対する割合
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { SPEAKER_META, type Speaker } from '../types';

const SPEAKERS: Speaker[] = ['host', 'optimist', 'skeptic', 'zen'];

interface SpeakerRow {
  total: number;
  mentions: Record<string, number>;
}

interface RelationsData {
  speakers: string[];
  matrix: Record<string, SpeakerRow>;
}

export function RelationsPage() {
  const [data, setData] = useState<RelationsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.relations()
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  const insights = useMemo(() => {
    if (!data) return [];
    const out: string[] = [];

    // 1. 最もよく他キャラに言及するキャラ
    let mostExtroverted: { speaker: Speaker; rate: number } | null = null;
    for (const sp of SPEAKERS) {
      const row = data.matrix[sp];
      if (!row || row.total === 0) continue;
      const totalMentions = SPEAKERS.reduce(
        (sum, other) => sum + (other === sp ? 0 : (row.mentions[other] ?? 0)),
        0,
      );
      const rate = totalMentions / row.total;
      if (!mostExtroverted || rate > mostExtroverted.rate) {
        mostExtroverted = { speaker: sp, rate };
      }
    }
    if (mostExtroverted) {
      const meta = SPEAKER_META[mostExtroverted.speaker];
      out.push(
        `他キャラへの言及が最も多いのは **${meta.label}**（${meta.role}）。発言1回あたり平均 ${mostExtroverted.rate.toFixed(2)} 回他キャラに触れる`,
      );
    }

    // 2. 最も言及される標的キャラ
    let mostMentioned: { speaker: Speaker; count: number } | null = null;
    for (const target of SPEAKERS) {
      const count = SPEAKERS.reduce(
        (sum, from) => sum + (from === target ? 0 : (data.matrix[from]?.mentions[target] ?? 0)),
        0,
      );
      if (!mostMentioned || count > mostMentioned.count) {
        mostMentioned = { speaker: target, count };
      }
    }
    if (mostMentioned) {
      const meta = SPEAKER_META[mostMentioned.speaker];
      out.push(
        `最もよく標的にされるのは **${meta.label}**（${meta.role}）。他キャラから合計 ${mostMentioned.count} 回言及されている`,
      );
    }

    // 3. 最強の対立軸
    let strongestPair: { from: Speaker; to: Speaker; count: number } | null = null;
    for (const from of SPEAKERS) {
      for (const to of SPEAKERS) {
        if (from === to) continue;
        const count = data.matrix[from]?.mentions[to] ?? 0;
        if (!strongestPair || count > strongestPair.count) {
          strongestPair = { from, to, count };
        }
      }
    }
    if (strongestPair && strongestPair.count > 0) {
      const fromMeta = SPEAKER_META[strongestPair.from];
      const toMeta = SPEAKER_META[strongestPair.to];
      out.push(
        `最も濃い対立軸は **${fromMeta.label} → ${toMeta.label}**（${strongestPair.count} 回言及）`,
      );
    }

    return out;
  }, [data]);

  if (error) return <p className="error">エラー: {error}</p>;
  if (!data) return <p className="loading">Loading…</p>;

  return (
    <>
      <div className="archive-head">
        <h2>キャラ関係マップ</h2>
        <p className="archive-sub">
          各キャラが議論中に他のキャラを発言中で言及した回数。「Optimist が〜」「楽観派は〜」のような直接言及をカウント。
          <br />
          <small>※ 司会的進行で名前を呼ぶ Host は参考値。実質的な対話関係は Optimist / Skeptic / Zen の3キャラ間で見るのがおすすめ。</small>
        </p>
      </div>

      {insights.length > 0 && (
        <ul className="relations-insights">
          {insights.map((line, i) => (
            <li key={i} dangerouslySetInnerHTML={{ __html: line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />
          ))}
        </ul>
      )}

      <div className="relations-table-wrap">
        <table className="relations-table">
          <thead>
            <tr>
              <th>発言者 →<br />言及先 ↓</th>
              {SPEAKERS.map((sp) => {
                const meta = SPEAKER_META[sp];
                return (
                  <th key={sp} style={{ color: meta.color }}>
                    <Link to={`/character/${sp}`} className="relations-charlink">
                      <span>{meta.icon}</span> {meta.label}
                    </Link>
                  </th>
                );
              })}
              <th className="relations-total">総発言数</th>
            </tr>
          </thead>
          <tbody>
            {SPEAKERS.map((from) => {
              const row = data.matrix[from];
              const meta = SPEAKER_META[from];
              if (!row) return null;
              return (
                <tr key={from}>
                  <th style={{ color: meta.color }}>
                    <Link to={`/character/${from}`} className="relations-charlink">
                      <span>{meta.icon}</span> {meta.label}
                    </Link>
                  </th>
                  {SPEAKERS.map((to) => {
                    if (from === to) {
                      return <td key={to} className="relations-self">—</td>;
                    }
                    const count = row.mentions[to] ?? 0;
                    const rate = row.total > 0 ? count / row.total : 0;
                    const heat = Math.min(1, rate * 1.2);
                    return (
                      <td
                        key={to}
                        className="relations-cell"
                        style={{ background: `rgba(180, 200, 240, ${heat * 0.15})` }}
                        title={`${count} / ${row.total} 発言（${(rate * 100).toFixed(1)}%）`}
                      >
                        <div className="relations-count">{count}</div>
                        <div className="relations-rate">{(rate * 100).toFixed(0)}%</div>
                      </td>
                    );
                  })}
                  <td className="relations-total">{row.total}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
