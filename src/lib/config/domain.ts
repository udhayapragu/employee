/** Canonical Indian states and union territories. Stored and filtered by these exact names. */
export const INDIAN_STATES = [
  "Andaman and Nicobar Islands",
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chandigarh",
  "Chhattisgarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jammu and Kashmir",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Ladakh",
  "Lakshadweep",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Puducherry",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
] as const;

export type IndianState = (typeof INDIAN_STATES)[number];

export const PRODUCT_CATEGORIES = [
  { slug: "textiles", label: "Textiles & Yarn" },
  { slug: "garments", label: "Garments & Apparel" },
  { slug: "food-processing", label: "Food Processing" },
  { slug: "spices", label: "Spices & Condiments" },
  { slug: "edible-oils", label: "Edible Oils" },
  { slug: "dairy-products", label: "Dairy Products" },
  { slug: "plastics", label: "Plastic Products" },
  { slug: "packaging", label: "Packaging Materials" },
  { slug: "steel-fabrication", label: "Steel & Fabrication" },
  { slug: "engineering-goods", label: "Engineering Goods" },
  { slug: "auto-components", label: "Auto Components" },
  { slug: "electronics", label: "Electronics & Electricals" },
  { slug: "furniture", label: "Furniture" },
  { slug: "leather-goods", label: "Leather Goods" },
  { slug: "footwear", label: "Footwear" },
  { slug: "cosmetics", label: "Cosmetics & Personal Care" },
  { slug: "chemicals", label: "Chemicals" },
  { slug: "paper-products", label: "Paper Products" },
  { slug: "ceramics", label: "Ceramics & Tiles" },
  { slug: "building-materials", label: "Building Materials" },
  { slug: "handicrafts", label: "Handicrafts" },
  { slug: "agri-equipment", label: "Agricultural Equipment" },
] as const;

export type ProductCategorySlug = (typeof PRODUCT_CATEGORIES)[number]["slug"];

export function categoryLabel(slug: string): string {
  return PRODUCT_CATEGORIES.find((category) => category.slug === slug)?.label ?? slug;
}

export const OUTREACH_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "ta", label: "Tamil" },
  { code: "hi", label: "Hindi" },
  { code: "te", label: "Telugu" },
  { code: "ml", label: "Malayalam" },
] as const;

export type OutreachLanguage = (typeof OUTREACH_LANGUAGES)[number]["code"];

export const OUTREACH_CHANNELS = ["email", "whatsapp", "call_script"] as const;
export type OutreachChannel = (typeof OUTREACH_CHANNELS)[number];

export const VERIFICATION_STATUSES = ["unverified", "needs_review", "verified", "synthetic"] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const LEAD_STATUSES = [
  "discovered",
  "needs_review",
  "verified",
  "contact_ready",
  "outreach_approved",
  "contacted",
  "replied",
  "interested",
  "registration_started",
  "registered",
  "subscription_active",
  "not_interested",
  "opted_out",
  "archived",
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const TASK_STATUSES = ["queued", "running", "awaiting_approval", "completed", "failed", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Resolves user input to a canonical state name, ignoring case and extra spaces. Returns null if unknown. */
export function resolveIndianState(input: string): IndianState | null {
  const wanted = input.trim().replace(/\s+/g, " ").toLowerCase();
  return INDIAN_STATES.find((state) => state.toLowerCase() === wanted) ?? null;
}

export function isCategorySlug(value: string): value is ProductCategorySlug {
  return PRODUCT_CATEGORIES.some((category) => category.slug === value);
}
