/**
 * Cloudflare Turnstile widget (managed mode).
 * VITE_TURNSTILE_SITE_KEY をビルド時 env から読む。
 *
 * 使い方:
 *   const ref = useRef<TurnstileHandle>(null);
 *   <TurnstileWidget ref={ref} />
 *   const token = await ref.current?.getToken();  // 投票ボタン押下時
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

declare global {
  interface Window {
    turnstile?: {
      render(container: HTMLElement, options: TurnstileOptions): string;
      remove(widgetId: string): void;
      reset(widgetId: string): void;
      getResponse(widgetId: string): string | undefined;
      execute(widgetId: string): void;
    };
  }
}

interface TurnstileOptions {
  sitekey: string;
  callback?: (token: string) => void;
  'error-callback'?: () => void;
  'expired-callback'?: () => void;
  'timeout-callback'?: () => void;
  theme?: 'light' | 'dark' | 'auto';
  size?: 'normal' | 'compact' | 'invisible' | 'flexible';
  language?: string;
  action?: string;
}

export interface TurnstileHandle {
  /** トークンを取得（未取得なら最大10秒待つ）。失敗時 null。 */
  getToken: (timeoutMs?: number) => Promise<string | null>;
  /** 検証成功後にウィジェットをリセット（次の投票用に新トークンを発行）。 */
  reset: () => void;
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
let scriptLoadingPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (scriptLoadingPromise) return scriptLoadingPromise;
  scriptLoadingPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src^="${SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('turnstile script failed')));
      return;
    }
    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('turnstile script failed'));
    document.head.appendChild(s);
  });
  return scriptLoadingPromise;
}

export const TurnstileWidget = forwardRef<TurnstileHandle, { className?: string }>(
  function TurnstileWidget({ className }, ref) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const widgetIdRef = useRef<string | null>(null);
    const tokenRef = useRef<string | null>(null);
    const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'disabled'>('loading');

    const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

    useEffect(() => {
      if (!siteKey) {
        setStatus('disabled');
        return;
      }
      let cancelled = false;
      loadTurnstileScript()
        .then(() => {
          if (cancelled || !containerRef.current || !window.turnstile) return;
          widgetIdRef.current = window.turnstile.render(containerRef.current, {
            sitekey: siteKey,
            theme: 'dark',
            size: 'flexible',
            language: 'ja',
            action: 'vote',
            callback: (token: string) => {
              tokenRef.current = token;
              setStatus('ready');
            },
            'error-callback': () => setStatus('error'),
            'expired-callback': () => {
              tokenRef.current = null;
              setStatus('loading');
            },
            'timeout-callback': () => {
              tokenRef.current = null;
              setStatus('loading');
            },
          });
        })
        .catch(() => setStatus('error'));
      return () => {
        cancelled = true;
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.remove(widgetIdRef.current);
          widgetIdRef.current = null;
        }
      };
    }, [siteKey]);

    const getToken = useCallback(async (timeoutMs = 10000): Promise<string | null> => {
      if (status === 'disabled') return null;
      if (tokenRef.current) return tokenRef.current;
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (tokenRef.current) return tokenRef.current;
        await new Promise((r) => setTimeout(r, 200));
      }
      return null;
    }, [status]);

    const reset = useCallback(() => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.reset(widgetIdRef.current);
        tokenRef.current = null;
        setStatus('loading');
      }
    }, []);

    useImperativeHandle(ref, () => ({ getToken, reset }), [getToken, reset]);

    if (status === 'disabled') {
      return (
        <p className="turnstile-disabled">
          投票には Turnstile が必要です（VITE_TURNSTILE_SITE_KEY 未設定）
        </p>
      );
    }

    return <div ref={containerRef} className={className ?? 'turnstile-widget'} />;
  },
);
