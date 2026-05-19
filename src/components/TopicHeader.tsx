import type { Topic } from '../types';

interface Props {
  topic: Topic;
  total?: number;
}

export function TopicHeader({ topic, total = 11 }: Props) {
  const turn = topic.current_turn;
  return (
    <div className="topic-bar">
      <div className="topic-no">Topic #{topic.id}</div>
      <div className="topic-title">「{topic.title}」</div>
      <div className="turn-gauge">
        {Array.from({ length: total }).map((_, i) => (
          <span key={i} className={`tick ${i < turn ? 'on' : ''}`} />
        ))}
        <span className="turn-label">{turn}/{total}</span>
        {topic.status === 'active' && <span className="status-pill active">進行中</span>}
        {topic.status === 'completed' && <span className="status-pill completed">完了</span>}
      </div>
    </div>
  );
}
