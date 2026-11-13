// Regression checks for the redesigned presentation. Real services unless a test explicitly
// intercepts forecast responses to exercise unavailable/stale states.
import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 1672, height: 941 }, { width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
  test(`responsive shell and MapLibre resize ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Мониторинг территории' })).toBeVisible();
    await expect(page.locator('.dev-marker').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const canvasFits = () => page.locator('.dashboard-map').evaluate((panel) => {
      const canvas = panel.querySelector('canvas');
      return canvas !== null && Math.abs(canvas.getBoundingClientRect().width - panel.clientWidth) <= 1;
    });
    await expect.poll(canvasFits).toBe(true);
    await page.setViewportSize({ width: viewport.width - 20, height: viewport.height });
    await expect.poll(canvasFits).toBe(true);
    if (viewport.width < 761) await page.getByRole('button', { name: 'Открыть навигацию' }).click();
    await page.getByRole('link', { name: 'Датчики', exact: true }).click();
    await expect(page.locator('#stations .legend-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#stations table')).toBeVisible();
    if (viewport.width < 761) {
      expect((await page.locator('#stations table').boundingBox())!.y).toBeLessThan(viewport.height - 100);
      const dayWidth = await page.locator('.mini-day').first().evaluate((button) => button.getBoundingClientRect().width);
      expect(dayWidth).toBeGreaterThanOrEqual(44);
      await page.goto('/forecast');
      await expect(page.getByTestId('forecast-day')).toHaveCount(7);
      expect(await page.getByTestId('forecast-day').first().evaluate((button) => button.getBoundingClientRect().width)).toBeGreaterThanOrEqual(44);
      await expect.poll(async () => {
        const map = await page.getByTestId('forecast-map').boundingBox();
        const control = await page.locator('.maplibregl-ctrl-attrib-button').boundingBox();
        const legend = await page.locator('.map-legend-box').boundingBox();
        return !!map && !!control && !!legend && control.width >= 44 && control.height >= 44 && control.y + control.height <= map.y + map.height && legend.y + legend.height <= control.y;
      }).toBe(true);
      await page.locator('.rank-item').first().click();
      await expect(page.locator('.maplibregl-popup')).toBeVisible();
      await expect.poll(async () => {
        const map = await page.getByTestId('forecast-map').boundingBox();
        const popup = await page.locator('.maplibregl-popup-content').boundingBox();
        return !!map && !!popup && popup.y >= map.y && popup.y + popup.height <= map.y + map.height;
      }).toBe(true);
    }
    expect(errors).toEqual([]);
  });
}

test('layers hide real markers; event dialog traps and restores keyboard focus', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.dev-marker').first()).toBeVisible();
  await page.getByRole('button', { name: 'Слои', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Датчики', exact: true }).uncheck();
  await expect(page.locator('.dev-marker').first()).toBeHidden();
  await page.getByRole('checkbox', { name: 'Датчики', exact: true }).check();
  await expect(page.locator('.dev-marker').first()).toBeVisible();
  await page.getByRole('button', { name: 'Слои', exact: true }).click();
  const trigger = page.getByTestId('alert-item').first();
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Карточка тревоги' });
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 18; i++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.locator('.audio-summary .play-button').click();
  await expect.poll(() => page.locator('.audio-summary audio').evaluate((audio) => !(audio as HTMLAudioElement).paused)).toBe(true);
  await expect(page.locator('.audio-summary .status-badge')).toContainText('Воспроизведение');
  await page.locator('.audio-summary .play-button').click();
  await expect.poll(() => page.locator('.audio-summary audio').evaluate((audio) => (audio as HTMLAudioElement).paused)).toBe(true);
  await page.getByRole('button', { name: 'Все события' }).click();
  await page.locator('[data-testid="alert-item"][data-status="resolved"]').first().click();
  const recording = page.getByTestId('alert-audio');
  await recording.focus();
  await page.keyboard.press('Tab');
  // Native media controls may have multiple internal tab stops; none should be intercepted.
  await expect(recording).toBeFocused();
  await page.keyboard.press('Escape');
});

test('HTTP telemetry recovery updates readings and marker freshness without SSE', async ({ page, request }) => {
  const fixture = await (await request.get('/api/map/geo')).json();
  const clock = Date.now();
  let refreshed = false;
  await page.clock.install({ time: new Date(clock) });
  await page.route('**/api/stream', (route) => route.fulfill({ contentType: 'text/event-stream', body: ': deterministic disconnected fixture\n\n' }));
  await page.route('**/api/map/geo', (route) => {
    const body = structuredClone(fixture);
    for (const device of body.devices.features) {
      device.properties.lastSeenAt = new Date(clock + (refreshed ? 30_000 : 0)).toISOString();
      for (const sensor of device.properties.sensors) { sensor.value = refreshed ? 22 : 11; sensor.ts = device.properties.lastSeenAt; }
    }
    return route.fulfill({ json: body });
  });
  await page.goto('/#stations');
  await expect(page.locator('#stations table')).toBeVisible();
  await expect(page.locator('.dev-marker[data-fresh="true"]')).toHaveCount(fixture.devices.features.length);
  await expect(page.locator('#stations td.num').first()).toHaveText('11,0');
  await page.clock.fastForward(21_000);
  await expect(page.locator('.dev-marker[data-fresh="true"]')).toHaveCount(0);
  refreshed = true;
  await page.clock.fastForward(10_000);
  await expect(page.locator('#stations td.num').first()).toHaveText('22,0');
  await expect(page.locator('.dev-marker[data-fresh="true"]')).toHaveCount(fixture.devices.features.length);
});

test('audio summary distinguishes failed alert loading from an empty library', async ({ page }) => {
  let available = false;
  await page.route('**/api/alerts', (route) => route.fulfill({ status: available ? 200 : 503, json: available ? { alerts: [] } : { error: 'fixture_unavailable' } }));
  await page.goto('/');
  const card = page.locator('.audio-summary');
  await expect(card).toContainText('Не удалось загрузить записи событий');
  await expect(card).not.toContainText('Записей пока нет');
  available = true;
  await card.getByRole('button', { name: 'Повторить' }).click();
  await expect(card).toContainText('Записей пока нет');
});

test('mobile cross-route sensor navigation settles after asynchronous dashboard content', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/audio');
  await page.getByRole('button', { name: 'Открыть навигацию' }).click();
  await page.getByRole('link', { name: 'Датчики', exact: true }).click();
  await expect(page.locator('#stations table')).toBeVisible();
  await expect(page.locator('.mini-day')).toHaveCount(7);
  await expect(page.locator('.dev-marker').first()).toBeVisible();
  await expect.poll(async () => {
    const table = await page.locator('#stations table').boundingBox();
    return table ? table.y + table.height : Infinity;
  }).toBeLessThan(834);
});

test('forecast summary distinguishes stale data, missing days and model runs', async ({ page, request }) => {
  const response = await request.get('/api/forecast');
  expect(response.ok()).toBe(true);
  const fixture = await response.json();
  // Explicit deterministic forecast fixture; production metrics are never replaced in the app.
  fixture.run.issuedAt = '2000-01-01T00:00:00Z';
  fixture.cells.features = fixture.cells.features.slice(0, 2);
  fixture.cells.features[0].properties.presence = 0.2;
  fixture.cells.features[1].properties.presence = 0.4;
  await page.route('**/api/forecast*', async (route) => {
    const day = new URL(route.request().url()).searchParams.get('day');
    if (day === fixture.run.dates[2]) return route.fulfill({ status: 503, json: { error: 'fixture_unavailable' } });
    const body = structuredClone(fixture);
    body.day = day ?? fixture.day;
    if (day === fixture.run.dates[3]) body.run.id = '11111111-1111-4111-8111-111111111111';
    return route.fulfill({ json: body });
  });
  await page.goto('/');
  const card = page.locator('.forecast-summary');
  await expect(card.locator('.mini-day')).toHaveCount(7);
  await expect(card).toContainText('0,30');
  await expect(card).toContainText('Устарел');
  await expect(card.locator('.mini-day').nth(2)).toHaveAccessibleName(/нет данных/);
  await expect(card.locator('.mini-day').nth(3)).toHaveAccessibleName(/нет данных/);
  await card.locator('.mini-day').nth(1).click();
  await expect(card.locator('.mini-day').nth(1)).toHaveAttribute('aria-pressed', 'true');
  await card.getByRole('link', { name: 'Подробнее' }).click();
  await expect(page.getByTestId('forecast-day').nth(1)).toHaveAttribute('aria-pressed', 'true');
});

test('forecast summary presents explicit empty and error states with retry', async ({ page }) => {
  let empty = true;
  await page.route('**/api/forecast*', (route) => route.fulfill({ status: empty ? 404 : 503, json: { error: empty ? 'no_forecast' : 'fixture_unavailable' } }));
  await page.goto('/');
  const card = page.locator('.forecast-summary');
  await expect(card).toContainText('Прогноз ещё не рассчитан');
  empty = false;
  await card.getByRole('button', { name: 'Проверить снова' }).click();
  await expect(card).toContainText('Не удалось загрузить прогноз');
  await expect(card.locator('.mini-day')).toHaveCount(0);
});
