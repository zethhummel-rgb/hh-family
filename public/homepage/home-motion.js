const motion = matchMedia('(prefers-reduced-motion: no-preference)');
const carousel = document.querySelector('[data-meal-carousel]');
const track = carousel.querySelector('.meal-track');
const slides = [...track.querySelectorAll('.meal-slide')];
const controls = carousel.querySelector('[data-meal-controls]');
const previous = carousel.querySelector('[data-meal-prev]');
const next = carousel.querySelector('[data-meal-next]');
const position = carousel.querySelector('[data-meal-position]');
const announcement = carousel.querySelector('[data-meal-status]');
let currentIndex = 0;
let requestedIndex = null;

function showPosition() {
  previous.setAttribute('aria-disabled', String(currentIndex === 0));
  next.setAttribute('aria-disabled', String(currentIndex === slides.length - 1));
  position.textContent = (currentIndex + 1) + ' / ' + slides.length;
  announcement.textContent = 'Preview ' + (currentIndex + 1) + ' of ' + slides.length + '. ' +
    slides[currentIndex].querySelector('h3').textContent;
}

function syncPosition() {
  const nearest = slides.reduce((closest, slide, index) =>
    Math.abs(slide.offsetLeft - track.scrollLeft) < Math.abs(slides[closest].offsetLeft - track.scrollLeft) ? index : closest, 0);
  if (nearest !== currentIndex) {
    currentIndex = nearest;
    showPosition();
  }
  if (requestedIndex !== null && Math.abs(slides[requestedIndex].offsetLeft - track.scrollLeft) <= 1) requestedIndex = null;
}

function selectSlide(index) {
  requestedIndex = Math.max(0, Math.min(slides.length - 1, index));
  track.scrollTo({left: slides[requestedIndex].offsetLeft, behavior: motion.matches ? 'smooth' : 'instant'});
  syncPosition();
}

previous.addEventListener('click', () => selectSlide((requestedIndex ?? currentIndex) - 1));
next.addEventListener('click', () => selectSlide((requestedIndex ?? currentIndex) + 1));
track.addEventListener('scroll', syncPosition, {passive: true});
track.addEventListener('pointerdown', () => { requestedIndex = null; });
track.addEventListener('wheel', () => { requestedIndex = null; }, {passive: true});
track.addEventListener('keydown', event => {
  const index = requestedIndex ?? currentIndex;
  const target = {ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: slides.length - 1}[event.key];
  if (typeof target !== 'number') return;
  event.preventDefault();
  selectSlide(target);
});
showPosition();
controls.hidden = false;
