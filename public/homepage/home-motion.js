const appReturn = document.querySelector('[data-app-return]');
if (appReturn && new URLSearchParams(location.search).get('from') === 'app') {
  appReturn.textContent = 'Return to app';
}

const story = document.querySelector('[data-feature-story]');

if (story) {
  const steps = [...story.querySelectorAll('.feature-preview')];
  const copy = steps.map(step => step.querySelector('.feature-copy'));
  const art = steps.map(step => step.querySelector('[data-highlight-art]'));
  const stage = story.querySelector('.feature-stage');
  const motion = matchMedia('(prefers-reduced-motion: no-preference)');
  const wide = matchMedia('(min-width: 820px)');

  let active = -1;
  let animationFrame = 0;

  const inlineObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    for (const {isIntersecting, target} of entries) {
      if (!isIntersecting) continue;
      target.classList.add('has-entered');
      inlineObserver.unobserve(target);
    }
  }, {threshold: .18}) : null;

  function updateActivePreview() {
    animationFrame = 0;
    if (stage.hidden) return;

    const readingLine = window.innerHeight * .57;
    let next = -1;
    copy.forEach((heading, index) => {
      if (heading.getBoundingClientRect().top <= readingLine) next = index;
    });
    // On tall screens the last heading can stay below the reading line at the end of the page.
    if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 48) next = copy.length - 1;

    if (next === active) return;
    art[active]?.classList.remove('is-current');
    art[next]?.classList.add('is-current');
    active = next;
  }

  function schedulePreviewUpdate() {
    if (!stage.hidden && !animationFrame) animationFrame = requestAnimationFrame(updateActivePreview);
  }

  function arrangePreviews() {
    const staged = wide.matches && motion.matches;
    const inlineReveal = !staged && motion.matches && inlineObserver !== null;
    story.classList.toggle('is-staged', staged);
    story.classList.toggle('can-reveal-inline', inlineReveal);
    stage.hidden = !staged;
    active = -1;
    inlineObserver?.disconnect();

    art.forEach((figure, index) => {
      figure.classList.remove('is-current');
      const parent = staged ? stage : steps[index];
      if (figure.parentElement !== parent) parent.append(figure);
      if (inlineReveal && !figure.classList.contains('has-entered')) inlineObserver.observe(figure);
    });
    schedulePreviewUpdate();
  }

  motion.addEventListener('change', arrangePreviews);
  wide.addEventListener('change', arrangePreviews);
  window.addEventListener('scroll', schedulePreviewUpdate, {passive: true});
  window.addEventListener('resize', schedulePreviewUpdate, {passive: true});
  arrangePreviews();
}
