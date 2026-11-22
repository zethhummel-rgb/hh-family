const appLink = document.querySelector('[data-app-return]');
if (appLink && new URLSearchParams(location.search).get('from') === 'app') {
  appLink.textContent = 'Return to app';
  appLink.classList.add('action', 'primary', 'return-to-app');
  document.body.classList.add('about-from-app');
}

const rsvp = document.querySelector('[data-rsvp-demo]');
const result = document.querySelector('[data-rsvp-result]');

function showReply() {
  const reply = rsvp.querySelector('input:checked');
  result.textContent = reply ? 'Sample reply: ' + reply.value : '';
}

rsvp.addEventListener('change', showReply);
showReply();
