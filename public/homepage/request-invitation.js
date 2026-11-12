const form = document.querySelector('[data-invitation-request]');
const fields = form.querySelector('fieldset');
const send = form.querySelector('button');
const status = document.querySelector('[data-request-status]');
const error = document.querySelector('[data-request-error]');
let pending = false;
let previousRequest;

form.hidden = false;
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (pending) return;
  const answers = Object.fromEntries([...new FormData(form)].map(([key, value]) => [key, value.trim()]));
  const payload = JSON.stringify(answers);
  if (previousRequest?.payload !== payload) previousRequest = {payload, id: crypto.randomUUID()};

  pending = true;
  fields.disabled = true;
  form.setAttribute('aria-busy', 'true');
  send.textContent = 'Sending…';
  status.textContent = '';
  error.textContent = '';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(form.dataset.endpoint, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({...answers, requestId: previousRequest.id}),
      signal: controller.signal,
    });
    const result = await response.json();
    if (!response.ok || !result.sent) {
      error.textContent = result.error || 'Could not send your request. Your answers are still here.';
      return;
    }
    form.reset();
    previousRequest = undefined;
    status.textContent = 'Thanks for reaching out. Your request was sent to HH.';
  } catch {
    error.textContent = 'Could not confirm your request. Your answers are still here. Try again or email the HH team.';
  } finally {
    clearTimeout(timeout);
    pending = false;
    fields.disabled = false;
    form.setAttribute('aria-busy', 'false');
    send.textContent = 'Send request';
  }
});
