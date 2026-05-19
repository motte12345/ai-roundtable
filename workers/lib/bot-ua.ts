/**
 * SNS / 検索エンジン等のクローラの User-Agent を判定する。
 * クローラ向けには動的OGPメタタグ入りのHTMLを返したい。
 */

const BOT_PATTERNS = [
  /Twitterbot/i,
  /facebookexternalhit/i,
  /facebookcatalog/i,
  /LinkedInBot/i,
  /Slackbot/i,
  /Discordbot/i,
  /TelegramBot/i,
  /WhatsApp/i,
  /Pinterestbot/i,
  /Applebot/i,
  /redditbot/i,
  /Googlebot/i,
  /bingbot/i,
  /DuckDuckBot/i,
  /YandexBot/i,
  /Baiduspider/i,
  /Bytespider/i,
  /SemrushBot/i,
  /AhrefsBot/i,
  /Mastodon/i,
  /Misskey/i,
  /Bluesky/i,
  /Embedly/i,
  /Iframely/i,
];

export function isBot(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  return BOT_PATTERNS.some((p) => p.test(userAgent));
}
