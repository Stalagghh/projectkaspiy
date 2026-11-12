// GET /api/forecast?day=YYYY-MM-DD
// Latest seal-presence forecast run of the Agrakhan area and the cells of one day as GeoJSON.
// Without `day` the first day of the run is returned.
//   200 ForecastApiResponse (features/forecast/schema.ts)
//   400 {error: "invalid_day"}       day is not a YYYY-MM-DD date
//   404 {error: "no_forecast"}       no run has been computed yet
//   404 {error: "day_out_of_range"}  the run does not cover that day (valid days in `dates`)
//   500 {error: "forecast_unavailable"}
import type { NextRequest } from 'next/server';

import { isoDateSchema } from '../../../features/forecast/schema';
import { getLatestForecast } from '../../../features/forecast/server/query';

export async function GET(request: NextRequest): Promise<Response> {
  const dayParam = request.nextUrl.searchParams.get('day');
  let day: string | undefined;
  if (dayParam !== null) {
    const parsed = isoDateSchema.safeParse(dayParam);
    if (!parsed.success) return Response.json({ error: 'invalid_day' }, { status: 400 });
    day = parsed.data;
  }

  try {
    const result = await getLatestForecast(day);
    switch (result.kind) {
      case 'no_forecast':
        return Response.json({ error: 'no_forecast' }, { status: 404 });
      case 'day_out_of_range':
        return Response.json({ error: 'day_out_of_range', dates: result.dates }, { status: 404 });
      case 'ok':
        return Response.json(result.data, { headers: { 'Cache-Control': 'no-store' } });
    }
  } catch (error) {
    console.error('[forecast] failed to load the forecast', error);
    return Response.json({ error: 'forecast_unavailable' }, { status: 500 });
  }
}
