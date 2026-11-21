const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const {setTimeout: delay} = require('node:timers/promises');
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
    const demoRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (request.url() === requestEndpoint) return;
      if (new URL(request.url()).origin !== origin || request.method() !== 'GET') demoRequests.push(request.url());
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
      const heroExplore = page.locator('.hero').getByRole('link', {name: 'Explore HH'});
      assert.equal(await heroExplore.getAttribute('href'), './about.html');
      assert.equal(await page.getByRole('link', {name: 'Try the demos'}).getAttribute('href'), './about.html#everyday');

      const highlights = page.locator('#explore .feature-preview');
      assert.equal(await highlights.count(), 3);
      assert.deepEqual(await highlights.getByRole('heading', {level: 3}).allTextContents(), [
        'See who’s going where', 'Turn meal plans into groceries', 'Know who’s coming',
      ]);
      const screens = page.locator('main img');
      assert.equal(await screens.count(), 4, 'Homepage has one hero image and three feature images');
      for (const screen of await screens.all()) {
        await screen.scrollIntoViewIfNeeded();
        assert.ok(await screen.evaluate(async image => { await image.decode(); return image.naturalWidth > 0; }));
      }
      assert.equal(await page.locator('.feature-art').first().evaluate(art => getComputedStyle(art).animationName), 'none');
      assert.equal(await highlights.first().evaluate(card => getComputedStyle(card).position), 'static');
      assert.equal(await page.getByRole('checkbox', {name: 'Eggs'}).count(), 0, 'Hands-on demos belong on Explore');
      assert.equal(await page.locator('[data-meal-carousel]').count(), 0, 'Meal walkthrough belongs on Explore');

      if (width === 390 || width === 1440) {
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({path: path.join(out, 'public-home-first-' + width + '.png')});
        await page.screenshot({path: path.join(out, 'public-home-' + width + '.png'), fullPage: true});
      }
      const syncLink = page.locator('.hero').getByRole('link', {name: 'Using Google Calendar with HH'});
      assert.equal(await syncLink.getAttribute('href'), './about.html#google');
      if (width === 390) {
        await syncLink.click();
        await page.waitForURL(app + 'about.html#google');
        await page.locator('#google summary').click();
        assert.match(await page.locator('#google').innerText(), /connect a dedicated Google calendar to see a copy of your HH plans/);
        await page.goBack({waitUntil: 'load'});
      }
      await heroExplore.click();
      await page.waitForURL(app + 'about.html');
      await page.getByRole('heading', {name: 'Explore HH', exact: true}).waitFor();
      assert.match(await page.locator('meta[name=robots]').getAttribute('content'), /\bnoindex\b/);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Explore fits width ' + width);
      assert.equal(await page.locator('.demo-section img').evaluateAll(async images => {
        await Promise.all(images.map(image => image.decode()));
        return images.length === 2 && images.every(image => image.naturalWidth > 0);
      }), true);
      if (width === 390 || width === 1440) {
        await page.screenshot({path: path.join(out, 'public-about-first-' + width + '.png')});
      }

      const originalSubmissions = submissions.length;
      const eggs = page.getByRole('checkbox', {name: 'Eggs'});
      await eggs.focus();
      await page.keyboard.press('Space');
      assert.equal(await eggs.isChecked(), true);
      await eggs.uncheck();
      assert.equal(await eggs.isChecked(), false);
      for (const reply of ['Yes', 'Maybe', 'No']) {
        await page.getByText(reply, {exact: true}).click();
        assert.equal(await page.getByRole('radio', {name: reply, exact: true}).isChecked(), true);
        assert.equal(await page.getByRole('status').textContent(), 'Sample reply: ' + reply);
      }
      assert.equal(submissions.length, originalSubmissions, 'Explore has no live RSVP or invitation submissions');

      const track = page.getByRole('group', {name: 'Meal planner previews'});
      const position = page.locator('[data-meal-position]');
      const previousMeal = page.getByRole('button', {name: 'Previous meal preview'});
      const nextMeal = page.getByRole('button', {name: 'Next meal preview'});
      assert.equal(await previousMeal.getAttribute('aria-disabled'), 'true');
      await nextMeal.click();
      assert.equal(await position.textContent(), '2 / 3');
      await track.focus();
      await page.keyboard.press('End');
      assert.equal(await position.textContent(), '3 / 3');
      assert.equal(await nextMeal.getAttribute('aria-disabled'), 'true');
      const ingredients = track.getByRole('img', {name: /eggs and blueberries selected/});
      assert.equal(await ingredients.evaluate(async img => {
        await img.decode();
        const image = img.getBoundingClientRect();
        const track = img.closest('.meal-track').getBoundingClientRect();
        return img.naturalWidth > 0 && image.left >= track.left && image.right <= track.right + 1;
      }), true, 'The last preview snaps fully into view');
      await previousMeal.click();
      assert.equal(await position.textContent(), '2 / 3');
      await track.focus();
      await page.keyboard.press('Home');
      assert.equal(await position.textContent(), '1 / 3');

      const extraFeatures = page.locator('.feature-details details');
      assert.equal(await extraFeatures.count(), 4);
      for (const feature of await extraFeatures.all()) {
        assert.equal(await feature.getAttribute('open'), null);
        await feature.locator('summary').click();
        const preview = feature.getByRole('img');
        await preview.scrollIntoViewIfNeeded();
        // A lazy image can be visible before Firefox starts its request.
        await page.waitForFunction(() => {
          const image = document.querySelector('.feature-details details[open] img');
          return image?.complete && image.naturalWidth > 0;
        });
        await feature.locator('summary').click();
      }
      await page.getByText('Using Google Calendar with HH', {exact: true}).click();
      assert.equal(await page.getByRole('link', {name: 'Read about Google access and privacy'}).getAttribute('href'), './privacy.html#google-calendar');
      await page.getByText('Using Google Calendar with HH', {exact: true}).click();
      if (width === 390 || width === 1440) {
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({path: path.join(out, 'public-about-' + width + '.png'), fullPage: true});
      }

      await page.getByRole('link', {name: 'Request an invitation', exact: true}).click();
      await page.getByRole('heading', {name: 'Request an invitation', exact: true}).waitFor();
      assert.equal(page.url(), app + 'request-invitation.html');
      assert.match(await page.locator('meta[name=robots]').getAttribute('content'), /\bnoindex\b/);
      assert.equal(await page.getByRole('link', {name: 'Explore HH', exact: true}).getAttribute('href'), './about.html');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Request page fits width ' + width);
      const sendRequest = page.getByRole('button', {name: 'Send request', exact: true});
      await sendRequest.waitFor();
      assert.equal(await page.getByRole('link', {name: 'hummelhomeapp@gmail.com'}).getAttribute('href'), 'mailto:hummelhomeapp@gmail.com');
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
        assert.equal(await page.getByLabel('Email address', {exact: true}).inputValue(), 'alex@example.invalid');
        assert.equal(await page.locator('#request-message').inputValue(), 'I would like to try HH.');
        await sendRequest.click();
        await page.getByRole('status').getByText('Thanks for reaching out. Your request was sent to HH.').waitFor();
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
    assert.deepEqual(demoRequests, [], 'Public demos never contact a backend or submit data');

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
    assert.equal(await page.getByRole('link', {name: 'About HH', exact: true}).getAttribute('href'), './about.html');
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
        const art = motionPage.locator('[data-highlight-art]');
        for (const item of await art.all()) {
          await item.evaluate(element => element.scrollIntoView({block: 'center'}));
          if (reducedMotion === 'no-preference') {
            await item.and(motionPage.locator('.has-entered')).waitFor();
            assert.equal(await item.evaluate(element => getComputedStyle(element).animationName), 'highlight-in');
          } else {
            assert.equal(await item.evaluate(element => getComputedStyle(element).animationName), 'none');
          }
        }
        assert.equal(await motionPage.locator('.feature-preview').evaluateAll(cards => {
          const boxes = cards.map(card => card.getBoundingClientRect());
          // Fractional layout can differ by less than a CSS pixel across engines.
          return boxes.every((box, index) => index === 0 || boxes[index - 1].bottom <= box.top + 1);
        }), true, 'Feature previews stay in reading order at all motion settings');

        if (width === 390 && height === 844) {
          await motionPage.goto(app + 'about.html');
          const track = motionPage.getByRole('group', {name: 'Meal planner previews'});
          await track.evaluate(async element => {
            element.scrollIntoView({block: 'center'});
            // Let the browser commit the viewport scroll before sending touch input.
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          });
          const browserName = process.env.HH_BROWSER || 'chromium';
          if (browserName === 'chromium') {
            const session = await motionContext.newCDPSession(motionPage);
            const box = await track.boundingBox();
            const y = Math.round(box.y + box.height / 2);
            const touch = (type, x) => session.send('Input.dispatchTouchEvent', {
              type, touchPoints: type === 'touchEnd' ? [] : [{x, y, id: 0}],
            });
            await touch('touchStart', box.x + box.width * .87);
            for (let step = 1; step <= 12; step += 1) {
              await delay(24);
              await touch('touchMove', box.x + box.width * (.87 - step * .065));
            }
            await touch('touchEnd');
          } else {
            await track.evaluate(track => track.scrollTo({left: track.children[1].offsetLeft}));
          }
          await motionPage.waitForFunction(() => {
            const track = document.querySelector('.meal-track');
            return Math.abs(track.scrollLeft - track.children[1].offsetLeft) < 2 &&
              document.querySelector('[data-meal-position]').textContent === '2 / 3';
          }, undefined, {timeout: 8_000});
          await motionPage.screenshot({path: path.join(out, 'public-about-meal-carousel-390.png')});
        }
      } finally {
        await motionContext.close();
      }
    }

    const staticContext = await browser.newContext({javaScriptEnabled: false, viewport: {width: 390, height: 844}});
    try {
      const staticPage = await staticContext.newPage();
      await staticPage.goto(app + 'home.html');
      assert.equal(await staticPage.locator('.feature-preview').count(), 3);
      await staticPage.locator('.hero').getByRole('link', {name: 'Explore HH'}).click();
      await staticPage.getByRole('checkbox', {name: 'Eggs'}).check();
      assert.equal(await staticPage.getByRole('checkbox', {name: 'Eggs'}).isChecked(), true);
      assert.equal(await staticPage.getByRole('heading', {name: 'Explore the meal planner'}).isVisible(), true);
    } finally {
      await staticContext.close();
    }
    assert.deepEqual(errors, []);
    console.log('Public homepage, Explore demos, meal previews, mobile fit, invitation request, noindex, and legacy email landing passed.');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
