export const CONTACT_EMAIL = "weblackconsulting@gmail.com";

/** The six-profile contact segmentation — single source of truth. Referenced by /contact (the picker itself) and WorkWithPicker.astro (the header entry point into the same picker), never redefined at either call site. */
export const CONTACT_SEGMENTS = ["talent", "brand", "creative", "partner", "media", "other"] as const;
