/** Panel and card views are mutually exclusive; outside click and Escape close them. */
import { useCallback, useEffect, useRef, useState } from 'react';

/** Clicks inside these areas do not count as outside clicks. */
const KEEP = '.sheet, .community-page, .community-quick, .cardinfo, .rail, .dock, .note-pop, .notice-pop, .notice-quick, .version-pop, .version-quick, .toast, .import-veil, .confirm-veil, .mode-quick, .lang-quick, .cloudmode, .land-top';

/**
 * Shell that takes keyboard focus for each overlay state. Chosen by state rather than by a
 * combined selector: `.cardinfo-body` is always in the DOM (it only carries `hidden`), so a
 * grouped querySelector would return it instead of the panel that just opened.
 */
const shellFor = (o: { panel: string | null; cardOpen: boolean; noticeOpen: boolean; versionOpen: boolean }) =>
  o.panel === 'community' ? '.community-page'
    : o.panel ? '.sheet'
      : o.cardOpen ? '.cardinfo-body'
        : o.noticeOpen ? '.notice-pop'
          : o.versionOpen ? '.version-pop' : null;

export function useOverlay<P extends string>() {
  const [panel, setPanel] = useState<P | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  /** Pending in-app confirmation (feedback review). Lives here so App holds no overlay state. */
  const [confirm, setConfirm] = useState<{ word: string; snippets: string[] } | null>(null);
  /** Sample cloud view. It is the first thing a visitor sees; any click on it leads to the landing (import page). */
  const [sampleOpen, setSampleOpen] = useState(true);
  /** Community cloud without the stats page: second state of the community button cycle. */
  const [communityCloud, setCommunityCloud] = useState(false);
  /** Site-notice popover behind the bell. */
  const [noticeOpen, setNoticeOpen] = useState(false);
  /** Deploy-update popover behind the refresh dot. */
  const [versionOpen, setVersionOpen] = useState(false);

  const openPanel = useCallback((id: P | null) => {
    setPanel(id);
    if (id) { setCardOpen(false); setNoticeOpen(false); setVersionOpen(false); }
  }, []);
  const openCard = useCallback((v: boolean) => {
    setCardOpen(v);
    if (v) { setPanel(null); setNoticeOpen(false); setVersionOpen(false); }
  }, []);
  /** Bell: the notice popover is exclusive with the panels and the card view, like everything else here. */
  const toggleNotice = useCallback(() => {
    setNoticeOpen((v) => {
      if (!v) { setPanel(null); setCardOpen(false); setVersionOpen(false); }
      return !v;
    });
  }, []);
  /** Same exclusivity as the notice bell. */
  const toggleVersion = useCallback(() => {
    setVersionOpen((v) => {
      if (!v) { setPanel(null); setCardOpen(false); setNoticeOpen(false); }
      return !v;
    });
  }, []);
  const closeAll = useCallback(() => { setPanel(null); setCardOpen(false); setSampleOpen(false); setCommunityCloud(false); setNoticeOpen(false); setVersionOpen(false); }, []);
  /**
   * Escape's close: the overlays only. `closeAll` also dismisses the sample view — that is
   * the canvas click-catcher (`closeSample`), not this handler. A key press must not unmount
   * the button focus is supposed to return to.
   */
  const closeOverlays = useCallback(() => { setPanel(null); setCardOpen(false); setCommunityCloud(false); setNoticeOpen(false); setVersionOpen(false); }, []);
  /**
   * Community button: off → stats page (canvas shows the aggregate cloud) → aggregate cloud only → off.
   * `community` must be one of the panel ids of the caller.
   */
  /** Whether the sample cloud was showing when the community cloud took over the canvas. */
  const sampleBehindCommunity = useRef(false);
  const cycleCommunity = useCallback(() => {
    const id = 'community' as P;
    if (panel === id) {
      // The sample view sits on top of the canvas with its own hint and click-catcher, so the
      // aggregate cloud was invisible for a visitor who had not imported anything yet.
      sampleBehindCommunity.current = sampleOpen;
      setSampleOpen(false);
      setPanel(null); setCommunityCloud(true); return;
    }
    if (communityCloud) { setCommunityCloud(false); if (sampleBehindCommunity.current) setSampleOpen(true); return; }
    setCardOpen(false); setCommunityCloud(false); setNoticeOpen(false); setVersionOpen(false); setPanel(id);
  }, [panel, communityCloud, sampleOpen]);
  const askConfirm = useCallback((c: { word: string; snippets: string[] }) => setConfirm(c), []);
  const closeConfirm = useCallback(() => setConfirm(null), []);
  const openSample = useCallback(() => { setPanel(null); setCardOpen(false); setNoticeOpen(false); setVersionOpen(false); setSampleOpen(true); }, []);
  const closeSample = useCallback(() => setSampleOpen(false), []);

  /**
   * Keyboard focus follows the overlay: the element that opened it is remembered, the
   * shell itself takes focus (it carries tabIndex={-1}) so the next Tab lands on the
   * first control inside, and closing hands focus back to the button that opened it.
   * Without this, Escape left focus on <body> and Tab restarted from the top of the page.
   */
  const openerRef = useRef<HTMLElement | null>(null);
  const overlayOpen = panel !== null || cardOpen || noticeOpen || versionOpen;
  useEffect(() => {
    if (overlayOpen) {
      const active = document.activeElement;
      if (!openerRef.current && active instanceof HTMLElement && active !== document.body) openerRef.current = active;
      const sel = shellFor({ panel, cardOpen, noticeOpen, versionOpen });
      const shell = sel ? document.querySelector<HTMLElement>(sel) : null;
      if (shell && !shell.contains(document.activeElement)) shell.focus();
      return;
    }
    const opener = openerRef.current;
    openerRef.current = null;
    if (opener?.isConnected) opener.focus();
  }, [overlayOpen, panel, cardOpen, noticeOpen, versionOpen]);

  /**
   * Outside click closes the overlay that is in the way, not the view underneath.
   * `closeAll` also dismisses the sample cloud (that is the canvas click that starts
   * import) and the community-cloud-only state (a canvas click is how you live with
   * that state). Neither belongs on "I clicked next to the filter".
   */
  const dismissOverlay = useCallback(() => {
    setPanel(null); setCardOpen(false); setNoticeOpen(false); setVersionOpen(false);
  }, []);

  /** Capture-phase pointerdown, since some panel buttons stop propagation. */
  useEffect(() => {
    if (!panel && !cardOpen && !noticeOpen && !versionOpen) return;
    const onDown = (e: PointerEvent) => {
      const el = e.target as Element | null;
      if (el?.closest?.(KEEP)) return;
      dismissOverlay();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [panel, cardOpen, noticeOpen, versionOpen, dismissOverlay]);

  /**
   * Escape closes whatever overlay is on top. Registered separately from the outside-click
   * handler because the community cloud must close on Escape but not on a canvas click
   * (a click there is how the cycle button's third state is reached).
   * ConfirmDialog and Note keep their own capture-phase handlers and stop propagation, so
   * the innermost layer wins.
   */
  useEffect(() => {
    if (!panel && !cardOpen && !noticeOpen && !versionOpen && !communityCloud) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeOverlays(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [panel, cardOpen, noticeOpen, versionOpen, communityCloud, closeOverlays]);

  return { panel, cardOpen, openPanel, openCard, closeAll, confirm, askConfirm, closeConfirm, sampleOpen, openSample, closeSample, communityCloud, cycleCommunity, noticeOpen, toggleNotice, versionOpen, toggleVersion };
}
