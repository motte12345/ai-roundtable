import { shareLinks } from '../utils/share';

interface Props {
  text: string;
  url: string;
}

export function ShareButtons({ text, url }: Props) {
  const links = shareLinks(text, url);
  return (
    <div className="share-buttons">
      <span className="share-label">シェア</span>
      <a className="share-btn share-x" href={links.x} target="_blank" rel="noopener noreferrer" title="X でシェア">
        X
      </a>
      <a className="share-btn share-line" href={links.line} target="_blank" rel="noopener noreferrer" title="LINE でシェア">
        LINE
      </a>
      <a className="share-btn share-threads" href={links.threads} target="_blank" rel="noopener noreferrer" title="Threads でシェア">
        Threads
      </a>
    </div>
  );
}
