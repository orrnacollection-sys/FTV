export const MODELS = ["FTV", "OR", "FTV_NORETURN"] as const;
export type Model = (typeof MODELS)[number];

export const MODEL_LABELS: Record<Model, string> = {
  FTV: "FTV",
  OR: "OR",
  FTV_NORETURN: "FTV-NORETURN",
};

export const VENDOR_STATUSES = ["ACTIVE", "INACTIVE", "PENDING"] as const;
export type VendorStatus = (typeof VENDOR_STATUSES)[number];

export const CUSTOMER_STATUSES = ["ACTIVE", "INACTIVE", "SUSPENDED"] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

/** Pricing tier — drives the price book lookup at invoicing. SKU-level
 *  per-tier rates land with the Tax Master / Price Book module (#94). */
export const PRICE_TIERS = ["RETAIL", "WHOLESALE", "DISTRIBUTOR", "MARKETPLACE"] as const;
export type PriceTier = (typeof PRICE_TIERS)[number];

export const PRICE_TIER_LABELS: Record<PriceTier, string> = {
  RETAIL: "Retail",
  WHOLESALE: "Wholesale",
  DISTRIBUTOR: "Distributor",
  MARKETPLACE: "Marketplace",
};

/**
 * GST registration types — the *party* attribute (Customer or Vendor), not
 * the *transaction* classification. Drives:
 *   - B2B vs B2C classification on GSTR-1 (Customer side)
 *   - ITC eligibility on purchases (Vendor side — composition vendors
 *     can't issue ITC-eligible invoices)
 */
export const GST_REG_TYPES = [
  "UNREGISTERED",
  "REGULAR",
  "COMPOSITION",
  "SEZ_UNIT",
  "SEZ_DEVELOPER",
  "UIN_HOLDER",
] as const;
export type GstRegType = (typeof GST_REG_TYPES)[number];

export const GST_REG_TYPE_LABELS: Record<GstRegType, string> = {
  UNREGISTERED: "Unregistered (no GSTIN)",
  REGULAR: "Regular (standard taxable)",
  COMPOSITION: "Composition Dealer",
  SEZ_UNIT: "SEZ Unit",
  SEZ_DEVELOPER: "SEZ Developer",
  UIN_HOLDER: "UIN Holder (UN/Embassy)",
};

/** Reg types that translate to B2B on GSTR-1 (i.e. registered customers
 *  with a GSTIN that can claim ITC on what they buy from you). */
export const B2B_GST_REG_TYPES: readonly GstRegType[] = [
  "REGULAR", "COMPOSITION", "SEZ_UNIT", "SEZ_DEVELOPER", "UIN_HOLDER",
];

export function isB2BRegType(t: string | null | undefined): boolean {
  if (!t) return false;
  return (B2B_GST_REG_TYPES as readonly string[]).includes(t);
}

/** Tax supply-type markers. Four ways an invoice line can show "0% GST"
 *  on paper but route to different GSTR-1 rows + carry different ITC
 *  consequences. */
export const TAX_SUPPLY_TYPES = ["REGULAR", "ZERO_RATED", "NIL_RATED", "EXEMPT", "NON_GST"] as const;
export type TaxSupplyType = (typeof TAX_SUPPLY_TYPES)[number];

export const TAX_SUPPLY_TYPE_LABELS: Record<TaxSupplyType, string> = {
  REGULAR: "Regular (taxable)",
  ZERO_RATED: "Zero-rated (exports / SEZ)",
  NIL_RATED: "Nil-rated (0% by notification)",
  EXEMPT: "Exempt (no GST, no ITC)",
  NON_GST: "Non-GST (outside scope)",
};

/** Canonical GST slabs. Allow ad-hoc rates in the form (e.g. 0.25, 1, 3)
 *  but suggest these in the dropdown. */
export const GST_SLABS = [0, 0.25, 1, 3, 5, 12, 18, 28] as const;

/** Indian Union Territories — used by the tax resolver to pick UTGST
 *  over SGST on intra-UT supply. Subset of INDIAN_STATES.values. */
