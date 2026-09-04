/**
 * Copy to clipboard with a fallback. `navigator.clipboard` exists only in secure
 * contexts (https or localhost); elsewhere `document.execCommand('copy')` is used.
 * Returns false when neither works.
 */
export async function copyText(text: string): Promise<boolean> {
  // Preferred: async clipboard API (secure contexts only)
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied or document not focused: try the fallback
    }
  }

  // Fallback: temporary textarea + execCommand. The element must be in the document
  // and selectable; iOS Safari needs setSelectionRange.
  if (typeof document === 'undefined') return false;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;border:none;padding:0';
  document.body.appendChild(ta);
  try {
    ta.select();
    ta.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(ta);
  }
}
