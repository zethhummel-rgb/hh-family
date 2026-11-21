const rsvp = document.querySelector('[data-rsvp-demo]');
const result = document.querySelector('[data-rsvp-result]');

function showReply() {
  const reply = rsvp.querySelector('input:checked');
  result.textContent = reply ? 'Sample reply: ' + reply.value : '';
}

rsvp.addEventListener('change', showReply);
showReply();
