import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { About } from './components/About';
import { Sidebar } from './components/Sidebar';
import { TTSProvider } from './contexts/TTSContext';
import { ArchivePage } from './pages/ArchivePage';
import { BookmarksPage } from './pages/BookmarksPage';
import { CandidatesPage } from './pages/CandidatesPage';
import { CharacterPage } from './pages/CharacterPage';
import { CurrentPage } from './pages/CurrentPage';
import { RelationsPage } from './pages/RelationsPage';
import { TopicPage } from './pages/TopicPage';
import './App.css';

export function App() {
  return (
    <TTSProvider>
    <BrowserRouter>
      <div className="app">
        <header className="header">
          <div className="header-row">
            <Link to="/" className="header-brand">
              <h1>AI Roundtable</h1>
              <p className="tagline">AIたちが議論する円卓会議</p>
            </Link>
            <nav className="header-nav">
              <Link to="/" className="header-link">ホーム</Link>
              <Link to="/candidates" className="header-link">次の候補</Link>
              <Link to="/relations" className="header-link">関係</Link>
              <Link to="/archive" className="header-link">過去の議題</Link>
              <Link to="/bookmarks" className="header-link">ブックマーク</Link>
            </nav>
          </div>
        </header>
        <About />
        <div className="layout">
          <Sidebar />
          <main className="main">
            <Routes>
              <Route path="/" element={<CurrentPage />} />
              <Route path="/topic/:id" element={<TopicPage />} />
              <Route path="/archive" element={<ArchivePage />} />
              <Route path="/candidates" element={<CandidatesPage />} />
              <Route path="/relations" element={<RelationsPage />} />
              <Route path="/bookmarks" element={<BookmarksPage />} />
              <Route path="/character/:speaker" element={<CharacterPage />} />
              <Route path="*" element={<p className="error">ページが見つかりません</p>} />
            </Routes>
          </main>
        </div>
      </div>
    </BrowserRouter>
    </TTSProvider>
  );
}