export const UNION_TERRITORIES = [
  "Andaman and Nicobar Islands",
  "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Jammu and Kashmir",
  "Ladakh",
  "Lakshadweep",
  "Puducherry",
] as const;
export type UnionTerritory = (typeof UNION_TERRITORIES)[number];

export function isUnionTerritory(state: string | null | undefined): boolean {
  if (!state) return false;
  return (UNION_TERRITORIES as readonly string[]).includes(state);
}

export const ROLES = ["ADMIN", "VENDOR_ADMIN", "VENDOR_USER"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Admin",
  VENDOR_ADMIN: "Vendor Admin",
  VENDOR_USER: "Vendor User",
};

export const VENDOR_ROLES: Role[] = ["VENDOR_ADMIN", "VENDOR_USER"];

export function isAdminRole(role: string | null | undefined): boolean {
  return role === "ADMIN";
}

export function isVendorRole(role: string | null | undefined): boolean {
  return role === "VENDOR_ADMIN" || role === "VENDOR_USER";
}

// ORG constant removed in #96 — the operating company now lives in the
// `Company` table. Read it via `getActiveCompany()` from `@/lib/company`.
// Seed creates the Adwitiya row idempotently.

/**
 * Canonical list of Indian states + union territories used by Vendor and
 * Warehouse address dropdowns. Match the labels used by the GST portal so
 * IGST / CGST routing later just compares strings.
 */
export const INDIAN_STATES = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
  // Union Territories
  "Andaman and Nicobar Islands",
  "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Jammu and Kashmir",
  "Ladakh",
  "Lakshadweep",
  "Puducherry",
] as const;
export type IndianState = (typeof INDIAN_STATES)[number];

/** 6-digit Indian pincode, first digit 1-9. */
export const PINCODE_REGEX = /^[1-9][0-9]{5}$/;

/** Official GST state codes — first 2 digits of a GSTIN. Used to derive
 *  Place of Supply on GSTR-1 + intra/inter-state classification. State
 *  names here match INDIAN_STATES exactly. */
export const GST_STATE_CODES: Record<string, string> = {
  "Jammu and Kashmir": "01",
  "Himachal Pradesh": "02",
  "Punjab": "03",
  "Chandigarh": "04",
  "Uttarakhand": "05",
  "Haryana": "06",
  "Delhi": "07",
  "Rajasthan": "08",
  "Uttar Pradesh": "09",
  "Bihar": "10",
  "Sikkim": "11",
  "Arunachal Pradesh": "12",
  "Nagaland": "13",
  "Manipur": "14",
  "Mizoram": "15",
  "Tripura": "16",
  "Meghalaya": "17",
  "Assam": "18",
  "West Bengal": "19",
  "Jharkhand": "20",
  "Odisha": "21",
  "Chhattisgarh": "22",
  "Madhya Pradesh": "23",
  "Gujarat": "24",
  "Dadra and Nagar Haveli and Daman and Diu": "26",
  "Maharashtra": "27",
  "Karnataka": "29",
  "Goa": "30",
  "Lakshadweep": "31",
  "Kerala": "32",
  "Tamil Nadu": "33",
  "Puducherry": "34",
  "Andaman and Nicobar Islands": "35",
  "Telangana": "36",
  "Andhra Pradesh": "37",
  "Ladakh": "38",
};

/** Get the 2-digit GSTIN state code for a state name. Returns null if
 *  the state is unknown. The state code is what GSTR-1 expects for
 *  Place of Supply. */
export function getGstStateCode(state: string | null | undefined): string | null {
  if (!state) return null;
  return GST_STATE_CODES[state.trim()] ?? null;
}

/** Inverse — given a 2-digit code, return the state name. */
export function getStateFromGstCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const c = code.padStart(2, "0");
  for (const [name, sc] of Object.entries(GST_STATE_CODES)) {
    if (sc === c) return name;
  }
  return null;
}

/**
 * ISO 3166-1 short names. India is pinned at the top because 99%+ of vendors
 * and warehouses are Indian — saves a long scroll on the common case. The
 * remainder follows alphabetical order. Use `DEFAULT_COUNTRY` ("India") as
 * the new-record default.
 */
export const DEFAULT_COUNTRY = "India" as const;

