export type ApplicationStatus = "RECEIVED" | "REVIEWING" | "TO_CONTACT" | "SHORTLISTED" | "REJECTED" | "ARCHIVED";

export const APPLICATION_STATUSES: ApplicationStatus[] = [
  "RECEIVED",
  "REVIEWING",
  "TO_CONTACT",
  "SHORTLISTED",
  "REJECTED",
  "ARCHIVED",
];

import type { ExperienceDuration, ExperienceLevel, Mobility, ProjectType, TalentCategory } from "./talentOptions.ts";

export type PhotoRole = "portrait" | "profile" | "full_length" | "extra";

export const REQUIRED_PHOTO_ROLES: PhotoRole[] = ["portrait", "profile", "full_length"];
export const MAX_EXTRA_PHOTOS = 3;

export type SubmissionLang = "fr" | "en";

/**
 * Candidature après validation serveur (validation.ts → parseApplication) :
 * chaînes nettoyées, téléphone normalisé, nombres vérifiés, listes réduites
 * aux seules valeurs autorisées. submit.ts n'écrit en D1 que cette forme —
 * jamais le corps de requête brut.
 */
export interface ValidApplication {
  lang: SubmissionLang;

  firstName: string;
  lastName: string;
  birthDate: string; // YYYY-MM-DD
  isMinor: boolean;
  city: string;
  country: string; // ISO 3166-1 alpha-2
  email: string;
  phone: string; // E.164, ex. +221771234567
  /** Renseigné uniquement si le parcours mineur est ouvert dans Sanity et que la personne est mineure. */
  guardian: { name: string; email: string; phone: string } | null;

  category: TalentCategory;
  categoryOther: string | null;
  experienceLevel: ExperienceLevel;
  experienceDuration: ExperienceDuration;
  portfolioLinks: string[];
  instagram: string | null;
  currentAgency: string | null;
  exclusivity: string | null;

  heightCm: number | null;
  chestCm: number | null;
  waistCm: number | null;
  hipsCm: number | null;
  inseamCm: number | null;
  shoeSize: number | null;
  shoeSystem: string | null;
  clothingSize: string | null;
  hairColor: string | null;
  eyeColor: string | null;

  photoIds: { role: PhotoRole; id: string }[];

  languages: string[];
  languagesOther: string | null;
  mobility: Mobility;
  desiredProjects: ProjectType[];
  motivation: string | null;

  privacyNoticeVersion: string;
}

export interface ApplicationRecord {
  id: string;
  created_at: string;
  updated_at: string;
  status: ApplicationStatus;
  first_name: string;
  last_name: string;
  birth_date: string;
  city: string;
  country: string;
  email: string;
  phone: string;
  instagram: string | null;
  languages: string | null;
  is_minor: number;
  legal_guardian_name: string | null;
  legal_guardian_email: string | null;
  legal_guardian_phone: string | null;
  height_cm: number | null;
  chest_cm: number | null;
  waist_cm: number | null;
  hips_cm: number | null;
  shoe_size: string | null;
  shoe_system: string | null;
  clothing_size: string | null;
  inseam_cm: number | null;
  hair_color: string | null;
  eye_color: string | null;
  experience_level: string;
  past_missions: string | null;
  projects_json: string | null;
  current_agency: string | null;
  exclusivity: string | null;
  portfolio_links: string | null;
  skills: string | null;
  training: string | null;
  availability: string | null;
  mobility: string | null;
  desired_projects: string | null;
  motivation: string | null;
  accuracy_confirmed: number;
  privacy_notice_version: string;
  notes: string | null;
  // migrations/0002 — nullables : absents des dossiers antérieurs.
  talent_category: string | null;
  talent_category_other: string | null;
  experience_duration: string | null;
  languages_other: string | null;
  submission_lang: string | null;
}
