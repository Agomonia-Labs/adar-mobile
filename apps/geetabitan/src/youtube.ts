// Mirrors adar-core/ui/src/App.jsx's own YOUTUBE_VIDEO_URL_RE / toYouTubeEmbedUrl
// / extractYouTubeVideoUrl -- same detection logic, ported to mobile so the
// same "play a song" reply that opens a mini-player on web opens one here
// too. Kept out of @adar/shared-chat (and out of a `URL`-object-based
// implementation) on purpose: React Native's JS engine doesn't reliably
// ship a `URL`/`URLSearchParams` global without a polyfill, so this uses
// plain regexes instead, and it's Geetabitan-only so ARCL/FrontDesk never
// pull in react-native-webview.

const YOUTUBE_VIDEO_URL_RE = /https:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)[^\s)\]]+/i;
const YOUTUBE_VIDEO_ID_RE = /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([^?&\s/#)\]]+)/i;

/** First YouTube watch/short-link URL found in a reply's text, or ''. */
export function extractYouTubeVideoUrl(text: string): string {
  const match = (text || '').match(YOUTUBE_VIDEO_URL_RE);
  if (!match) return '';
  // Trailing sentence punctuation (Bangla দাঁড়ি "।" included) sometimes
  // rides along when the URL ends a markdown table cell/sentence.
  return match[0].replace(/[.,।!?]+$/, '');
}

/** youtube.com/watch or youtu.be URL -> embeddable youtube.com/embed URL, or ''. */
export function toYouTubeEmbedUrl(url: string): string {
  const match = (url || '').match(YOUTUBE_VIDEO_ID_RE);
  const videoId = match?.[1] || '';
  return videoId ? `https://www.youtube.com/embed/${videoId}?autoplay=0&rel=0&playsinline=1` : '';
}
