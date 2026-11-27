import type {MouseEventHandler} from 'react';
import './publicLinks.css';

export default function PublicLinks({onOpenNotices}: {onOpenNotices?: MouseEventHandler<HTMLButtonElement>}) {
  const safariStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const installedTouchApp = window.matchMedia('(display-mode: standalone) and (pointer: coarse)').matches;
  const aboutTarget = safariStandalone || installedTouchApp ? undefined : '_blank';

  return (
    <nav className="public-links" aria-label="HH information">
      <a href="./about.html?from=app" target={aboutTarget} rel="noopener">About HH</a>
      <a href="./privacy.html" target="_blank" rel="noopener">Privacy</a>
      <a href="./terms.html" target="_blank" rel="noopener">Terms</a>
      {onOpenNotices && <button type="button" aria-haspopup="dialog" onClick={onOpenNotices}>Notices &amp; updates</button>}
    </nav>
  );
}
