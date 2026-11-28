const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const {launchBrowser} = require('./browser.cjs');

const root = path.resolve('dist');
const scope = '/hh-family/';
const mediaTypes = {
  '.css': 'text/css',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

async function serve(request, response) {
  const {pathname} = new URL(request.url, 'http://localhost');
  if (!pathname.startsWith(scope)) {
    response.writeHead(404).end();
    return;
  }
  const filename = path.resolve(root, pathname.slice(scope.length) || 'index.html');
  if (!filename.startsWith(root + path.sep)) {
    response.writeHead(404).end();
    return;
  }
  try {
    const body = await fs.readFile(filename);
    response.writeHead(200, {'Content-Type': mediaTypes[path.extname(filename)] || 'application/octet-stream'}).end(body);
  } catch {
    response.writeHead(404).end();
  }
}

async function run() {
  const server = http.createServer(serve);
  let browser;
  try {
    await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
    const origin = 'http://127.0.0.1:' + server.address().port;
    const app = origin + scope;
    browser = await launchBrowser();
    const context = await browser.newContext({serviceWorkers: 'block', reducedMotion: 'reduce'});
    const requestEndpoint = 'https://njpdqiwrwgoothkstoql.supabase.co/functions/v1/request-pilot-invitation';
    const submissions = [];
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await context.route(requestEndpoint, async route => {
      if (route.request().method() === 'OPTIONS') {
        return route.fulfill({status: 204, headers: {'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'content-type'}});
      }
      submissions.push(route.request().postDataJSON());
      const success = submissions.length > 1;
      await route.fulfill({status: success ? 200 : 503, headers: {'Access-Control-Allow-Origin': origin}, json: success ? {sent: true} : {error: 'Please try again shortly.'}});
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const errors = [];
    const unexpectedRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (request.url() === requestEndpoint) return;
      if (new URL(request.url()).origin !== origin || request.method() !== 'GET') unexpectedRequests.push(request.url());
    });
    const out = path.resolve(process.env.HH_POLISH_OUTPUT || 'artifacts/polish');
    await fs.mkdir(out, {recursive: true});

    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({width, height: 900});
      const response = await page.goto(app + 'home.html');
      assert.equal(response.status(), 200);
      await page.getByRole('heading', {name: 'See what’s coming up for everyone.', exact: true}).waitFor();
      assert.match(await page.locator('meta[name=robots]').getAttribute('content'), /\bnoindex\b/);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Homepage fits width ' + width);
      assert.equal(await page.getByRole('link', {name: 'Sign in', exact: true}).isVisible(), true);
      assert.equal(await page.locator('.home-header').evaluate(header => {
        const {left, right} = header.getBoundingClientRect();
        return left === 0 && Math.abs(right - document.documentElement.clientWidth) < 1;
      }), true, 'Header spans the page');
      assert.equal(await page.getByRole('link', {name: 'Try the demos'}).count(), 0);

      const highlights = page.locator('#explore .feature-preview');
      assert.deepEqual(await highlights.getByRole('heading', {level: 3}).allTextContents(), [
        'See who’s going where', 'Turn meal plans into groceries', 'Know who’s coming',
        'To Do & Reminders', 'Family notes', 'Colour palettes',
      ]);
      const screens = page.locator('main img');
      assert.equal(await screens.count(), 7, 'Homepage has one hero image and six feature images');
      for (const screen of await screens.all()) {
        await screen.scrollIntoViewIfNeeded();
        assert.ok(await screen.evaluate(async image => { await image.decode(); return image.naturalWidth > 0; }));
      }
      await page.getByRole('img', {name: /Sage & Linen selected/}).waitFor();
      assert.equal(await page.locator('.feature-stage').evaluate(stage => stage.hidden), true, 'Reduced motion keeps previews inline');

      if (width === 390 || width === 1440) {
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({path: path.join(out, 'public-home-first-' + width + '.png')});
        await page.screenshot({path: path.join(out, 'public-home-' + width + '.png'), fullPage: true});
      }
      const syncLink = page.locator('.hero').getByRole('link', {name: 'Using Google Calendar with HH'});
      assert.equal(await syncLink.getAttribute('href'), '#google');
      if (width === 390) {
        await syncLink.click();
        await page.waitForURL(app + 'home.html#google');
        assert.match(await page.locator('#google').innerText(), /connect a dedicated Google calendar to see a copy of your HH plans/);
        await page.getByRole('link', {name: 'Read about Google access and privacy'}).click();
        await page.waitForURL(app + 'privacy.html#google-calendar');
        await page.locator('#google-calendar').waitFor();
        await page.goto(app + 'home.html');
      }

      await page.locator('.hero').getByRole('link', {name: 'See how it works'}).click();
      await page.waitForURL(app + 'home.html#explore');
      await page.getByRole('heading', {name: 'A day with HH'}).waitFor();
      if (width === 1440) {
        await page.getByRole('navigation', {name: 'Main'}).getByRole('link', {name: 'How it works'}).click();
        assert.equal(page.url(), app + 'home.html#explore');
      }
      await page.locator('.hero').getByRole('link', {name: 'Request an invitation'}).click();
      await page.getByRole('heading', {name: 'Request an invitation', exact: true}).waitFor();
      assert.equal(page.url(), app + 'request-invitation.html');
      assert.match(await page.locator('meta[name=robots]').getAttribute('content'), /\bnoindex\b/);
      assert.equal(await page.getByRole('link', {name: 'How it works', exact: true}).getAttribute('href'), './home.html#explore');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Request page fits width ' + width);
      const sendRequest = page.getByRole('button', {name: 'Send request', exact: true});
      await sendRequest.waitFor();
      assert.equal(await page.getByRole('link', {name: 'humblehomeapp@gmail.com'}).getAttribute('href'), 'mailto:humblehomeapp@gmail.com');
      if (width === 390) {
        await page.screenshot({path: path.join(out, 'public-invitation-request-390.png'), fullPage: true});
        await sendRequest.click();
        assert.equal(submissions.length, 0, 'Required answers prevent an empty submission');
        await page.getByLabel('Your name', {exact: true}).fill('Alex Example');
        await page.getByLabel('Email address', {exact: true}).fill('alex@example.invalid');
        await page.getByLabel('Where did you hear about us?').fill('Calendar invite');
        await page.getByLabel('Would you like to be part of the HH pilot?').selectOption('yes');
        await page.getByLabel(/Anything else/).fill('I would like to try HH.');
        await sendRequest.click();
        await page.getByRole('alert').getByText('Please try again shortly.').waitFor();
        assert.equal(await page.getByRole('dialog').count(), 0, 'Failed delivery does not show the confirmation');
        assert.equal(await page.getByLabel('Email address', {exact: true}).inputValue(), 'alex@example.invalid');
        assert.equal(await page.locator('#request-message').inputValue(), 'I would like to try HH.');
        await sendRequest.click();
        const confirmation = page.getByRole('dialog', {name: 'Invitation request sent'});
        await confirmation.waitFor();
        await confirmation.getByText('Your request should be approved within 24 hours. Please check your junk mail for our reply.', {exact: true}).waitFor();
        await confirmation.getByText('Thank you for signing up.', {exact: false}).waitFor();
        const done = confirmation.getByRole('button', {name: 'Done', exact: true});
        await page.waitForFunction(() => document.activeElement?.textContent === 'Done');
        assert.equal(await confirmation.evaluate(dialog => {
          const {left, right, top, bottom} = dialog.getBoundingClientRect();
          return left >= 0 && top >= 0 && right <= innerWidth && bottom <= innerHeight;
        }), true, 'The confirmation fits the mobile viewport');
        await page.screenshot({path: path.join(out, 'invitation-request-sent-390.png')});
        await done.click();
        await confirmation.waitFor({state:'hidden'});
        await page.waitForFunction(() => document.activeElement === document.querySelector('[data-invitation-request] button'));
        assert.equal(submissions.length, 2);
        assert.deepEqual(submissions[0], submissions[1], 'Retrying the same request uses the same ID');
        assert.deepEqual({...submissions[1], requestId: undefined}, {name:'Alex Example',email:'alex@example.invalid',source:'Calendar invite',interest:'yes',message:'I would like to try HH.',website:'',requestId:undefined});
        assert.equal(await page.getByLabel('Email address', {exact: true}).inputValue(), '');
      }
      await page.getByRole('link', {name: 'Back to HH Family'}).click();
      await page.waitForURL(app + 'home.html');
      await page.waitForLoadState('load');
      assert.equal(await page.locator('.hero').getByRole('link', {name: 'Request an invitation'}).getAttribute('href'), './request-invitation.html');
    }
    assert.deepEqual(unexpectedRequests, [], 'Browsing the homepage and issuing navigation never contact a backend');

    // Previously shared feature and calendar links keep their destinations.
    for (const [oldFragment, newFragment] of [
      ['#everyday', '#explore'], ['#google', '#google'],
      ['#meal-planner', '#meal-planner'], ['#request', '#request'],
    ]) {
      await page.goto(app + 'about.html' + oldFragment, {waitUntil: 'commit'});
      await page.waitForURL(app + 'home.html' + newFragment);
      await page.locator(newFragment).waitFor();
    }


    // Previously sent event emails still link to this fragment.
    const legacyEmail = app + '__legacy-email';
    await page.route(legacyEmail, route => route.fulfill({
      contentType: 'text/html',
      body: '<a href="./about.html#start">Learn about HH and request an invite</a>',
    }));
    await page.goto(legacyEmail);
    await page.getByRole('link', {name: 'Learn about HH and request an invite'}).click();
    await page.waitForURL(app + 'home.html');
    await page.getByRole('heading', {name: 'See what’s coming up for everyone.', exact: true}).waitFor();
    assert.equal(await page.evaluate(() => scrollY), 0, 'Legacy event email opens the homepage hero');
    await page.getByRole('link', {name: 'Sign in', exact: true}).click();
    assert.equal(page.url(), app);
    await page.getByRole('heading', {name: 'Welcome home.'}).waitFor();
    const aboutLink = page.getByRole('link', {name: 'About HH', exact: true});
    assert.equal(await aboutLink.getAttribute('href'), './about.html?from=app');
    assert.equal(await aboutLink.getAttribute('target'), '_blank');
    const [aboutWindow] = await Promise.all([context.waitForEvent('page', {timeout: 10_000}), aboutLink.click()]);
    await aboutWindow.waitForURL(app + 'home.html?from=app');
    await aboutWindow.getByRole('link', {name: 'Return to app', exact: true}).click();
    await aboutWindow.waitForURL(app);
    await aboutWindow.getByRole('heading', {name: 'Welcome home.'}).waitFor();
    await aboutWindow.close();
    assert.equal(page.url(), app);

    const installed = await browser.newContext({
      viewport: {width: 320, height: 720}, hasTouch: true, serviceWorkers: 'block', reducedMotion: 'reduce',
    });
    try {
      await installed.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      await installed.addInitScript(() => Object.defineProperty(navigator, 'standalone', {value: true, configurable: true}));
      const phone = await installed.newPage();
      phone.setDefaultTimeout(10_000);
      await phone.goto(app);
      const phoneAbout = phone.getByRole('link', {name: 'About HH', exact: true});
      assert.equal(await phoneAbout.getAttribute('target'), null);
      await phoneAbout.click();
      await phone.waitForURL(app + 'home.html?from=app');
      const back = phone.getByRole('link', {name: 'Return to app', exact: true});
      const backBox = await back.boundingBox();
      assert(backBox && backBox.height >= 44 && backBox.x + backBox.width <= 320);
      assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await back.click();
      await phone.waitForURL(app);
      await phone.getByRole('heading', {name: 'Welcome home.'}).waitFor();

      for (const legalPage of ['privacy.html', 'terms.html']) {
        await phone.goto(app + legalPage);
        assert.equal(await phone.locator('meta[name="theme-color"]').getAttribute('content'), '#f7f9f5');
        assert.equal(await phone.locator('body').evaluate(body => getComputedStyle(body).backgroundColor), 'rgb(247, 249, 245)');
        assert.equal(await phone.locator('.open-app').evaluate(link => getComputedStyle(link).backgroundColor), 'rgb(69, 99, 77)');
        assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      }
    } finally {
      await installed.close();
    }
    assert.deepEqual(errors, []);

    for (const [width, height, reducedMotion] of [
      [320, 420, 'no-preference'],
      [390, 620, 'reduce'],
      [390, 844, 'no-preference'],
      [1440, 900, 'no-preference'],
    ]) {
      const phone = width < 1000;
      const motionContext = await browser.newContext({
        viewport: {width, height},
        reducedMotion,
        hasTouch: phone,
        isMobile: phone && process.env.HH_BROWSER !== 'firefox',
        serviceWorkers: 'block',
      });
      try {
        await motionContext.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
        const motionPage = await motionContext.newPage();
        motionPage.on('pageerror', error => errors.push(error.message));
        await motionPage.goto(app + 'home.html');
        const stage = motionPage.locator('.feature-stage');
        const previews = motionPage.locator('[data-highlight-art]');
        if (width >= 820 && reducedMotion === 'no-preference') {
          await stage.waitFor();
          assert.equal(await stage.evaluate(element => getComputedStyle(element).position), 'sticky');
          const stepCopy = await motionPage.locator('.feature-copy').all();
          await motionPage.waitForFunction(() => document.querySelectorAll('.feature-stage > [data-highlight-art]').length === 6);
          for (const index of [0, 1, 2, 3, 4, 5, 2]) {
            await stepCopy[index].evaluate(element => {
              scrollTo(0, scrollY + element.getBoundingClientRect().top - innerHeight * .42);
            });
            await motionPage.waitForFunction(index => {
              const current = document.querySelectorAll('.feature-stage .is-current');
              const selected = document.querySelectorAll('.feature-stage > [data-highlight-art]')[index];
              return current.length === 1 && current[0] === selected;
            }, index);
            const currentImage = stage.locator('.is-current img');
            assert.ok(await currentImage.evaluate(async image => { await image.decode(); return image.naturalWidth > 0; }));
          }
        } else {
          await stage.waitFor({state: 'hidden'});
          for (const item of await previews.all()) {
            await item.evaluate(element => element.scrollIntoView({block: 'center'}));
            if (reducedMotion === 'no-preference') {
              await item.and(motionPage.locator('.has-entered')).waitFor();
              assert.match(await item.evaluate(element => getComputedStyle(element).transitionProperty), /opacity/);
            } else {
              assert.equal(await item.evaluate(element => getComputedStyle(element).transitionDuration), '0s');
            }
          }
        }
        assert.equal(await motionPage.locator('.feature-preview').evaluateAll(cards => {
          const boxes = cards.map(card => card.getBoundingClientRect());
          return boxes.every((box, index) => index === 0 || boxes[index - 1].bottom <= box.top + 1);
        }), true, 'Feature previews stay in reading order at all motion settings');
      } finally {
        await motionContext.close();
      }
    }

    const staticContext = await browser.newContext({javaScriptEnabled: false, viewport: {width: 390, height: 844}});
    try {
      const staticPage = await staticContext.newPage();
      await staticPage.goto(app + 'home.html');
      assert.equal(await staticPage.locator('.feature-preview').count(), 6);
      assert.equal(await staticPage.locator('.feature-stage').evaluate(stage => stage.hidden), true);
      await staticPage.locator('.hero').getByRole('link', {name: 'See how it works'}).click();
      await staticPage.waitForURL(app + 'home.html#explore');
      await staticPage.getByRole('heading', {name: 'Colour palettes'}).waitFor();
      await staticPage.goto(app + 'about.html#start', {waitUntil: 'commit'});
      await staticPage.waitForURL(app + 'home.html');
      await staticPage.getByRole('heading', {name: 'See what’s coming up for everyone.', exact: true}).waitFor();
    } finally {
      await staticContext.close();
    }
    assert.deepEqual(errors, []);
    console.log('Public homepage, interactive feature previews, no-JS fallback, invitation request, noindex, and legacy links passed.');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
