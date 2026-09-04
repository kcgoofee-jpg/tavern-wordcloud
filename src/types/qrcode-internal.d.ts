/** The qrcode package does not export the function-pattern mask; rebuilding it needs the alignment-pattern table from this internal module. */
declare module 'qrcode/lib/core/alignment-pattern.js' {
  export function getRowColCoords(version: number): number[];
}
