/**
 * 読み上げコンテキスト（HTMLAudio + Web Speech API のハイブリッド）。
 *
 * - 各キューアイテムに audioPath があれば <audio> でニューラル MP3 を再生（高品質）
 * - audioPath が無ければ Web Speech API でブラウザネイティブ TTS（フォールバック）
 *
 * 議題完了に至っていないターンや R2 生成が間に合っていない場合は自動的に Web Speech に倒れる。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

interface QueueItem {
  turnNo: number;
  text: string;
  audioPath?: string | null;
}

interface TTSState {
  currentTurn: number | null;
  isSpeaking: boolean;
  isPaused: boolean;
  isAvailable: boolean;
  rate: number;
  setRate: (r: number) => void;
  voices: SpeechSynthesisVoice[];
  voiceURI: string | null;
  setVoiceURI: (uri: string | null) => void;
  playSingle: (turnNo: number, text: string, audioPath?: string | null) => void;
  playSequence: (items: QueueItem[]) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
}

const TTSCtx = createContext<TTSState | null>(null);

export function useTTS(): TTSState {
  const v = useContext(TTSCtx);
  if (!v) throw new Error('useTTS must be used within TTSProvider');
  return v;
}

const RATE_KEY = 'ai-roundtable:tts:rate';
const VOICE_KEY = 'ai-roundtable:tts:voiceURI';

function loadRate(): number {
  try {
    const raw = localStorage.getItem(RATE_KEY);
    if (raw) {
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 0.5 && n <= 2.0) return n;
    }
  } catch {
    /* ignore */
  }
  return 1.1;
}

function loadVoiceURI(): string | null {
  try {
    return localStorage.getItem(VOICE_KEY);
  } catch {
    return null;
  }
}

export function TTSProvider({ children }: { children: ReactNode }) {
  const [currentTurn, setCurrentTurn] = useState<number | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [rate, setRateState] = useState<number>(() => loadRate());
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceURI, setVoiceURIState] = useState<string | null>(() => loadVoiceURI());
  const queueRef = useRef<QueueItem[]>([]);
  const rateRef = useRef(rate);
  const voiceURIRef = useRef<string | null>(voiceURI);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  const isAvailable =
    typeof window !== 'undefined' && 'speechSynthesis' in window;

  // 利用可能ボイス一覧を取得（一部ブラウザでは非同期で voiceschanged 後に揃う）
  useEffect(() => {
    if (!isAvailable) return;
    const refresh = () => {
      const all = window.speechSynthesis.getVoices();
      const ja = all.filter((v) => v.lang.toLowerCase().startsWith('ja'));
      // 日本語ボイスがなければ全体を出す
      setVoices(ja.length > 0 ? ja : all);
    };
    refresh();
    window.speechSynthesis.addEventListener('voiceschanged', refresh);
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', refresh);
    };
  }, [isAvailable]);

  useEffect(() => {
    voiceURIRef.current = voiceURI;
    try {
      if (voiceURI) localStorage.setItem(VOICE_KEY, voiceURI);
      else localStorage.removeItem(VOICE_KEY);
    } catch {
      /* ignore */
    }
  }, [voiceURI]);

  const setVoiceURI = useCallback((uri: string | null) => {
    setVoiceURIState(uri);
  }, []);

  const applySelectedVoice = useCallback((u: SpeechSynthesisUtterance) => {
    const uri = voiceURIRef.current;
    if (!uri) return;
    const voice = window.speechSynthesis.getVoices().find((v) => v.voiceURI === uri);
    if (voice) u.voice = voice;
  }, []);

  useEffect(() => {
    rateRef.current = rate;
    try {
      localStorage.setItem(RATE_KEY, String(rate));
    } catch {
      /* ignore */
    }
    // 既存の <audio> にも速度反映
    if (audioElRef.current) {
      audioElRef.current.playbackRate = rate;
    }
  }, [rate]);

  const setRate = useCallback((r: number) => setRateState(r), []);

  // 内部停止: HTMLAudio と SpeechSynthesis の両方をキャンセル
  const cancelPlayback = useCallback(() => {
    if (audioElRef.current) {
      audioElRef.current.onended = null;
      audioElRef.current.onerror = null;
      audioElRef.current.pause();
      audioElRef.current.src = '';
      audioElRef.current = null;
    }
    if (typeof window !== 'undefined') {
      window.speechSynthesis.cancel();
    }
  }, []);

  // forwarded ref のために `next` の参照を一旦持ちつつ再帰的に呼ぶ
  const speakNextRef = useRef<() => void>(() => {});

  const playWithSpeech = useCallback((item: QueueItem) => {
    const u = new SpeechSynthesisUtterance(item.text);
    u.lang = 'ja-JP';
    u.rate = rateRef.current;
    applySelectedVoice(u);
    u.onend = () => {
      speakNextRef.current();
    };
    u.onerror = (e) => {
      if (e.error !== 'canceled' && e.error !== 'interrupted') {
        console.warn('[tts] speech error:', e.error);
      }
      setCurrentTurn(null);
      setIsPaused(false);
    };
    setCurrentTurn(item.turnNo);
    setIsPaused(false);
    window.speechSynthesis.speak(u);
  }, [applySelectedVoice]);

  const speakNext = useCallback(() => {
    const next = queueRef.current.shift();
    if (!next) {
      setCurrentTurn(null);
      setIsPaused(false);
      return;
    }
    // audio_path 経路は MeloTTS 品質問題のため当面オフ。常に Web Speech で再生する。
    playWithSpeech(next);
  }, [playWithSpeech]);

  // ref に最新を反映
  useEffect(() => {
    speakNextRef.current = speakNext;
  }, [speakNext]);

  const stop = useCallback(() => {
    queueRef.current = [];
    cancelPlayback();
    setCurrentTurn(null);
    setIsPaused(false);
  }, [cancelPlayback]);

  const playSingle = useCallback(
    (turnNo: number, text: string, audioPath?: string | null) => {
      stop();
      queueRef.current = [{ turnNo, text, audioPath }];
      speakNext();
    },
    [stop, speakNext],
  );

  const playSequence = useCallback(
    (items: QueueItem[]) => {
      stop();
      queueRef.current = [...items];
      speakNext();
    },
    [stop, speakNext],
  );

  const pause = useCallback(() => {
    if (audioElRef.current && !audioElRef.current.paused) {
      audioElRef.current.pause();
      setIsPaused(true);
      return;
    }
    if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
      window.speechSynthesis.pause();
      setIsPaused(true);
    }
  }, []);

  const resume = useCallback(() => {
    if (audioElRef.current && audioElRef.current.paused) {
      void audioElRef.current.play().catch(() => {});
      setIsPaused(false);
      return;
    }
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
      setIsPaused(false);
    }
  }, []);

  // ページ離脱時に必ず止める
  useEffect(() => {
    return () => {
      cancelPlayback();
    };
  }, [cancelPlayback]);

  const value: TTSState = {
    currentTurn,
    isSpeaking: currentTurn !== null,
    isPaused,
    isAvailable,
    rate,
    setRate,
    voices,
    voiceURI,
    setVoiceURI,
    playSingle,
    playSequence,
    pause,
    resume,
    stop,
  };

  return <TTSCtx.Provider value={value}>{children}</TTSCtx.Provider>;
}
