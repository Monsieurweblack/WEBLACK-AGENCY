export type ApplicationStatus = "RECEIVED" | "REVIEWING" | "TO_CONTACT" | "SHORTLISTED" | "REJECTED" | "ARCHIVED";

export const APPLICATION_STATUSES: ApplicationStatus[] = [
  "RECEIVED",
  "REVIEWING",
  "TO_CONTACT",
  "SHORTLISTED",
  "REJECTED",
  "ARCHIVED",
];

export type ExperienceLevel = "beginner" | "some_experience" | "experienced" | "professional";

export const EXPERIENCE_LEVELS: ExperienceLevel[] = ["beginner", "some_experience", "experienced", "professional"];

export type PhotoRole = "portrait" | "profile" | "full_length" | "extra";

export const REQUIRED_PHOTO_ROLES: PhotoRole[] = ["portrait", "profile", "full_length"];
export const MAX_EXTRA_PHOTOS = 3;

export interface ProjectEntry {
  name: string;
  role: string;
  year: string;
}

/** Forme exacte attendue en entrée de submit.ts — tout le reste est rejeté par applyValidation(). */
export interface ApplicationPayload {
  honeypot?: string;

  firstName: string;
  lastName: string;
  birthDate: string; // YYYY-MM-DD
  city: string;
  country: string;
  email: string;
  phone: string;
  instagram?: string;
  languages?: string;

  legalGuardianName?: string;
  legalGuardianEmail?: string;
  legalGuardianPhone?: string;

  heightCm?: number;
  chestCm?: number;
  waistCm?: number;
  hipsCm?: number;
  shoeSize?: string;
  shoeSystem?: string;
  clothingSize?: string;
  inseamCm?: number;
  hairColor?: string;
  eyeColor?: string;

  experienceLevel: ExperienceLevel;
  pastMissions?: string;
  projects?: ProjectEntry[];
  currentAgency?: string;
  exclusivity?: string;
  portfolioLinks?: string;
  skills?: string;
  training?: string;

  photoIds: Record<PhotoRole, string[]>;

  availability?: string;
  mobility?: string;
  desiredProjects?: string;
  motivation?: string;

  accuracyConfirmed: boolean;
  privacyNoticeAccepted: boolean;
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
}
