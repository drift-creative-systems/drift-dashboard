/**
 * Weather from Open-Meteo (free, no key). The location can be a UK postcode
 * (looked up with postcodes.io), "lat, long", or a place name.
 */
const { request } = require('../http');

const SERVICE = 'Weather';
const HOURS = 8;

const POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
const LATLON = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;

/**
 * Location text → { lat, lon, name }.
 */
async function locate(text) {
	const value = String(text || '').trim();
	if (!value) {
		throw new Error('Add a location in Settings (postcode or town).');
	}

	const ll = value.match(LATLON);
	if (ll) {
		return { lat: Number(ll[1]), lon: Number(ll[2]), name: value };
	}

	if (POSTCODE.test(value)) {
		const { data } = await request(`https://api.postcodes.io/postcodes/${encodeURIComponent(value.replace(/\s+/g, ''))}`, {
			service: 'Postcode lookup',
			allow: [404],
		});
		if (data && data.result) {
			const r = data.result;
			return { lat: r.latitude, lon: r.longitude, name: r.parish || r.admin_ward || r.admin_district || value.toUpperCase() };
		}
		throw new Error('Postcode not found. Check it, or enter a town name instead.');
	}

	// Place name, e.g. "Ide, Devon": UK places first (Ordnance Survey names via
	// postcodes.io), using anything after the comma to pick the right county.
	const [place, ...rest] = value.split(',').map((s) => s.trim());
	const hint = rest.join(' ').toLowerCase();
	const uk = await request(`https://api.postcodes.io/places?q=${encodeURIComponent(place)}&limit=20`, { service: 'Place lookup' })
		.then((r) => (r.data && r.data.result) || [])
		.catch(() => []);
	const exact = uk.filter((p) => String(p.name_1).toLowerCase() === place.toLowerCase());
	const ukPick = (hint && exact.find((p) => [p.county_unitary, p.district_borough, p.region].join(' ').toLowerCase().includes(hint))) || exact[0];
	if (ukPick) {
		return { lat: ukPick.latitude, lon: ukPick.longitude, name: ukPick.name_1 };
	}

	// Anywhere else in the world.
	const { data } = await request(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=10&language=en&format=json`, { service: SERVICE });
	const results = (data && data.results) || [];
	const pick = results.find((r) => 'GB' === r.country_code && (!hint || [r.admin1, r.admin2, r.admin3].join(' ').toLowerCase().includes(hint)))
		|| results.find((r) => 'GB' === r.country_code)
		|| results[0];
	if (!pick) {
		throw new Error(`Couldn't find "${value}". Try a postcode instead.`);
	}
	return { lat: pick.latitude, lon: pick.longitude, name: pick.name };
}

module.exports = {
	id: 'weather',
	name: 'Weather',
	section: 'now',
	interval: 15 * 60 * 1000,
	oauth: false,
	help: 'Free from Open-Meteo, no account needed. Enter a postcode or town.',
	fields: [
		{ key: 'location', label: 'Location (postcode or town)', type: 'text', placeholder: 'EX2 9RQ', required: true },
	],

	async fetch(account, ctx) {
		const location = String(account.config.location || '');
		const place = await ctx.cached(`loc:${location.toLowerCase()}`, 7 * 86400000, () => locate(location));

		const params = new URLSearchParams({
			latitude: String(place.lat),
			longitude: String(place.lon),
			current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,is_day',
			hourly: 'temperature_2m,precipitation_probability,weather_code,is_day',
			daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
			timezone: 'Europe/London',
			forecast_days: '2',
			wind_speed_unit: 'mph',
		});
		const { data } = await request(`https://api.open-meteo.com/v1/forecast?${params}`, { service: SERVICE });
		if (!data || !data.current || !data.hourly || !data.daily) {
			throw new Error('The weather service returned an unexpected response.');
		}

		// Hourly times are local ("2026-10-13T14:00"); keep the next few hours.
		const nowHour = new Date();
		nowHour.setMinutes(0, 0, 0);
		const hours = [];
		data.hourly.time.forEach((t, i) => {
			const at = new Date(t);
			if (at > nowHour && hours.length < HOURS) {
				hours.push({
					time: t,
					temp: data.hourly.temperature_2m[i],
					rain: data.hourly.precipitation_probability[i],
					code: data.hourly.weather_code[i],
					day: Boolean(data.hourly.is_day[i]),
				});
			}
		});

		const dayAt = (i) => ({
			code: data.daily.weather_code[i],
			max: data.daily.temperature_2m_max[i],
			min: data.daily.temperature_2m_min[i],
			rain: data.daily.precipitation_probability_max[i],
			sunrise: data.daily.sunrise[i],
			sunset: data.daily.sunset[i],
		});

		return {
			place: place.name,
			current: {
				temp: data.current.temperature_2m,
				feels: data.current.apparent_temperature,
				code: data.current.weather_code,
				wind: data.current.wind_speed_10m,
				day: Boolean(data.current.is_day),
			},
			today: dayAt(0),
			tomorrow: dayAt(1),
			hours,
			url: `https://www.metoffice.gov.uk/weather/forecast/search?lat=${place.lat}&lon=${place.lon}`,
		};
	},
};
