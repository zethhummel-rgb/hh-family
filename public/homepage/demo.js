const groceries = document.querySelector('[data-grocery-demo]');
const rsvp = document.querySelector('[data-rsvp-demo]');
const result = document.querySelector('[data-rsvp-result]');

groceries.disabled = false;
rsvp.disabled = false;

rsvp.addEventListener('change', event => {
  result.textContent = 'Sample reply: ' + event.target.value;
});

if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-entering');
      observer.unobserve(entry.target);
    }
  }, {threshold: 0.12});

  document.querySelectorAll('[data-scroll-screens]').forEach(screen => observer.observe(screen));
}
