/**
 * 議論の連続再生コントロール。CurrentPage / TopicPage の上部に配置。
 *
 * Web Speech API を使う。OS にインストールされているボイスから選択可能。
 * macOS は Kyoko / Otoya（Premium 推奨、System Settings からダウンロード）、
 * Windows は Microsoft Ayumi Online (Natural)（Settings → Time & language → Speech から追加 DL）など。
 */
import { useTTS } from '../contexts/TTSContext';
import { SPEAKER_META, type Message } from '../types';

interface Props {
  messages: Message[];
}

const RATES = [0.8, 1.0, 1.1, 1.3, 1.5, 1.8];

function toSpeechText(m: Message): string {
  const role = SPEAKER_META[m.speaker]?.role ?? '';
  const cleaned = m.content.replace(/\s+/g, ' ').trim();
  return role ? `${role}、${cleaned}` : cleaned;
}

/** ボイス名を見やすく整形（プラットフォーム/言語タグの除去）。 */
function formatVoiceName(v: SpeechSynthesisVoice): string {
  const name = v.name;
  const lang = v.lang;
  return `${name} (${lang})`;
}

export function TTSToolbar({ messages }: Props) {
  const tts = useTTS();
  if (!tts.isAvailable) return null;
  if (messages.length === 0) return null;

  const handlePlayAll = () => {
    const items = messages.map((m) => ({
      turnNo: m.turn_no,
      text: toSpeechText(m),
    }));
    tts.playSequence(items);
  };

  return (
    <div className="tts-toolbar">
      {!tts.isSpeaking && (
        <button className="tts-btn-main" onClick={handlePlayAll}>
          ▶ 全部読み上げ
        </button>
      )}
      {tts.isSpeaking && !tts.isPaused && (
        <button className="tts-btn-main" onClick={tts.pause}>
          ❙❙ 一時停止
        </button>
      )}
      {tts.isSpeaking && tts.isPaused && (
        <button className="tts-btn-main" onClick={tts.resume}>
          ▶ 再開
        </button>
      )}
      {tts.isSpeaking && (
        <button className="tts-btn-stop" onClick={tts.stop}>
          ■ 停止
        </button>
      )}
      {tts.voices.length > 0 && (
        <label className="tts-voice">
          ボイス
          <select
            value={tts.voiceURI ?? ''}
            onChange={(e) => tts.setVoiceURI(e.target.value || null)}
          >
            <option value="">自動（OSデフォルト）</option>
            {tts.voices.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {formatVoiceName(v)}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="tts-rate">
        速度
        <select
          value={tts.rate}
          onChange={(e) => tts.setRate(Number(e.target.value))}
        >
          {RATES.map((r) => (
            <option key={r} value={r}>
              {r.toFixed(1)}x
            </option>
          ))}
        </select>
      </label>
      {tts.isSpeaking && tts.currentTurn !== null && (
        <span className="tts-status">
          再生中: Turn {tts.currentTurn}
          {tts.isPaused && '（一時停止）'}
        </span>
      )}
    </div>
  );
}
