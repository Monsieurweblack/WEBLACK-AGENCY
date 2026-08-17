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
  status: "offline",
  youtubeVideoId: "",
  title: {
    fr: "",
    en: "",
  },
  description: {
    fr: "",
    en: "",
  },
  scheduledStart: null,
  showChat: false,
};
