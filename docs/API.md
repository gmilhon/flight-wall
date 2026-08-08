# API reference

Base URL is the service root. All responses are JSON. The display and control
panel are built entirely on these endpoints, so you can script or extend the
system with them.

Screens are identified by a slug (`?screen=<id>`, default `main`). Ids are
lower-cased and stripped to `[a-z0-9_-]`.

---

## `GET /health`

Liveness check.

```json
{ "ok": true, "version": "1.0.0" }
```

## `GET /api/config`

Server capabilities, used by the control panel to decide whether to prompt for a
PIN.

```json
{ "version": "1.0.0", "pinRequired": true, "storage": "firestore", "defaultScreen": "main" }
```

## `GET /api/map/{z}/{x}/{y}`

Proxied dark map tiles (CARTO basemap, © OpenStreetMap © CARTO) used by the
display's map view. Coordinates are validated, fetched server-side, and cached
in-process, so the map keeps working even when a client blocks CDN hosts.
Returns `image/png`.

## `GET /api/audio-proxy?screen=<id>&url=<stream>`

Streams an ATC audio channel to the browser with `Access-Control-Allow-Origin: *`
(required for Web Audio panning) and over HTTPS (avoids mixed content for `http`
feeds). Only URLs present in that screen's `audio.channels` are forwarded, so it
is not an open proxy; loopback/private hosts are refused. See
[ATC_AUDIO.md](ATC_AUDIO.md) and note LiveATC's terms before proxying their feeds.

## `GET /api/screens`

List known screen ids.

```json
{ "screens": ["main", "kitchen"] }
```

## `GET /api/settings?screen=<id>`

Current settings for a screen (defaults are returned for an unknown screen).

```bash
curl "$BASE/api/settings?screen=main"
```

```jsonc
{
  "screenId": "main",
  "label": "Home",
  "mode": "area",
  "home": { "lat": 34.05, "lon": -118.24, "label": "Home" },
  "radiusNm": 15,
  "units": "aviation",
  "maxFlights": 5,
  "sort": "distance",
  "theme": "departure",
  "refreshSec": 10,
  "showRadar": true,
  "trackedFlights": [],
  "updatedAt": 1730000000000
}
```

### Settings fields

| Field | Type | Range / values | Notes |
| --- | --- | --- | --- |
| `label` | string | ≤ 40 chars | Optional screen name. |
| `mode` | string | `area` \| `flight` | Overhead area, or track specific flights. |
| `home.lat` | number\|null | −90..90 | Required for area mode. |
| `home.lon` | number\|null | −180..180 | |
| `home.label` | string | ≤ 60 chars | Shown on the display header. |
| `radiusNm` | integer | 1..250 | Area radius, nautical miles. |
| `units` | string | `aviation` \| `metric` \| `imperial` | |
| `maxFlights` | integer | 1..8 | Max cards shown. |
| `sort` | string | `distance` \| `altitude` \| `speed` | Airborne always ranks above ground. |
| `theme` | string | `departure` \| `radar` \| `minimal` | |
| `refreshSec` | integer | 5..60 | Display poll interval. |
| `sidePanel` | string | `map` \| `radar` \| `off` | Live map, retro radar, or board-only. |
| `showLogos` | boolean | | Airline logos on cards. |
| `showAircraftIcons` | boolean | | Aircraft type silhouettes. |
| `alertOnAppear` | boolean | | Chime + banner when a tracked flight appears. |
| `trackedFlights` | string[] | ≤ 5 | Callsigns/flight numbers (flight mode). |
| `audio` | object | | `{ enabled, volume: 0..1, channels[] }`. Up to 4 channels, each `{ label, url, pan: left\|center\|right, volume: 0..1, proxy }`. |

## `POST /api/settings?screen=<id>`

Update settings. Values are validated and clamped server-side; partial bodies are
merged over current settings. Requires the PIN **if** `CONTROL_PIN` is configured.

```bash
curl -X POST "$BASE/api/settings?screen=main" \
  -H "Content-Type: application/json" \
  -H "x-control-pin: 1234" \
  -d '{"mode":"area","home":{"lat":34.05,"lon":-118.24,"label":"Home"},"radiusNm":20}'
```

Returns the saved (sanitised) settings object. On a bad/missing PIN:

```json
{ "error": "invalid-pin" }   // HTTP 401
```

The PIN may also be supplied in the body as `"pin": "1234"` instead of the header.

## `GET /api/state?screen=<id>`

The endpoint the display polls: current settings **and** computed flights in one
call.

```bash
curl "$BASE/api/state?screen=main"
```

```jsonc
{
  "settings": { /* as above */ },
  "flights": [ /* Flight objects, see below */ ],
  "note": null,          // "no-home" when area mode has no location set
  "error": null,         // "upstream-unavailable" | "flight-error" on data issues
  "generatedAt": 1730000000000
}
```

This endpoint always returns `200`. Data problems are reported via `error` (with
`flights: []`) so the display can keep its last-known state.

### Flight object

```jsonc
{
  "hex": "a1b2c3",
  "callsign": "UAL245",
  "registration": "N12345",
  "lat": 34.10, "lon": -118.30,
  "altFt": 12500, "onGround": false,
  "gsKt": 410, "trackDeg": 92, "vertFpm": -640,
  "squawk": "1200", "category": "A3", "emergency": null,
  "airline": { "name": "United Airlines", "icao": "UAL", "iata": "UA" },
  "origin":      { "iata": "SFO", "icao": "KSFO", "name": "San Francisco Intl", "city": "San Francisco" },
  "destination": { "iata": "JFK", "icao": "KJFK", "name": "John F Kennedy Intl", "city": "New York" },
  "aircraft": { "code": "B739", "name": "Boeing 737-900", "manufacturer": "Boeing", "owner": "…" },
  "distanceKm": 7.8, "bearingDeg": 63,
  "status": "live"
}
```

Fields can be `null` when unknown (common for general aviation). In flight mode, a
tracked entry that isn't currently airborne appears as:

```json
{ "query": "AA100", "status": "not-found", "callsign": "AA100" }
```

Numeric values are aviation-native (feet, knots, ft/min); the client converts them
for the chosen unit system.
