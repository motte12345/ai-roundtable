import { useEffect, useState } from 'react';
import { bookmarks } from '../utils/bookmarks';

interface Props {
  topicId: number;
  turnNo: number;
}

export function BookmarkButton({ topicId, turnNo }: Props) {
  const [marked, setMarked] = useState(false);

  useEffect(() => {
    setMarked(bookmarks.has(topicId, turnNo));
  }, [topicId, turnNo]);

  const toggle = () => {
    const next = bookmarks.toggle(topicId, turnNo);
    setMarked(next);
  };

  return (
    <button
      type="button"
      className={`bookmark-btn ${marked ? 'on' : ''}`}
      onClick={toggle}
      title={marked ? 'ブックマーク解除' : 'ブックマーク'}
      aria-label={marked ? 'ブックマーク解除' : 'ブックマーク'}
    >
      {marked ? '★' : '☆'}
    </button>
  );
}
