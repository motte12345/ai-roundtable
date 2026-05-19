interface ShareLinks {
  x: string;
  line: string;
  threads: string;
}

export function shareLinks(text: string, url: string): ShareLinks {
  const t = encodeURIComponent(text);
  const u = encodeURIComponent(url);
  return {
    x: `https://twitter.com/intent/tweet?text=${t}&url=${u}`,
    line: `https://social-plugins.line.me/lineit/share?url=${u}&text=${t}`,
    threads: `https://www.threads.net/intent/post?text=${t}%20${u}`,
  };
}
