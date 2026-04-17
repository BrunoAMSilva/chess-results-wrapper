/**
 * Icon registry — single source of truth for available icon names.
 *
 * Each key is a human-friendly alias used in `<Icon name="..." />`.
 * The value matches the `<symbol id>` in `public/icons/sprite.svg`.
 */
export const iconRegistry = {
  "swiss": "swiss",
  "round-robin": "round-robin",
  "team-swiss": "team-swiss",
  "team-round-robin": "team-round-robin",
  "calendar": "calendar",
  "users": "users",
  "map-pin": "map-pin",
  "arrow-left": "arrow-left",
  "arrow-right": "arrow-right",
  "search": "search",
  "monitor": "monitor",
  "sun": "sun",
  "moon": "moon",
  "clock": "clock",
  "table": "table",
  "file-text": "file-text",
  "lock": "lock",
  "settings": "settings",
  "settings-2": "settings-2",
  "bar-chart": "bar-chart",
  "user": "user",
  "chevron-left": "chevron-left",
  "chevron-right": "chevron-right",
  "info": "info",
  "tv": "tv",
  "play": "play",
  "log-out": "log-out",
} as const satisfies Record<string, string>;

export type IconName = keyof typeof iconRegistry;

export const iconNames = Object.keys(iconRegistry) as IconName[];

export const iconSpritePath = "/icons/sprite.svg";
