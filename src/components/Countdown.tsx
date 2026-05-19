import { useEffect, useState } from 'react';

interface Props {
  /** 最後の発言の created_at (Unix秒) */
  lastTurnAt: number | null;
  /** ターン間隔（秒）。15分 = 900秒 */
  intervalSec?: number;
}

const DEFAULT_INTERVAL = 15 * 60;

function format(remainSec: number): string {
  if (remainSec <= 0) return '00:00';
  const m = Math.floor(remainSec / 60).toString().padStart(2, '0');
  const s = Math.floor(remainSec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export function Countdown({ lastTurnAt, intervalSec = DEFAULT_INTERVAL }: Props) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  if (!lastTurnAt) return null;

  const nextAt = lastTurnAt + intervalSec;
  const remain = nextAt - now;
  const overdue = remain < 0;

  return (
    <span className={`countdown ${overdue ? 'overdue' : ''}`} title="次のターンが進む予定時刻">
      {overdue ? '次のターンを処理中…' : `次のターンまで ${format(remain)}`}
    </span>
  );
}
