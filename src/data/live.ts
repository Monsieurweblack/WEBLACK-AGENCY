import { defaultLang, type Lang } from "../i18n/utils";

export type LiveStatus = "offline" | "upcoming" | "live" | "replay";

export interface LocalizedText {
  fr: string;
  en: string;
  nb?: string;
  zh?: string;
}

/** Falls back to the default locale when this text hasn't been written for `lang` yet. */
export function localizedText(text: LocalizedText, lang: Lang): string {
  return text[lang] ?? text[defaultLang];
}

export interface LiveEventConfig {
  status: LiveStatus;
  youtubeVideoId: string;
  title: LocalizedText;
  description: LocalizedText;
  /** ISO datetime string, display/countdown only — never used to derive status. */
  scheduledStart: string | null;
  showChat: boolean;
}

/**
 * Single source of truth for the /live page. Edit this object directly to
 * publish, schedule, or retire a broadcast — no CMS involved.
 */
export const liveEvent: LiveEventConfig = {
  status: "replay",
  youtubeVideoId: "Kcs4n93lS60",
  title: {
    fr: "ZE DEFILE ed.2026 - Diffusion en direct I Salle La Palmeraie PARIS",
    en: "ZE DEFILE ed.2026 - Live Broadcast I Salle La Palmeraie PARIS",
  },
  description: {
    fr: "",
    en: "",
  },
  scheduledStart: null,
  showChat: false,
};
