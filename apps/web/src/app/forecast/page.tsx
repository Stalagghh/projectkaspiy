// /forecast: server shell; the map and the side panel are client components that load
// /api/forecast, so the page renders even before the first forecast run exists.
import type { Metadata } from 'next';

import { ForecastView } from '../../features/forecast/ForecastView';

export const metadata: Metadata = {
  title: 'Прогноз присутствия тюленя',
  description: 'Упрощённый прогноз присутствия каспийского тюленя на 7 дней в районе заказника «Аграханский».',
};

export default function ForecastPage() {
  return (
    <ForecastView />
  );
}
