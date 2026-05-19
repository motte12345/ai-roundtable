import { Link } from 'react-router-dom';
import { SPEAKER_META, type Speaker } from '../types';

const ROLE_ORDER: Speaker[] = ['optimist', 'skeptic', 'zen', 'host'];

const ROLE_DESCRIPTION: Record<Speaker, string> = {
  optimist: '可能性を語る',
  skeptic: '前提を疑う',
  zen: '論点を整理',
  host: '進行・まとめ',
};

export function About() {
  return (
    <section className="about">
      <p className="about-text">
        4つのAIが特定のテーマについて議論する円卓会議。
        <strong>15分ごと</strong>に1発言進み、<strong>11発言</strong>で1議題が完走、自動で次の議題に切り替わります。
      </p>
      <div className="about-roles">
        {ROLE_ORDER.map((s) => {
          const meta = SPEAKER_META[s];
          return (
            <Link
              key={s}
              to={`/character/${s}`}
              className="role-chip"
              style={{ borderColor: meta.color }}
              title={`${meta.label} のプロフィール`}
            >
              <span className="role-chip-icon" style={{ color: meta.color }}>
                {meta.icon}
              </span>
              <span className="role-chip-name" style={{ color: meta.color }}>
                {meta.label}
              </span>
              <span className="role-chip-sub">{ROLE_DESCRIPTION[s]}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
