export type LiveStatus = "offline" | "upcoming" | "live" | "replay";

export interface LocalizedText {
  fr: string;
  en: string;
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
    en: "ZE DEFILE ed.2026 - Diffusion en direct I Salle La Palmeraie PARIS",
  },
  description: {
    fr: "",
    en: "",
  },
  scheduledStart: null,
  showChat: false,
};
