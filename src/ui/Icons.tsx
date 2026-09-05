/** Inline SVG icons on a 24x24 grid, 1.6 stroke, currentColor. No icon library. */
/**
 * Do not annotate `P` as `Record<string, ...>`: `keyof typeof P` would widen to
 * `string` and a misspelled icon name would compile and render an empty button.
 * `satisfies` keeps the values type-checked.
 */
const P = {
  // Import
  /** Import: arrow into the box. Exact mirror of `export`. */
  upload: <><path d="M12 4v12" /><path d="m7 11 5 5 5-5" /><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></>,
  // Palette + brush
  palette: <>
    <path d="M11.4 3.2c-4.6 0-8.2 3.5-8.2 7.9 0 4.3 3.4 7.4 7.7 7.4 1.4 0 2.2-.8 2.2-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.1 0-.9.8-1.6 1.8-1.6h1.4c2.6 0 4.5-1.8 4.5-4.3 0-3.2-3.4-5.3-8.4-5.3Z" />
    <circle cx="7.4" cy="10" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="10.6" cy="7.1" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="14.8" cy="7.6" r="1.1" fill="currentColor" stroke="none" />
    <path d="m16.4 20.6 4.3-4.3a1.4 1.4 0 0 0-2-2l-4.3 4.3-.6 2.6 2.6-.6Z" />
  </>,
  // Font / scheme icons
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.8v2.1" /><path d="M12 19.1v2.1" /><path d="M4.5 4.5l1.5 1.5" /><path d="M18 18l1.5 1.5" /><path d="M2.8 12h2.1" /><path d="M19.1 12h2.1" /><path d="M4.5 19.5 6 18" /><path d="M18 6l1.5-1.5" /></>,
  // Dark
  moon: <path d="M20 13.5A8.2 8.2 0 0 1 10.5 4a8.2 8.2 0 1 0 9.5 9.5Z" />,
  // Reset
  reset: <><path d="M3.8 12a8.2 8.2 0 1 0 2.6-6" /><path d="M3.4 4v4.4h4.4" /></>,
  // Merge / split
  split: <><path d="M4 12h6" /><path d="M14 12h6" /><path d="M12 5v5" /><path d="M12 14v5" /></>,
  // Add
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  // Filters: three sliders
  sliders: <><path d="M4 7h3.2" /><path d="M11.8 7H20" /><path d="M4 12h8.2" /><path d="M16.8 12H20" /><path d="M4 17h4.2" /><path d="M12.8 17H20" /><rect x="7.2" y="4.6" width="4.6" height="4.8" rx="1.6" /><rect x="12.2" y="9.6" width="4.6" height="4.8" rx="1.6" /><rect x="8.2" y="14.6" width="4.6" height="4.8" rx="1.6" /></>,
  // Word table: bars of varying length
  list: <><path d="M4 6h15" /><path d="M4 11h10" /><path d="M4 16h6.5" /><path d="M4 20.5h13" /></>,
  // Share = QR
  qr: <><rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1" /><rect x="14" y="3.5" width="6.5" height="6.5" rx="1" /><rect x="3.5" y="14" width="6.5" height="6.5" rx="1" /><path d="M14 14h3v3h-3z" fill="currentColor" stroke="none" /><path d="M19.5 14h1v1h-1z" fill="currentColor" stroke="none" /><path d="M14 19.5h1v1h-1z" fill="currentColor" stroke="none" /><path d="M18 18h2.5v2.5H18z" fill="currentColor" stroke="none" /></>,
  // Image / clear
  trash: <><path d="M4 7h16" /><path d="M10 4h4" /><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" /><path d="M10 11v6" /><path d="M14 11v6" /></>,
  // Speaker
  speaker: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" /></>,
  // Close
  close: <><path d="m6 6 12 12" /><path d="m18 6-12 12" /></>,
  // Back to cloud / copy link
  link: <><path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.3-2.3a4 4 0 0 0-5.7-5.7l-1.3 1.3" /><path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.3 2.3a4 4 0 0 0 5.7 5.7l1.3-1.3" /></>,
  // Check
  check: <path d="m5 12.5 4.5 4.5L19 7" />,
  // Files / card groups
  files: <><rect x="3.5" y="7.5" width="12" height="13" rx="2" /><path d="M7.5 4.5h9A2 2 0 0 1 18.5 6.5v10" /><path d="M6.8 12h5.4" /><path d="M6.8 16h3.4" /></>,
  // Card
  card: <><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><circle cx="9" cy="10.5" r="2.1" /><path d="M5.6 17c.5-1.9 1.9-3 3.4-3s2.9 1.1 3.4 3" /><path d="M15 9.5h3.2" /><path d="M15 13h3.2" /></>,
  // Caret
  caret: <path d="m7 10 5 5 5-5" />,
  // Cloud
  cloud: <><path d="M7.5 18h9a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.7-1.2A3.6 3.6 0 0 0 7.5 18Z" /></>,
  // LLM tokenization
  chip: <><rect x="7" y="7" width="10" height="10" rx="2" /><path d="M10 3.5v3.5" /><path d="M14 3.5v3.5" /><path d="M10 17v3.5" /><path d="M14 17v3.5" /><path d="M3.5 10H7" /><path d="M3.5 14H7" /><path d="M17 10h3.5" /><path d="M17 14h3.5" /></>,
  // Alert
  /**
   * Font: a serif capital T — the convention for a typeface picker (Lucide `type`, Figma, Word).
   * The old mark packed an "A" and a 文 into 24px and read as "A↓" at the 17px it ships at.
   */
  font: <>
    <path d="M4.5 7.5V5.5h15v2" /><path d="M12 5.5v13" /><path d="M8.6 18.5h6.8" />
  </>,
  /* Provider marks: simple, distinct silhouettes, not brand logos — each only has to be
     told apart from the others at 16px, and the name is in the tooltip. */
  /** OpenAI: a six-spoke rosette */
  openai: <><circle cx="12" cy="12" r="3.2" /><path d="M12 3.4v5.4" /><path d="M12 15.2v5.4" /><path d="m4.6 7.7 4.7 2.7" /><path d="m14.7 13.6 4.7 2.7" /><path d="m4.6 16.3 4.7-2.7" /><path d="m14.7 10.4 4.7-2.7" /></>,
  /** SiliconFlow: stacked flow lines */
  siliconflow: <><path d="M3.5 8.5c3-2.4 5.9-2.4 8.5 0s5.5 2.4 8.5 0" /><path d="M3.5 13c3-2.4 5.9-2.4 8.5 0s5.5 2.4 8.5 0" /><path d="M3.5 17.5c3-2.4 5.9-2.4 8.5 0s5.5 2.4 8.5 0" /></>,
  /** Moonshot Kimi: a crescent */
  moonshot: <><path d="M19 14.6A8 8 0 0 1 9.4 5a8.2 8.2 0 1 0 9.6 9.6Z" /></>,
  /** Qwen DashScope: a gauge dial */
  dashscope: <><path d="M4.2 17.5a9 9 0 1 1 15.6 0" /><path d="m12 13.6 4.2-4.4" /><circle cx="12" cy="15" r="1.6" /></>,
  /** LM Studio: a monitor with a prompt caret */
  lmstudio: <><rect x="3" y="5" width="18" height="12" rx="2" /><path d="M9.5 20.5h5" /><path d="m8 9.4 2.4 2.1L8 13.6" /><path d="M12.8 13.6h3.4" /></>,
  /** Frequency mode: bar chart */
  chart: <><path d="M4 20h16" /><rect x="5.5" y="11" width="3.4" height="6.5" rx="1" /><rect x="10.3" y="6" width="3.4" height="11.5" rx="1" /><rect x="15.1" y="14" width="3.4" height="3.5" rx="1" /></>,
  play: <path d="M8 5.4v13.2l10-6.6z" fill="currentColor" stroke="none" />,
  /** Info */
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11.2v5" /><circle cx="12" cy="8" r="0.9" fill="currentColor" stroke="none" /></>,
  /** Run again (distinct from reset) */
  refresh: <><path d="M20.2 12a8.2 8.2 0 1 1-2.6-6" /><path d="M20.6 4v4.4h-4.4" /></>,
  /** Plug: the endpoint panel is a generic API connection, not only a key */
  plug: <>
    <path d="M9 3.5v4.2" /><path d="M15 3.5v4.2" />
    <path d="M6.4 7.7h11.2v3.1a5.6 5.6 0 0 1-5.6 5.6 5.6 5.6 0 0 1-5.6-5.6z" />
    <path d="M12 16.4v4.1" />
  </>,
  /** Export: arrow out of the box, mirror of `upload` */
  export: <><path d="M10 6 4 12l6 6" /><path d="M4 12h9a7 7 0 0 1 7 7v1" /></>,
  /** Save as image */
  image: <>
    <rect x="3.5" y="4.8" width="17" height="14.4" rx="2.4" />
    <circle cx="8.8" cy="10" r="1.7" />
    <path d="m4.6 17.4 4.3-4.3a1.7 1.7 0 0 1 2.4 0l5 5" /><path d="m14.4 14.6 1.9-1.9a1.7 1.7 0 0 1 2.4 0l1.7 1.7" />
  </>,
  /** DeepSeek whale, from simple-icons (CC0-1.0). Filled path, so the stroke is disabled. */
  deepseek: <path d="M23.748 4.651c-.254-.124-.364.113-.512.233-.051.04-.094.09-.137.137-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.155-.708-.311-.955-.65-.172-.24-.219-.509-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.094.172.187.129.323-.082.28-.18.553-.266.833-.055.179-.137.218-.328.14a5.5 5.5 0 0 1-1.737-1.179c-.857-.828-1.631-1.743-2.597-2.46a12 12 0 0 0-.689-.47c-.985-.957.13-1.743.387-1.836.27-.098.094-.433-.778-.428-.872.003-1.67.295-2.687.685a3 3 0 0 1-.465.136 9.6 9.6 0 0 0-2.883-.101c-1.885.21-3.39 1.1-4.497 2.622C.082 8.776-.231 10.854.152 13.02c.403 2.284 1.568 4.175 3.36 5.653 1.857 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.132-.284 4.994-1.86.47.234.962.328 1.78.398.629.058 1.235-.031 1.705-.129.735-.155.684-.836.418-.961-2.155-1.004-1.682-.595-2.112-.926 1.095-1.295 2.768-3.598 3.284-6.733.05-.346.115-.834.108-1.114-.004-.171.035-.238.23-.257a4.2 4.2 0 0 0 1.545-.475c1.397-.763 1.96-2.016 2.093-3.517.02-.23-.004-.467-.247-.588M11.58 18.168c-2.088-1.642-3.101-2.183-3.52-2.16-.39.024-.32.472-.234.763.09.288.207.487.371.74.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.168-1.361-.801-2.5-1.86-3.301-3.306-.775-1.393-1.225-2.888-1.299-4.482-.02-.385.094-.522.477-.592a4.7 4.7 0 0 1 1.53-.038c2.131.311 3.946 1.264 5.467 2.774.868.86 1.525 1.887 2.202 2.89.72 1.066 1.494 2.082 2.48 2.915.348.291.626.513.892.677-.802.09-2.14.109-3.055-.615zm1.001-6.44a.306.306 0 0 1 .415-.287.3.3 0 0 1 .113.074.3.3 0 0 1 .086.214c0 .17-.136.307-.308.307a.303.303 0 0 1-.306-.307m3.11 1.596c-.2.081-.4.151-.591.16a1.25 1.25 0 0 1-.798-.254c-.274-.23-.47-.358-.551-.758a1.7 1.7 0 0 1 .015-.588c.07-.327-.007-.537-.238-.727-.188-.156-.426-.199-.689-.199a.6.6 0 0 1-.254-.078.253.253 0 0 1-.114-.358 1 1 0 0 1 .192-.21c.356-.202.767-.136 1.146.016.352.144.618.408 1.001.782.392.451.462.576.685.915.176.264.336.536.446.848.066.194-.02.353-.25.45" fill="currentColor" stroke="none" />,
  /** Language: A / 文. Real text glyphs rather than hand-drawn strokes. */
  lang: <>
    {/* A top-left, 文 bottom-right, slash between; margins keep it intact at 16px */}
    <text x="1.5" y="12" fontSize="10.5" fontWeight="600" fill="currentColor" stroke="none"
      fontFamily="system-ui, -apple-system, sans-serif">A</text>
    <path d="M16.5 3.5 7.5 20.5" strokeWidth="1.4" />
    {/* i18n-exempt: the 文 glyph is part of the icon, not UI copy */}
    <text x="12.5" y="21" fontSize="10" fontWeight="500" fill="currentColor" stroke="none"
      fontFamily="system-ui, -apple-system, sans-serif">文</text>
  </>,
  // Provider marks, drawn to the same 24-grid
  openrouter: <><path d="M3 12h4l3-4h4" /><path d="M3 12h4l3 4h4" /><path d="m14 8 3-2v8l-3-2" /><path d="m14 16 3 2v-8" /></>,
  opencode: <><path d="m8 7-5 5 5 5" /><path d="m16 7 5 5-5 5" /><path d="M13.5 5 10.5 19" /></>,
  ollama: <><path d="M7 20v-5.5a5 5 0 0 1 10 0V20" /><path d="M8.5 9.5c-.6-3 .2-5.5 1-6 .9 1 1.3 2.6 1.3 4" /><path d="M15.5 9.5c.6-3-.2-5.5-1-6-.9 1-1.3 2.6-1.3 4" /><circle cx="10" cy="14" r=".7" fill="currentColor" stroke="none" /><circle cx="14" cy="14" r=".7" fill="currentColor" stroke="none" /></>,
  // Gear: advanced settings. From Lucide `settings` (ISC), 1.6 stroke
  gear: <><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></>,
  alert: <><circle cx="12" cy="12" r="8.5" /><path d="M12 8v5" /><circle cx="12" cy="16" r="0.9" fill="currentColor" stroke="none" /></>,
  /** Edit the display name: pencil */
  pencil: <><path d="m4 20 .9-3.6L15.6 5.7a2 2 0 0 1 2.8 2.8L7.6 19.1 4 20Z" /><path d="m14.2 7.1 2.7 2.7" /></>,
  /** Undo a split: two halves pushed back into one box */
  unsplit: <><rect x="3.5" y="6.5" width="17" height="11" rx="2" /><path d="M12 6.5v11" /><path d="M6.6 12h3" /><path d="M14.4 12h3" /></>,
  /** Force horizontal: left-right arrow */
  rotateH: <><path d="M4 12h16" /><path d="m7.5 8.5-3.5 3.5 3.5 3.5" /><path d="m16.5 8.5 3.5 3.5-3.5 3.5" /></>,
  /** Force vertical: up-down arrow */
  rotateV: <><path d="M12 4v16" /><path d="m8.5 7.5 3.5-3.5 3.5 3.5" /><path d="m8.5 16.5 3.5 3.5 3.5-3.5" /></>,
  /** Equivalence: three stacked bars, the "identical to" sign */
  /** Merge: two strands flowing into one arrow (three bars read as a menu, not a merge) */
  equals: <><path d="M4 6c5 0 5 6 9.5 6H19" /><path d="M4 18c5 0 5-6 9.5-6" /><path d="m16 9 3 3-3 3" /></>,
  /** Classify: a label tag with its eyelet */
  tag: <><path d="M11.5 3.5H20v8.5l-8.6 8.6a2 2 0 0 1-2.8 0l-5.7-5.7a2 2 0 0 1 0-2.8Z" /><circle cx="16.6" cy="7.4" r="1.4" /></>,
  /** Move out of a group: an item leaving a box */
  eject: <><path d="M14 4h5a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 19 20h-5" /><path d="M3.5 12h9" /><path d="m9 8.5 3.5 3.5L9 15.5" /></>,
  /** Not a word: a barred circle */
  ban: <><circle cx="12" cy="12" r="8.2" /><path d="m6.5 6.5 11 11" /></>,
  /** Community: three people */
  people: <><circle cx="9" cy="8.5" r="3" /><path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5" /><circle cx="17" cy="9.5" r="2.2" /><path d="M15.4 14.7c2.3-.4 4.3.9 5.1 4.3" /></>,
  /** Priority words: a line pinned to the top, arrow rising into it */
  pinTop: <><path d="M4 4h16" /><path d="M12 20V8.5" /><path d="m7.5 13 4.5-4.5 4.5 4.5" /></>,
  /** Reveal the key: an open eye */
  eye: <><path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.8" /></>,
  /** Hide the key: the same eye, struck through */
  eyeOff: <><path d="M4 4.5 20 20" /><path d="M9.6 6.4A8.4 8.4 0 0 1 12 6c6 0 9.5 6 9.5 6a16 16 0 0 1-3 3.5" /><path d="M17.6 17.4A9.4 9.4 0 0 1 12 18c-6 0-9.5-6-9.5-6a16 16 0 0 1 4-4.3" /><path d="M10 10.1a2.8 2.8 0 0 0 3.9 3.9" /></>,
  /** Site notice: a bell */
  bell: <><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.4 2.1H4.6L6 16.5Z" /><path d="M10 21.2a2.3 2.3 0 0 0 4 0" /></>,
} satisfies Record<string, React.ReactNode>;

export type IconName = keyof typeof P;

export default function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false"
    >
      {P[name]}
    </svg>
  );
}
