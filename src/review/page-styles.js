const REVIEW_PAGE_CSS = `
  :root {
    color-scheme: light;
    font-family: Arial, Helvetica, sans-serif;
    background: #f3f4f6;
    color: #111827;
  }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; background: #f3f4f6; }
  #f120-review-root { min-height: 100vh; display: flex; flex-direction: column; }
  .f120-review-toolbar {
    position: sticky; top: 0; z-index: 20;
    display: grid; gap: 10px; grid-template-columns: minmax(220px, 1fr) auto;
    align-items: center; padding: 10px 14px;
    background: rgba(255,255,255,0.97); border-bottom: 1px solid #d1d5db;
    box-shadow: 0 2px 10px rgba(15,23,42,0.08);
  }
  .f120-review-title { margin: 0; font-size: 16px; font-weight: 800; }
  .f120-review-summary { color: #374151; font-size: 13px; }
  .f120-review-controls { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; align-items: center; }
  .f120-review-controls label { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: #374151; }
  .f120-review-controls select,
  .f120-review-question-nav button {
    border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; color: #111827;
    font: inherit; font-size: 12px; padding: 6px 8px;
  }
  .f120-review-question-nav {
    display: inline-flex; justify-content: center; align-items: center; gap: 8px;
    margin: 0 auto;
  }
  .f120-review-question-nav button { cursor: pointer; font-weight: 800; min-width: 96px; padding: 6px 12px; }
  .f120-review-question-nav button:hover:not(:disabled) { background: #eff6ff; border-color: #60a5fa; }
  .f120-review-question-nav #f120-review-next:not(:disabled) { background: #2563eb; border-color: #1d4ed8; color: #fff; }
  .f120-review-question-nav #f120-review-next:hover:not(:disabled) { background: #1d4ed8; border-color: #1e40af; }
  .f120-review-question-nav button:disabled { opacity: 0.5; cursor: not-allowed; }
  .f120-review-shell { flex: 1; display: grid; grid-template-columns: 168px minmax(0, 1fr) 300px; gap: 12px; padding: 12px; }
  nav.f120-review-leftnav {
    background: #fff; border: 1px solid #d1d5db; border-radius: 8px; padding: 8px;
    align-self: start; position: sticky; top: 72px; max-height: calc(100vh - 90px); overflow: auto;
  }
  ol#leftnav { list-style: none; margin: 0; padding: 0; display: grid; gap: 3px; }
  ol#leftnav > li {
    display: grid; grid-template-columns: 18px 18px 1fr auto; align-items: center; gap: 4px;
    min-height: 28px; padding: 4px 6px; border-radius: 6px; cursor: pointer; user-select: none;
    border: 1px solid transparent;
  }
  ol#leftnav > li.f120-review-block-separator { border-top-color: #cbd5e1; border-top-left-radius: 0; border-top-right-radius: 0; margin-top: 9px; padding-top: 10px; }
  ol#leftnav > li:hover { background: #f8fafc; border-color: #dbeafe; }
  ol#leftnav > li.f120-review-block-separator:hover { border-top-color: #93c5fd; }
  ol#leftnav > li.currentitem { background: #dbeafe; border-color: #60a5fa; font-weight: 800; }
  ol#leftnav > li.currentitem.f120-review-block-separator { border-top-color: #2563eb; }
  .ans_status { width: 12px; height: 12px; border-radius: 999px; border: 1px solid #94a3b8; display: inline-block; }
  .ans_status.f120-review-answered { background: #94a3b8; }
  .f120-review-nav-status, .f120-review-option-status {
    display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto;
    width: 18px; min-width: 18px; height: 18px; margin-right: 4px; border-radius: 999px;
    font-size: 13px; font-weight: 900; line-height: 1;
  }
  .f120-review-nav-status--correct, .f120-review-option-status--correct { color: #047857; background: #d1fae5; }
  .f120-review-nav-status--incorrect, .f120-review-option-status--wrong { color: #b91c1c; background: #fee2e2; }
  .f120-review-nav-status--omitted, .f120-review-nav-status--unknown, .f120-review-option-status--unknown { color: #92400e; background: #fef3c7; }
  .f120-review-main { min-width: 0; display: flex; flex-direction: column; gap: 10px; }
  .f120-review-current-header, .f120-review-detail-panel {
    background: #fff; border: 1px solid #d1d5db; border-radius: 8px; padding: 10px 12px;
  }
  .f120-review-current-header { display: grid; grid-template-columns: minmax(150px, 1fr) auto minmax(110px, 1fr); align-items: center; gap: 8px; font-size: 13px; }
  .f120-review-current-header #f120-review-current-status { justify-self: end; }
  section#item { background: #fff; border: 1px solid #d1d5db; border-radius: 8px; min-height: 460px; overflow: auto; }
  article#content { padding: 18px 20px; }
  div#medley { min-height: 420px; }
  #medley .NBExposition {
    max-width: 820px; margin: 0 auto 14px; line-height: 1.58; font-size: 16px; text-align: left;
  }
  #medley .NBExposition p { margin-top: 0; margin-bottom: 0.85em; }
  #medley .NBExposition p:last-child { margin-bottom: 0; }
  .f120-review-item-unavailable { padding: 20px; border: 1px dashed #cbd5e1; border-radius: 8px; color: #475569; }
  #medley ol.options.f120-review-options-list { list-style: none; max-width: 820px; margin-left: auto; margin-right: auto; padding-left: 0; line-height: 1.45; }
  ol.options > li.stContext, li.stContext { position: relative; }
  #medley li.f120-review-option-row { display: flex; align-items: flex-start; gap: 8px; margin: 8px 0; padding: 8px 10px; border-radius: 8px; }
  #medley tr.f120-review-option-row { display: table-row; }
  #medley tr.f120-review-option-row > td { padding: 6px 8px; }
  #medley .NBOptionTableComp.answerbox { max-width: 820px; margin-left: auto; margin-right: auto; overflow-x: auto; }
  #medley .NBOptionTableComp.answerbox table { width: 100%; max-width: 820px; border-collapse: collapse; }
  #medley .NBOptionTableComp.answerbox input.NBOptionInput { display: none !important; }
  #medley .f120-review-option-label { display: inline-flex; align-items: baseline; gap: 6px; min-width: 0; }
  #medley .f120-review-option-letter { flex: 0 0 auto; font-weight: 700; }
  #medley .f120-review-option-text { min-width: 0; overflow-wrap: anywhere; }
  .f120-review-option-status { vertical-align: middle; }
  #medley mark, #medley .f120-review-text-highlight { background: #fef08a; color: inherit; border-radius: 3px; padding: 0 2px; }
  .f120-review-option--correct { background: rgba(16,185,129,0.12) !important; outline: 2px solid rgba(16,185,129,0.35); outline-offset: 1px; }
  .f120-review-option--selected-wrong { background: rgba(239,68,68,0.12) !important; outline: 2px solid rgba(239,68,68,0.35); outline-offset: 1px; }
  .f120-review-option--selected-unknown { background: rgba(245,158,11,0.14) !important; outline: 2px solid rgba(245,158,11,0.35); outline-offset: 1px; }
  .f120-review-time-spent { margin-top: 12px; padding: 8px 10px; border-radius: 8px; background: #f8fafc; color: #334155; font-weight: 700; }
  #medley img, #medley video, #medley audio { max-width: 100%; }
  #medley video, #medley audio { display: block; }
  #medley .f120-review-media-ready { max-width: 100%; }
  #medley .f120-review-image-strip {
    display: flex; flex-wrap: wrap; align-items: flex-start; gap: 10px;
    margin: 12px 0 14px; padding: 10px; border: 1px solid #dbeafe; border-radius: 10px; background: #f8fbff;
  }
  #medley .f120-review-image-preview { max-width: 260px; margin: 0; }
  #medley img.f120-review-image-thumb {
    display: block; width: auto; max-width: 240px; max-height: 180px; object-fit: contain;
    border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; cursor: zoom-in; box-shadow: 0 1px 3px rgba(15,23,42,0.12);
  }
  #medley img.f120-review-image-thumb:hover, #medley img.f120-review-image-thumb:focus { border-color: #2563eb; outline: 2px solid #bfdbfe; outline-offset: 2px; }
  .f120-review-image-dialog[hidden] { display: none !important; }
  .f120-review-image-dialog { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; padding: 28px; }
  .f120-review-image-dialog-backdrop { position: absolute; inset: 0; border: 0; padding: 0; background: rgba(15,23,42,0.72); cursor: zoom-out; }
  .f120-review-image-dialog-panel { position: relative; max-width: min(96vw, 1200px); max-height: 92vh; padding: 44px 14px 14px; border-radius: 12px; background: #fff; box-shadow: 0 24px 80px rgba(15,23,42,0.45); }
  .f120-review-image-dialog-img { display: block; max-width: calc(96vw - 28px); max-height: calc(92vh - 72px); object-fit: contain; }
  .f120-review-image-dialog-close { position: absolute; top: 8px; right: 10px; width: 32px; height: 32px; border: 1px solid #cbd5e1; border-radius: 999px; background: #fff; color: #111827; font-size: 22px; line-height: 1; font-weight: 800; cursor: pointer; }
  .f120-review-image-dialog-close:hover, .f120-review-image-dialog-close:focus { background: #eff6ff; border-color: #2563eb; outline: 2px solid #bfdbfe; }
  #medley .f120-review-native-media-fallback { display: grid; gap: 10px; max-width: 720px; margin: 10px 0; }
  #medley .f120-review-native-media-entry { display: grid; gap: 4px; padding: 8px; border: 1px solid #d1d5db; border-radius: 8px; background: #f8fafc; }
  #medley .f120-review-native-media-label { font-size: 12px; font-weight: 800; color: #334155; }
  #medley .f120-review-native-media-entry video, #medley .f120-review-native-media-entry audio,
  #medley .f120-review-native-media-fallback--interactive video,
  #medley .f120-review-native-media-fallback--interactive audio { width: 100%; min-height: 36px; }
  #medley .f120-review-hotspot-diagram { position: relative; display: inline-block; max-width: 100%; }
  #medley .f120-review-hotspot-diagram img { display: block; }
  #medley .f120-review-hotspot-marker { position: absolute; transform: translate(-50%, -50%); border: 2px solid #1d4ed8; border-radius: 999px; background: rgba(219,234,254,0.78); color: #1d4ed8; font: inherit; font-size: 11px; font-weight: 900; line-height: 1; cursor: pointer; box-shadow: 0 1px 4px rgba(15,23,42,0.25); }
  #medley .f120-review-hotspot-marker:hover, #medley .f120-review-hotspot-marker.is-selected { background: rgba(37,99,235,0.92); color: #fff; border-color: #1e40af; }
  #medley .f120-review-media-notice { border: 1px solid #f59e0b; background: #fffbeb; color: #92400e; border-radius: 8px; padding: 8px 10px; font-size: 12px; font-weight: 700; }
  #medley .f120-review-audio-player { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px; border: 1px solid #cbd5e1; border-radius: 8px; background: #f8fafc; }
  #medley .f120-review-audio-player button { border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; color: #111827; font: inherit; font-size: 12px; font-weight: 800; padding: 6px 10px; cursor: pointer; }
  #medley .f120-review-audio-player button:hover:not(:disabled) { background: #eff6ff; border-color: #60a5fa; }
  #medley .f120-review-audio-player button:disabled { opacity: 0.55; cursor: not-allowed; }
  #medley .f120-review-audio-player.is-playing .f120-review-audio-status { color: #047857; }
  #medley .f120-review-audio-status { font-size: 12px; font-weight: 800; color: #475569; }
  #medley .f120-review-media-download { display: inline-block; color: #1d4ed8; text-decoration: underline; font-size: 12px; font-weight: 800; }
  #medley .f120-review-hotspot-controls { display: flex; flex-wrap: wrap; gap: 6px; }
  #medley .f120-review-hotspot-button { border: 1px solid #cbd5e1; border-radius: 999px; padding: 5px 8px; background: #fff; color: #111827; font: inherit; font-size: 12px; font-weight: 800; cursor: pointer; }
  #medley .f120-review-hotspot-button:hover { background: #eff6ff; border-color: #60a5fa; }
  #medley .f120-review-hotspot-button.is-selected { background: #dbeafe; border-color: #2563eb; color: #1d4ed8; }
  #medley .f120-review-media-inline-duplicate { display: none; }
  .f120-review-side { align-self: start; position: sticky; top: 72px; max-height: calc(100vh - 90px); overflow: auto; }
  .f120-review-detail-panel h2 { margin: 0 0 8px; font-size: 14px; }
  .f120-review-detail-list { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 6px 8px; font-size: 12px; }
  .f120-review-detail-list dt { color: #475569; font-weight: 800; }
  .f120-review-detail-list dd { margin: 0; overflow-wrap: anywhere; }
  .f120-review-pill { display: inline-flex; align-items: center; border-radius: 999px; padding: 2px 7px; font-weight: 800; font-size: 12px; }
  .f120-review-pill--correct { background: #d1fae5; color: #047857; }
  .f120-review-pill--incorrect { background: #fee2e2; color: #b91c1c; }
  .f120-review-pill--omitted, .f120-review-pill--unknown { background: #fef3c7; color: #92400e; }
  .f120-review-compact-summary { margin-top: 10px; display: grid; gap: 6px; font-size: 12px; }
  .f120-review-empty { color: #64748b; font-style: italic; }
  @media (max-width: 980px) {
    .f120-review-toolbar { grid-template-columns: 1fr; }
    .f120-review-controls { justify-content: flex-start; }
    .f120-review-shell { grid-template-columns: 120px minmax(0, 1fr); }
    .f120-review-side { grid-column: 1 / -1; position: static; max-height: none; }
  }
  @media (max-width: 640px) {
    .f120-review-shell { grid-template-columns: 1fr; padding: 8px; }
    nav.f120-review-leftnav { position: static; max-height: 180px; }
  }
`;

export { REVIEW_PAGE_CSS };
