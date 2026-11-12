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
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const errors = [];
    const demoRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (new URL(request.url()).origin !== origin || request.method() !== 'GET') demoRequests.push(request.url());
    });
    const out = path.resolve(process.env.HH_POLISH_OUTPUT || 'artifacts/polish');
    await fs.mkdir(out, {recursive: true});

    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({width, height: 900});
      const response = await page.goto(app + 'home.html');
      assert.equal(response.status(), 200);
      await page.getByRole('heading', {name: 'What’s the plan?', exact: true}).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Homepage fits width ' + width);
      assert.equal(await page.getByRole('link', {name: 'Sign in', exact: true}).isVisible(), true);
      const explore = page.locator('.hero').getByRole('link', {name: 'Explore HH'});
      assert.equal(await explore.getAttribute('href'), './about.html');
      await page.goto(app + 'home.html#explore');
      assert.equal(await page.locator('.feature-scene').count(), 3);
      const screens = page.locator('.home-preview img, .app-screen img');
      assert.equal(await screens.count(), 7);
      for (const screen of await screens.all()) {
        await screen.scrollIntoViewIfNeeded();
        assert.equal(await screen.evaluate(async image => { await image.decode(); return image.naturalWidth; }), 780);
      }
      assert.equal(await page.locator('.feature-scene').first().evaluate(scene => getComputedStyle(scene).transform), 'none', 'Reduced motion keeps tiles still');
      assert.equal(await page.locator('.scene-card').first().evaluate(card => getComputedStyle(card).position), 'static', 'Reduced motion keeps tiles in reading order');
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
      await page.evaluate(() => window.scrollTo(0, 0));
      if (width === 390 || width === 1440) await page.screenshot({path: path.join(out, 'public-home-' + width + '.png'), fullPage: true});

      const eggs = page.getByRole('checkbox', {name: 'Eggs'});
      assert.equal(await eggs.isVisible(), false);
      await page.getByText('Try a grocery list or RSVP', {exact: true}).click();
      assert.equal(await page.locator('.week-board img').evaluateAll(async images => {
        await Promise.all(images.map(image => image.decode()));
        return images.every(image => image.naturalWidth > 0);
      }), true, 'All demo illustrations load');
      await eggs.check();
      assert.equal(await eggs.isChecked(), true);
      await eggs.uncheck();
      assert.equal(await eggs.isChecked(), false);
      for (const reply of ['Yes', 'Maybe', 'No']) {
        await page.getByText(reply, {exact: true}).click();
        assert.equal(await page.getByRole('radio', {name: reply, exact: true}).isChecked(), true);
        assert.equal(await page.getByRole('status').textContent(), 'Sample reply: ' + reply);
      }
      await page.locator('.hero').getByRole('link', {name: 'Request an invitation'}).click();
      await page.getByRole('heading', {name: 'Request an invitation', exact: true}).waitFor();
      assert.equal(page.url(), app + 'request-invitation.html');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Request page fits width ' + width);
      const draft = await page.getByRole('link', {name: 'Open email draft'}).getAttribute('href');
      assert.equal(draft, 'mailto:hummelhomeapp@gmail.com?subject=HH%20Family%20invitation%20request');
      if (width === 390) await page.screenshot({path: path.join(out, 'public-invitation-request-390.png'), fullPage: true});
      await page.getByRole('link', {name: 'Back to HH Family'}).click();
      assert.equal(page.url(), app + 'home.html');
      // Let Firefox finish this navigation before resizing the next viewport.
      await page.waitForLoadState('load');
      await page.getByRole('link', {name: 'More about HH', exact: true}).click();
      await page.waitForLoadState('load');
      assert.equal(page.url(), app + 'about.html');
      await page.getByRole('heading', {name: 'A little more together.', exact: true}).waitFor();
      const chapters = page.locator('.about-chapter');
      assert.equal(await chapters.count(), 4);
      assert.equal(await chapters.first().evaluate(card => getComputedStyle(card).position), 'static', 'Reduced motion keeps Explore tiles in reading order');
      assert.equal(await page.locator('.chapter-sheet').first().evaluate(sheet => getComputedStyle(sheet).transform), 'none');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'About page fits width ' + width);
      await page.getByRole('link', {name: 'Take a closer look'}).click();
      assert.equal(new URL(page.url()).hash, '#everyday');
      const aboutScreens = page.locator('.chapter-art img');
      assert.equal(await aboutScreens.count(), 8);
      for (const screen of await aboutScreens.all()) {
        await screen.scrollIntoViewIfNeeded();
        assert.equal(await screen.evaluate(async image => { await image.decode(); return image.naturalWidth; }), 780);
      }
      const previews = page.getByRole('group', {name: 'Calendar and reminders'});
      assert.equal(await previews.getByText('Family calendar', {exact: true}).count(), 1);
      if (width <= 590) {
        const range = await previews.evaluate(rail => {
          rail.scrollLeft = rail.scrollWidth;
          return rail.scrollWidth - rail.clientWidth;
        });
        assert.ok(range > 100, 'The second preview can be swiped into view on phones');
        await page.waitForFunction(() => {
          const rail = document.querySelector('.chapter-art');
          return Math.abs(rail.scrollWidth - rail.clientWidth - rail.scrollLeft) <= 1;
        });
      } else {
        assert.equal(await previews.evaluate(rail => rail.scrollWidth <= rail.clientWidth), true);
      }
      await page.getByText('Using Google Calendar with HH', {exact: true}).click();
      assert.equal(await page.getByRole('link', {name: 'Read about Google access and privacy'}).getAttribute('href'), './privacy.html#google-calendar');
      if (width === 390 || width === 1440) await page.screenshot({path: path.join(out, 'public-about-' + width + '.png'), fullPage: true});
      await page.getByRole('link', {name: 'Request an invitation', exact: true}).click();
      await page.getByRole('heading', {name: 'Request an invitation', exact: true}).waitFor();
      assert.equal(page.url(), app + 'request-invitation.html');
      await page.goto(app + 'home.html');
    }
    assert.deepEqual(demoRequests, [], 'Public demos never contact a backend or submit data');

    // Previously sent event emails still link to this fragment.
    await page.setContent('<a href="' + app + 'about.html#start">Learn about HH and request an invite</a>');
    await page.getByRole('link', {name: 'Learn about HH and request an invite'}).click();
    await page.waitForURL(app + 'home.html');
    await page.getByRole('heading', {name: 'What’s the plan?', exact: true}).waitFor();
    assert.equal(await page.evaluate(() => scrollY), 0, 'Legacy event email opens the homepage hero');
    await page.getByRole('link', {name: 'Sign in', exact: true}).click();
    assert.equal(page.url(), app);
    await page.getByRole('heading', {name: 'Welcome home.'}).waitFor();
    assert.equal(await page.getByRole('link', {name: 'About HH', exact: true}).getAttribute('href'), './about.html');
    assert.deepEqual(errors, []);

    for (const [width, height, reducedMotion] of [
      [320, 420, 'no-preference'],
      [375, 560, 'no-preference'],
      [390, 620, 'reduce'],
      [390, 844, 'no-preference'],
      [844, 390, 'no-preference'],
      [1440, 900, 'no-preference'],
    ]) {
      const phone = width < 1000;
      const stackContext = await browser.newContext({
        viewport: {width, height},
        reducedMotion,
        hasTouch: phone,
        isMobile: phone && process.env.HH_BROWSER !== 'firefox',
        serviceWorkers: 'block',
      });
      try {
        await stackContext.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
        const stackPage = await stackContext.newPage();
        stackPage.on('pageerror', error => errors.push(error.message));
        await stackPage.goto(app + 'home.html');
        if (reducedMotion === 'no-preference') {
          const cards = stackPage.locator('.scene-card');
          await stackPage.locator('[data-motion-ready]').waitFor();
          for (const index of [1, 2]) {
            const incoming = cards.nth(index);
            await incoming.evaluate(card => scrollBy(0, card.getBoundingClientRect().top - innerHeight * .82));
            await incoming.waitFor();
            await stackPage.waitForFunction(index => {
              const scene = document.querySelectorAll('.feature-scene')[index];
              const transform = new DOMMatrix(getComputedStyle(scene).transform);
              return transform.a < .98 && Math.abs(transform.e) > 4 && transform.f > 8;
            }, index);
            const scales = await incoming.evaluate(async card => {
              const panel = card.querySelector('[data-tile-panel]');
              scrollBy(0, card.getBoundingClientRect().top - innerHeight * .3);
              const scales = [];
              for (let sample = 0; sample < 7; sample += 1) {
                await new Promise(requestAnimationFrame);
                scales.push(new DOMMatrix(getComputedStyle(panel).transform).a);
              }
              return scales;
            });
            assert.ok(new Set(scales).size >= 3, 'The tile grows over multiple frames');
            await stackPage.waitForFunction(index => {
              const scenes = document.querySelectorAll('.feature-scene');
              const previous = scenes[index - 1].getBoundingClientRect();
              const front = scenes[index].getBoundingClientRect();
              const target = document.elementFromPoint(innerWidth / 2, front.top + 20);
              const scale = new DOMMatrix(getComputedStyle(scenes[index - 1]).transform).a;
              return front.top < previous.bottom && target?.closest('.feature-scene') === scenes[index] && scale < .98;
            }, index);
            if (width === 390 && height === 844 && index === 1) {
              await stackPage.screenshot({path: path.join(out, 'public-home-tile-overlap-390.png')});
            }
          }
        }

        if (width === 390 && height === 844) {
          const track = stackPage.getByRole('group', {name: 'Meal planner previews'});
          await track.evaluate(async element => {
            element.scrollIntoView({block: 'center'});
            // Let the browser commit the viewport scroll before sending touch input.
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          });
          const browserName = process.env.HH_BROWSER || 'chromium';
          if (browserName === 'chromium') {
            const session = await stackContext.newCDPSession(stackPage);
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
          await stackPage.waitForFunction(() => {
            const track = document.querySelector('.meal-track');
            return Math.abs(track.scrollLeft - track.children[1].offsetLeft) < 2 &&
              document.querySelector('[data-meal-position]').textContent === '2 / 3';
          }, undefined, {timeout: 8_000});
          await stackPage.screenshot({path: path.join(out, 'public-home-meal-carousel-390.png')});
        }

        await stackPage.goto(app + 'about.html');
        await stackPage.locator('[data-motion-ready]').waitFor();
        for (const index of reducedMotion === 'no-preference' ? [1, 2, 3] : []) {
          await stackPage.evaluate(nextIndex => {
            window.scrollTo(0, 0);
            const next = document.querySelectorAll('.about-chapter')[nextIndex];
            window.scrollTo(0, next.getBoundingClientRect().top - 150);
          }, index);
          await stackPage.waitForFunction(nextIndex => {
            const sheets = document.querySelectorAll('.chapter-sheet');
            const previous = sheets[nextIndex - 1];
            const next = sheets[nextIndex];
            const back = previous.getBoundingClientRect();
            const front = next.getBoundingClientRect();
            const visible = document.elementFromPoint(innerWidth / 2, front.top + 18);
            return getComputedStyle(previous.parentElement).position === 'sticky' &&
              back.bottom > front.top &&
              visible?.closest('.chapter-sheet') === next &&
              new DOMMatrix(getComputedStyle(previous).transform).a < .99;
          }, index, {timeout: 5000});
        }
        if (width === 375 || width === 1440) {
          await stackPage.screenshot({path: path.join(out, 'public-about-stack-' + width + '.png')});
        }
      } finally {
        await stackContext.close();
      }
    }
    assert.deepEqual(errors, []);
    console.log('Homepage and Explore tile motion, swipeable previews, reduced motion, and legacy email landing passed.');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
