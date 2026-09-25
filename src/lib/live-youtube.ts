/**
 * La seule chose que ce module fait : demander à l'endpoint oEmbed public
 * de YouTube (https://www.youtube.com/oembed) si une vidéo existe
 * réellement et reste consultable. Public, sans clé, sans authentification
 * — ce n'est ni un contournement ni un usage détourné de l'API officielle.
 *
 * Ça ne dit PAS si une diffusion est en direct : oEmbed ne porte aucune
 * information de statut de diffusion. Ça sert uniquement de garde-fou côté
 * build (Phase 19/20) : un `youtubeVideoId` invalide, supprimé ou rendu
 * privé ne doit jamais produire une page avec un player cassé.
 */

export interface YoutubeOembedResult {
  available: boolean;
  title?: string;
  authorName?: string;
  thumbnailUrl?: string;
}

export async function checkYoutubeVideo(videoId: string): Promise<YoutubeOembedResult> {
  if (!videoId.trim()) return { available: false };
  try {
    const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`;
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return { available: false };
    const data = (await response.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
    return { available: true, title: data.title, authorName: data.author_name, thumbnailUrl: data.thumbnail_url };
  } catch {
    return { available: false };
  }
}
