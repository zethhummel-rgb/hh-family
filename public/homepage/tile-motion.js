const tileMotion = matchMedia('(prefers-reduced-motion: no-preference)');
const tileDeck = document.querySelector('[data-tile-deck]');
const tiles = [...tileDeck.children].map((card, index) => ({
  card,
  panel: card.querySelector('[data-tile-panel]'),
  direction: index % 2 === 0 ? -1 : 1,
}));
let frame = 0;
let needsSample = true;
let lastFrameTime;

function ease(value) {
  const position = Math.max(0, Math.min(1, value));
  return position * position * (3 - 2 * position);
}

function sampleTiles() {
  const viewport = document.documentElement.clientHeight;
  const bounds = tiles.map(tile => tile.card.getBoundingClientRect());
  tiles.forEach((tile, index) => {
    const current = bounds[index];
    const next = bounds[index + 1];
    tile.entry = 1 - ease((viewport - current.top) / (viewport * .46));
    tile.cover = next ? ease((current.bottom - next.top) / Math.min(current.height, viewport)) : 0;
    tile.visible = current.bottom > -64 && current.top < viewport + 64;
  });
  needsSample = false;
}

function follow(current, target, weight) {
  if (current === undefined || Math.abs(target - current) < .002) return target;
  return current + (target - current) * weight;
}

function resetTile(tile) {
  if (tile.currentEntry === undefined) return;
  tile.panel.style.removeProperty('--tile-transform');
  tile.currentEntry = tile.currentCover = undefined;
}

function renderTiles(time) {
  frame = 0;
  if (!tileMotion.matches) return;
  if (needsSample) sampleTiles();

  const elapsed = Math.min(time - (lastFrameTime ?? time - 16), 32);
  const weight = 1 - Math.exp(-elapsed / 55);
  lastFrameTime = time;
  let settling = false;
  for (const tile of tiles) {
    if (!tile.visible) {
      resetTile(tile);
      continue;
    }

    const entry = follow(tile.currentEntry, tile.entry, weight);
    const cover = follow(tile.currentCover, tile.cover, weight);
    if (entry !== tile.currentEntry || cover !== tile.currentCover) {
      const x = tile.direction * (26 * entry - 21 * cover);
      const y = 34 * entry - 8 * cover;
      const scale = 1 - .075 * entry - .095 * cover;
      tile.panel.style.setProperty('--tile-transform', `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) scale(${scale.toFixed(4)})`);
      tile.currentEntry = entry;
      tile.currentCover = cover;
    }
    settling ||= entry !== tile.entry || cover !== tile.cover;
  }
  if (settling) frame = requestAnimationFrame(renderTiles);
}

function scheduleTiles() {
  needsSample = true;
  if (!frame && tileMotion.matches) frame = requestAnimationFrame(renderTiles);
}

function measureTiles() {
  const heights = tiles.map(tile => tile.card.offsetHeight);
  tiles.forEach((tile, index) => {
    if (tile.height === heights[index]) return;
    tile.height = heights[index];
    tile.card.style.setProperty('--tile-height', tile.height + 'px');
  });
  tileDeck.dataset.motionReady = '';
  scheduleTiles();
}

if ('ResizeObserver' in window) {
  const observer = new ResizeObserver(measureTiles);
  tiles.forEach(tile => observer.observe(tile.card));
}
addEventListener('scroll', scheduleTiles, {passive: true});
addEventListener('resize', measureTiles);
tileMotion.addEventListener('change', () => {
  if (!tileMotion.matches) tiles.forEach(resetTile);
  scheduleTiles();
});
measureTiles();
