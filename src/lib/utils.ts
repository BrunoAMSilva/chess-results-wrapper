/**
 * Reverses "Last, First" or "LAST First" name format to "First Last".
 * Handles both comma-separated ("SILVA, Bruno") and
 * space-separated with uppercase last name ("SILVA Bruno").
 */
export function reverseName(name: string): string {
  if (!name) return name;

  // Case 1: Comma-separated "Last, First"
  if (name.includes(",")) {
    const [last, ...rest] = name.split(",");
    return `${rest.join(",").trim()} ${last.trim()}`;
  }

  // Case 2: Uppercase last name(s) followed by mixed-case first name
  // e.g. "MARTINEZ RAMIREZ Lennis" or "FONTELAS Diogo Rebelo"
  const words = name.split(/\s+/);
  if (words.length < 2) return name;

  // Find where the uppercase last name ends and first name begins
  const isUpperWord = (w: string) => w === w.toUpperCase() && /[A-ZÀ-Ý]/.test(w);
  let splitIdx = words.findIndex((w, i) => i > 0 && !isUpperWord(w));

  if (splitIdx <= 0) return name; // All uppercase or can't detect split

  const lastName = words.slice(0, splitIdx).join(" ");
  const firstName = words.slice(splitIdx).join(" ");
  return `${firstName} ${lastName}`;
}

/** Split an array into fixed-size pages, preserving order. */
export function paginateArray<T>(items: T[], pageSize: number): T[][] {
  if (pageSize <= 0) return [items];

  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += pageSize) {
    pages.push(items.slice(i, i + pageSize));
  }
  return pages;
}

/**
 * FIDE/IOC 3-letter codes that differ from their ISO 3166-1 alpha-2 mapping.
 * Only codes where the first two letters of the 3-letter code do NOT match
 * the ISO alpha-2 code need to be listed here.
 */
const FIDE_TO_ISO2: Record<string, string> = {
  AHO: "AN", ALG: "DZ", ANG: "AO", ANT: "AG", ARU: "AW",
  BAH: "BS", BAN: "BD", BAR: "BB", BDI: "BI", BER: "BM",
  BIH: "BA", BOT: "BW", BRN: "BH", BRU: "BN", BUL: "BG",
  BUR: "BF", CAM: "KH", CAN: "CA", CAY: "KY", CGO: "CG",
  CHI: "CL", CMR: "CM", COD: "CD", CRC: "CR", CRO: "HR",
  CUB: "CU", CYP: "CY", DEN: "DK", DOM: "DO", ECU: "EC",
  EGY: "EG", ESA: "SV", ESP: "ES", FIJ: "FJ", FRA: "FR",
  GAM: "GM", GBR: "GB", GCI: "GG", GER: "DE", GRE: "GR",
  GRN: "GD", GUA: "GT", GUI: "GN", HAI: "HT", HKG: "HK",
  HON: "HN", INA: "ID", IND: "IN", IRI: "IR", IRL: "IE",
  IRQ: "IQ", ISL: "IS", ISR: "IL", ISV: "VI", ITA: "IT",
  IVB: "VG", JAM: "JM", JCI: "JE", JOR: "JO", JPN: "JP",
  KAZ: "KZ", KEN: "KE", KGZ: "KG", KOR: "KR", KSA: "SA",
  KUW: "KW", LAO: "LA", LAT: "LV", LBA: "LY", LBN: "LB",
  LBR: "LR", LCA: "LC", LES: "LS", LIE: "LI", LTU: "LT",
  LUX: "LU", MAD: "MG", MAS: "MY", MAW: "MW", MDA: "MD",
  MDV: "MV", MEX: "MX", MGL: "MN", MKD: "MK", MLI: "ML",
  MLT: "MT", MNE: "ME", MON: "MC", MOZ: "MZ", MRI: "MU",
  MTN: "MR", MYA: "MM", NAM: "NA", NCA: "NI", NED: "NL",
  NEP: "NP", NGR: "NG", NOR: "NO", NZL: "NZ", OMA: "OM",
  PAK: "PK", PAN: "PA", PAR: "PY", PER: "PE", PHI: "PH",
  PLE: "PS", PLW: "PW", PNG: "PG", POL: "PL", POR: "PT",
  PRK: "KP", PUR: "PR", QAT: "QA", ROU: "RO", RSA: "ZA",
  RUS: "RU", RWA: "RW", SAM: "WS", SEN: "SN", SEY: "SC",
  SGP: "SG", SKN: "KN", SLE: "SL", SLO: "SI", SMR: "SM",
  SOL: "SB", SOM: "SO", SRB: "RS", SRI: "LK", STP: "ST",
  SUD: "SD", SUI: "CH", SUR: "SR", SVK: "SK", SWE: "SE",
  SWZ: "SZ", SYR: "SY", TAN: "TZ", THA: "TH", TJK: "TJ",
  TKM: "TM", TLS: "TL", TOG: "TG", TPE: "TW", TRI: "TT",
  TUN: "TN", TUR: "TR", UAE: "AE", UGA: "UG", UKR: "UA",
  URU: "UY", USA: "US", UZB: "UZ", VAN: "VU", VEN: "VE",
  VIE: "VN", VIN: "VC", YEM: "YE", ZAM: "ZM", ZIM: "ZW",
};

/**
 * Convert a FIDE/IOC 3-letter federation code to a flag emoji.
 * Returns the original code if no mapping is found.
 */
export function federationFlag(fed: string): string {
  if (!fed || fed.length < 2) return fed;

  const upper = fed.toUpperCase().trim();
  const iso2 = FIDE_TO_ISO2[upper] ?? upper.slice(0, 2);

  // Regional indicator symbols: 🇦 = U+1F1E6, offset from 'A' (0x41)
  const cp1 = 0x1f1e6 + iso2.charCodeAt(0) - 0x41;
  const cp2 = 0x1f1e6 + iso2.charCodeAt(1) - 0x41;
  const flag = String.fromCodePoint(cp1, cp2);

  // Validate: only return if both chars are in A-Z range
  if (iso2.length === 2 && /^[A-Z]{2}$/.test(iso2)) return flag;
  return fed;
}
