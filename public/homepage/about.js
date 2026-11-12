const chapters = [...document.querySelectorAll('.about-chapter')];
const animateStack = matchMedia('(prefers-reduced-motion: no-preference)');
let frame = 0;

function updateStack() {
  frame = 0;
  if (!animateStack.matches) return;

  const cards = chapters.map(chapter => chapter.getBoundingClientRect());
  for (let index = 0; index < cards.length - 1; index += 1) {
    const current = cards[index];
    const next = cards[index + 1];
    const overlap = Math.max(0, Math.min(1, (current.bottom - next.top) / current.height));
    chapters[index].style.setProperty('--paper-scale', String(1 - overlap * 0.08));
  }
}

function scheduleStack() {
  if (!frame && animateStack.matches) frame = requestAnimationFrame(updateStack);
}

function measureCards() {
  const heights = chapters.map(chapter => chapter.offsetHeight);
  chapters.forEach((chapter, index) => chapter.style.setProperty('--card-height', heights[index] + 'px'));
  scheduleStack();
}

if ('ResizeObserver' in window) {
  const resizeObserver = new ResizeObserver(measureCards);
  chapters.forEach(chapter => resizeObserver.observe(chapter));
}
addEventListener('scroll', scheduleStack, {passive: true});
addEventListener('resize', measureCards);
animateStack.addEventListener('change', scheduleStack);
measureCards();
