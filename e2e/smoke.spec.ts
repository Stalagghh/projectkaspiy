// Demo smoke test: the whole demo path must work end to end before a milestone tag.
// It checks real behavior only: alerts come from real YAMNet inference on the demo clips,
// and the latency is measured from the device event time to the alert on screen.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

const MAX_ALERT_LATENCY_MS = 3000;
const HERE = dirname(fileURLToPath(import.meta.url));
const DEMO_CLIP = join(HERE, '..', 'data', 'demo', 'boat_engine.wav');

type SeenAlert = { id: string; kind: string | null; severity: string | null; t: number };

/** Records every alert item that appears in the feed after this call, with the browser time. */
async function watchNewAlerts(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __seen: SeenAlert[] };
    w.__seen = [];
    const known = new Set(
      [...document.querySelectorAll('[data-testid="alert-item"]')].map((e) => e.getAttribute('data-alert-id')),
    );
    const record = () => {
      for (const el of document.querySelectorAll('[data-testid="alert-item"]')) {
        const id = el.getAttribute('data-alert-id');
        if (id && !known.has(id)) {
          known.add(id);
          w.__seen.push({ id, kind: el.getAttribute('data-kind'), severity: el.getAttribute('data-severity'), t: Date.now() });
        }
      }
    };
    new MutationObserver(record).observe(document.body, { subtree: true, childList: true, attributes: true });
  });
}

const seenAlerts = (page: Page) =>
  page.evaluate(() => (window as unknown as { __seen: SeenAlert[] }).__seen);

test('night poacher scenario: real classification, live alerts within 3 s, card, actions', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByTestId('sse-status')).toHaveAttribute('data-state', 'open');
  await watchNewAlerts(page);

  const startResponse = page.waitForResponse(
    (r) => r.url().endsWith('/api/demo/start') && r.request().method() === 'POST',
  );
  await page.getByTestId('start-scenario').click();
  const start = await startResponse;
  expect(start.ok(), `scenario start failed: ${start.status()}`).toBeTruthy();

  // Both scripted events must turn into alerts through the real pipeline.
  const expected = [
    { kind: 'boat_in_no_entry_zone', severity: 'warning', label: 'boat_engine' },
    { kind: 'gunshot', severity: 'critical', label: 'gunshot' },
  ] as const;
  await expect
    .poll(async () => (await seenAlerts(page)).map((a) => a.kind), { timeout: 45_000 })
    .toEqual(expect.arrayContaining(expected.map((e) => e.kind)));

  const seen = await seenAlerts(page);
  const latencies: Record<string, number> = {};
  for (const e of expected) {
    const s = seen.find((a) => a.kind === e.kind);
    expect(s, `no new ${e.kind} alert`).toBeTruthy();
    const res = await request.get(`/api/alerts/${s!.id}`);
    expect(res.ok()).toBeTruthy();
    const alert = await res.json();
    expect(alert.severity).toBe(e.severity);
    expect(alert.isSimulated).toBe(true);
    // The label must be what the model returned for this clip (stored detection), not a fixed value.
    expect(alert.detection?.label).toBe(e.label);
    latencies[e.kind] = s!.t - Date.parse(alert.eventAt);
    expect(latencies[e.kind], `${e.kind} latency`).toBeLessThanOrEqual(MAX_ALERT_LATENCY_MS);
  }

  // The alert card shows the real classification, the audio and the spectrogram.
  const gunshot = seen.find((a) => a.kind === 'gunshot')!;
  await page.locator(`[data-testid="alert-item"][data-alert-id="${gunshot.id}"]`).click();
  const detail = page.getByTestId('alert-detail');
  await expect(detail).toHaveAttribute('data-alert-id', gunshot.id);
  await expect(detail.getByTestId('alert-label')).toHaveAttribute('data-label', 'gunshot');
  const confidence = Number(await detail.getByTestId('alert-confidence').getAttribute('data-confidence'));
  expect(confidence).toBeGreaterThan(0);
  expect(await detail.getByTestId('alert-topclasses').locator('li').count()).toBeGreaterThan(0);
  await expect
    .poll(() => detail.getByTestId('alert-spectrogram').evaluate((img) => (img as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  const audioSrc = await detail.getByTestId('alert-audio').getAttribute('src');
  expect(audioSrc).toBeTruthy();
  const ranged = await request.get(audioSrc!, { headers: { Range: 'bytes=0-1023' } });
  expect(ranged.status()).toBe(206);

  // Actions are written to the database and pushed back over SSE.
  await detail.getByTestId('action-acknowledge').click();
  await expect(detail.getByTestId('alert-status')).toHaveAttribute('data-status', 'acknowledged');
  await detail.getByTestId('action-resolve').click();
  await expect(detail.getByTestId('alert-status')).toHaveAttribute('data-status', 'resolved');
  const after = await (await request.get(`/api/alerts/${gunshot.id}`)).json();
  expect(after.status).toBe('resolved');

  mkdirSync(join(HERE, 'results'), { recursive: true });
  writeFileSync(join(HERE, 'results', 'latency.json'), JSON.stringify({ measuredAt: new Date().toISOString(), latenciesMs: latencies }, null, 2));
  console.log(`alert latency (device event -> on screen), ms: ${JSON.stringify(latencies)}`);
});

test('forecast page shows a 7-day layer, an explanation and source badges', async ({ page }) => {
  await page.goto('/forecast');
  await expect(page.getByTestId('forecast-day')).toHaveCount(7);
  await expect(page.getByTestId('forecast-summary')).not.toBeEmpty();
  await expect(page.getByTestId('forecast-sources')).not.toBeEmpty();
  await page.getByTestId('forecast-day').nth(2).click();
  await expect(page.getByTestId('forecast-day').nth(2)).toHaveAttribute('aria-pressed', 'true');
});

test('audio page classifies an uploaded file with the real model', async ({ page }) => {
  await page.goto('/audio');
  await page.getByTestId('audio-file-input').setInputFiles(DEMO_CLIP);
  const submit = page.getByTestId('audio-submit');
  if (await submit.count()) await submit.click();
  await expect(page.getByTestId('audio-result')).toHaveAttribute('data-label', 'boat_engine', { timeout: 30_000 });
  await expect
    .poll(() => page.getByTestId('audio-spectrogram').evaluate((img) => (img as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
});
