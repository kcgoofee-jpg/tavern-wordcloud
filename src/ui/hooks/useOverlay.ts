/** Panel and card views are mutually exclusive; outside click and Escape close them. */
import { useCallback, useEffect, useRef, useState } from 'react';

/** Clicks inside these areas do not count as outside clicks. */
const KEEP = '.sheet, .community-page, .community-quick, .cardinfo, .rail, .dock, .note-pop, .notice-pop, .notice-quick, .version-pop, .version-quick, .toast, .import-veil, .confirm-veil';

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

  /** Capture-phase pointerdown, since some panel buttons stop propagation. */
  useEffect(() => {
    if (!panel && !cardOpen && !noticeOpen && !versionOpen) return;
    const onDown = (e: PointerEvent) => {
      const el = e.target as Element | null;
      if (el?.closest?.(KEEP)) return;
      closeAll();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeAll(); };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [panel, cardOpen, noticeOpen, versionOpen, closeAll]);

  return { panel, cardOpen, openPanel, openCard, closeAll, confirm, askConfirm, closeConfirm, sampleOpen, openSample, closeSample, communityCloud, cycleCommunity, noticeOpen, toggleNotice, versionOpen, toggleVersion };
}
