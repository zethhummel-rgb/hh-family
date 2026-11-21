if ('IntersectionObserver' in window && matchMedia('(prefers-reduced-motion: no-preference)').matches) {
  const observer = new IntersectionObserver(entries => {
    for (const {isIntersecting, target} of entries) {
      if (!isIntersecting) continue;
      target.classList.add('has-entered');
      observer.unobserve(target);
    }
  }, {threshold: .15});
  document.querySelectorAll('[data-highlight-art]').forEach(art => observer.observe(art));
}
