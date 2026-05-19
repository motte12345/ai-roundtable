import type { Highlights, Message } from '../types';
import { SPEAKER_META, type Speaker } from '../types';

interface Props {
  highlightsJson: string | null;
  messages: Message[];
}

interface Card {
  key: keyof Highlights;
  label: string;
  emoji: string;
}

const CARDS: Card[] = [
  { key: 'sharpest', label: '最も鋭い反論', emoji: '⚔' },
  { key: 'constructive', label: '最も建設的', emoji: '✦' },
  { key: 'illuminating', label: '最も視点が開かれる', emoji: '◐' },
];

function scrollToTurn(turnNo: number) {
  const el = document.getElementById(`turn-${turnNo}`);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1500);
  }
}

export function HighlightsBox({ highlightsJson, messages }: Props) {
  if (!highlightsJson) return null;

  let highlights: Highlights;
  try {
    highlights = JSON.parse(highlightsJson) as Highlights;
  } catch {
    return null;
  }

  return (
    <section className="highlights">
      <h3 className="highlights-title">議論のハイライト</h3>
      <div className="highlights-grid">
        {CARDS.map((c) => {
          const item = highlights[c.key];
          if (!item) return null;
          const msg = messages.find((m) => m.turn_no === item.turn_no);
          if (!msg) return null;
          const meta = SPEAKER_META[msg.speaker as Speaker];
          return (
            <button
              key={c.key}
              type="button"
              className="highlight-card"
              style={{ borderColor: meta.color }}
              onClick={() => scrollToTurn(item.turn_no)}
              title={`Turn ${item.turn_no} へジャンプ`}
            >
              <div className="highlight-card-head">
                <span className="highlight-emoji">{c.emoji}</span>
                <span className="highlight-label">{c.label}</span>
              </div>
              <div className="highlight-speaker" style={{ color: meta.color }}>
                {meta.icon} {meta.label}
                <span className="highlight-turn">Turn {item.turn_no}</span>
              </div>
              <p className="highlight-reason">{item.reason}</p>
            </button>
          );
        })}
      </div>
    </section>
  );
}