export const COUNTRIES = [
  "India",
  "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Antigua and Barbuda",
  "Argentina", "Armenia", "Australia", "Austria", "Azerbaijan",
  "Bahamas", "Bahrain", "Bangladesh", "Barbados", "Belarus", "Belgium",
  "Belize", "Benin", "Bhutan", "Bolivia", "Bosnia and Herzegovina", "Botswana",
  "Brazil", "Brunei", "Bulgaria", "Burkina Faso", "Burundi",
  "Cabo Verde", "Cambodia", "Cameroon", "Canada", "Central African Republic",
  "Chad", "Chile", "China", "Colombia", "Comoros", "Congo",
  "Congo (Democratic Republic)", "Costa Rica", "Côte d'Ivoire", "Croatia", "Cuba",
  "Cyprus", "Czech Republic",
  "Denmark", "Djibouti", "Dominica", "Dominican Republic",
  "Ecuador", "Egypt", "El Salvador", "Equatorial Guinea", "Eritrea", "Estonia",
  "Eswatini", "Ethiopia",
  "Fiji", "Finland", "France",
  "Gabon", "Gambia", "Georgia", "Germany", "Ghana", "Greece", "Grenada",
  "Guatemala", "Guinea", "Guinea-Bissau", "Guyana",
  "Haiti", "Honduras", "Hungary",
  "Iceland", "Indonesia", "Iran", "Iraq", "Ireland", "Israel", "Italy",
  "Jamaica", "Japan", "Jordan",
  "Kazakhstan", "Kenya", "Kiribati", "Kuwait", "Kyrgyzstan",
  "Laos", "Latvia", "Lebanon", "Lesotho", "Liberia", "Libya", "Liechtenstein",
  "Lithuania", "Luxembourg",
  "Madagascar", "Malawi", "Malaysia", "Maldives", "Mali", "Malta",
  "Marshall Islands", "Mauritania", "Mauritius", "Mexico", "Micronesia",
  "Moldova", "Monaco", "Mongolia", "Montenegro", "Morocco", "Mozambique", "Myanmar",
  "Namibia", "Nauru", "Nepal", "Netherlands", "New Zealand", "Nicaragua",
  "Niger", "Nigeria", "North Korea", "North Macedonia", "Norway",
  "Oman",
  "Pakistan", "Palau", "Palestine", "Panama", "Papua New Guinea", "Paraguay",
  "Peru", "Philippines", "Poland", "Portugal",
  "Qatar",
  "Romania", "Russia", "Rwanda",
  "Saint Kitts and Nevis", "Saint Lucia", "Saint Vincent and the Grenadines",
  "Samoa", "San Marino", "São Tomé and Príncipe", "Saudi Arabia", "Senegal",
  "Serbia", "Seychelles", "Sierra Leone", "Singapore", "Slovakia", "Slovenia",
  "Solomon Islands", "Somalia", "South Africa", "South Korea", "South Sudan",
  "Spain", "Sri Lanka", "Sudan", "Suriname", "Sweden", "Switzerland", "Syria",
  "Taiwan", "Tajikistan", "Tanzania", "Thailand", "Timor-Leste", "Togo",
  "Tonga", "Trinidad and Tobago", "Tunisia", "Türkiye", "Turkmenistan", "Tuvalu",
  "Uganda", "Ukraine", "United Arab Emirates", "United Kingdom", "United States",
  "Uruguay", "Uzbekistan",
  "Vanuatu", "Vatican City", "Venezuela", "Vietnam",
  "Yemen",
  "Zambia", "Zimbabwe",
] as const;
export type Country = (typeof COUNTRIES)[number];

/**
 * Warehouse ownership type. OWN = Adwitiya operates it. THIRD_PARTY = a
 * vendor's consignment location (vendorId required, validated server-side).
 */
export const WAREHOUSE_TYPES = ["OWN", "THIRD_PARTY"] as const;
export type WarehouseType = (typeof WAREHOUSE_TYPES)[number];

export const WAREHOUSE_TYPE_LABELS: Record<WarehouseType, string> = {
  OWN: "Own (Adwitiya)",
  THIRD_PARTY: "Third-party (Vendor consignment)",
};
