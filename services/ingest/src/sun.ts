// Solar elevation angle after the NOAA Solar Calculator spreadsheet (Meeus formulas).
// Accuracy is far better than needed here: we only ask "is it darker than civil twilight (-6°)?".
// Atmospheric refraction (< 0.1° near -6°) is ignored on purpose.

const rad = (deg: number): number => (deg * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;

/** Sun elevation above the horizon in degrees for a UTC instant and a place (lat/lon in degrees, east positive). */
export function solarElevationDeg(date: Date, lat: number, lon: number): number {
  const julianDay = date.getTime() / 86_400_000 + 2_440_587.5;
  const t = (julianDay - 2_451_545) / 36_525; // Julian century

  const meanLong = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const meanAnom = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const eccent = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const center =
    Math.sin(rad(meanAnom)) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(rad(2 * meanAnom)) * (0.019993 - 0.000101 * t) +
    Math.sin(rad(3 * meanAnom)) * 0.000289;
  const trueLong = meanLong + center;
  const omega = 125.04 - 1934.136 * t;
  const apparentLong = trueLong - 0.00569 - 0.00478 * Math.sin(rad(omega));
  const meanObliq = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliq = meanObliq + 0.00256 * Math.cos(rad(omega));
  const declination = deg(Math.asin(Math.sin(rad(obliq)) * Math.sin(rad(apparentLong))));

  const y = Math.tan(rad(obliq / 2)) ** 2;
  const equationOfTimeMin =
    4 *
    deg(
      y * Math.sin(2 * rad(meanLong)) -
        2 * eccent * Math.sin(rad(meanAnom)) +
        4 * eccent * y * Math.sin(rad(meanAnom)) * Math.cos(2 * rad(meanLong)) -
        0.5 * y * y * Math.sin(4 * rad(meanLong)) -
        1.25 * eccent * eccent * Math.sin(2 * rad(meanAnom)),
    );

  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const trueSolarMin = (((utcMinutes + equationOfTimeMin + 4 * lon) % 1440) + 1440) % 1440;
  const hourAngle = trueSolarMin / 4 < 0 ? trueSolarMin / 4 + 180 : trueSolarMin / 4 - 180;

  const cosZenith =
    Math.sin(rad(lat)) * Math.sin(rad(declination)) +
    Math.cos(rad(lat)) * Math.cos(rad(declination)) * Math.cos(rad(hourAngle));
  const zenith = deg(Math.acos(Math.min(1, Math.max(-1, cosZenith))));
  return 90 - zenith;
}

/** Darker than civil twilight: the sun is more than 6° below the horizon. */
export function isDark(date: Date, lat: number, lon: number): boolean {
  return solarElevationDeg(date, lat, lon) < -6;
}
