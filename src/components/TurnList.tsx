import { useTTS } from '../contexts/TTSContext';
import { SPEAKER_META, type Message } from '../types';
import { splitParagraphs } from '../utils/format-content';
import { BookmarkButton } from './BookmarkButton';

interface Props {
  messages: Message[];
  enableBookmark?: boolean;
}

function formatTurnTime(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return d.toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function TurnList({ messages, enableBookmark = true }: Props) {
  const tts = useTTS();

  if (messages.length === 0) {
    return <p className="empty-thread">議論はまだ始まっていません</p>;
  }
  return (
    <div className="thread">
      {messages.map((m) => {
        const meta = SPEAKER_META[m.speaker];
        const paragraphs = splitParagraphs(m.content);
        const isSpeakingThis = tts.currentTurn === m.turn_no;
        return (
          <article
            key={m.id ?? `${m.topic_id}-${m.turn_no}`}
            id={`turn-${m.turn_no}`}
            className={`turn turn-${m.speaker} ${isSpeakingThis ? 'turn-speaking' : ''}`}
            style={{ borderLeftColor: meta.color }}
          >
            <header className="turn-head">
              <span className="speaker-icon" style={{ color: meta.color }}>
                {meta.icon}
              </span>
              <span className="speaker-name" style={{ color: meta.color }}>
                {meta.label}
              </span>
              <span className="speaker-role">{meta.role}</span>
              <span className="turn-meta">
                Turn {m.turn_no} ・ {m.provider}/{m.model}
              </span>
              <time
                className="turn-time"
                dateTime={new Date(m.created_at * 1000).toISOString()}
              >
                {formatTurnTime(m.created_at)}
              </time>
              {tts.isAvailable && (
                <button
                  type="button"
                  className={`tts-turn-btn ${isSpeakingThis ? 'active' : ''}`}
                  onClick={() => {
                    if (isSpeakingThis) {
                      tts.stop();
                    } else {
                      const role = meta.role ?? '';
                      const cleaned = m.content.replace(/\s+/g, ' ').trim();
                      const text = role ? `${role}、${cleaned}` : cleaned;
                      tts.playSingle(m.turn_no, text, m.audio_path ? `/${m.audio_path}` : null);
                    }
                  }}
                  aria-label={isSpeakingThis ? '読み上げを停止' : 'この発言を読み上げ'}
                  title={isSpeakingThis ? '読み上げを停止' : 'この発言を読み上げ'}
                >
                  {isSpeakingThis ? '■' : '🔊'}
                </button>
              )}
              {enableBookmark && (
                <BookmarkButton topicId={m.topic_id} turnNo={m.turn_no} />
              )}
            </header>
            <div className="turn-body">
              {paragraphs.map((p, i) => (
                <p key={i} className="turn-paragraph">{p}</p>
              ))}
            </div>
          </article>
        );
      })}
    </div>
  );
}
