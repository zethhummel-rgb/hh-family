const groceries = document.querySelector('[data-grocery-demo]');
const rsvp = document.querySelector('[data-rsvp-demo]');
const result = document.querySelector('[data-rsvp-result]');

groceries.disabled = false;
rsvp.disabled = false;

rsvp.addEventListener('change', event => {
  result.textContent = 'Sample reply: ' + event.target.value;
});
