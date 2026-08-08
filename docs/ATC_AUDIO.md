# ATC audio

Flight Wall can play live ATC (air traffic control) audio alongside the board,
with each channel panned **left / center / right** — so you can hear one airport
in your left ear and another in your right (e.g. DFW left, Alliance right).

## How it works

- Configure up to **4 channels** per screen in the control panel: label, stream
  URL, pan, volume, and a **Proxy** toggle.
- The display plays them through the **Web Audio API**, which is what enables the
  hard left/right panning (a plain `<audio>` tag can only play centered).
- Web Audio only accepts audio that is **same-origin or sends CORS headers**, and
  the display is served over HTTPS. Public feeds (LiveATC) are `http` and send no
  CORS, so they're routed through the app's **`/api/audio-proxy`** (turn **Proxy**
  on): it re-streams them over HTTPS with CORS. The proxy only forwards URLs you
  have configured on that screen — it is **not an open relay**.
- Channels **auto-reconnect** with backoff if they drop. Audio needs a user
  gesture to start (browser autoplay policy) unless the kiosk browser is launched
  with `--autoplay-policy=no-user-gesture-required`; otherwise tap **"Enable ATC
  audio"** once.

## Stereo split (two airports)

Set one channel's pan to **Left** and another's to **Right** — `StereoPannerNode`
sends each hard to one speaker. **Center** plays in both. That's the whole trick.

## Sources

### LiveATC.net — easiest, but mind the terms

Biggest coverage. **LiveATC's [Terms of Use](https://www.liveatc.net/legal/)
state their audio "may not be used in any third‑party products,"** and they may
block cloud-hosted proxies. Treat it as **personal listening only**, at your own
discretion. Their streams are `http`, so they must use the **Proxy**.

Near DFW, both airports have feeds — the control panel's **"Load DFW + Alliance
example"** button fills these in (DFW left, Alliance right):

| Airport | Feed | URL |
| --- | --- | --- |
| DFW Tower (West) | `kdfw2` | `http://d.liveatc.net/kdfw2` |
| DFW Tower (East) | `kdfw1` | `http://d.liveatc.net/kdfw1` |
| Alliance Tower/Heli/App | `kafw1` | `http://d.liveatc.net/kafw1` |

If the Cloud Run proxy gets blocked by LiveATC, run Flight Wall **locally on the
Pi** (below) so the proxy uses your home connection — or use an SDR.

### RTL-SDR — recommended (legal, exact frequencies, cleanest stereo)

Receiving ATC yourself is legal in the US, uses the exact frequencies you choose,
and carries no third-party terms. Best fit for the DFW/Alliance idea.

**Hardware:** an RTL-SDR dongle (e.g. RTL-SDR Blog V4, ~$30) + a VHF airband
antenna, on or near the Pi. One dongle covers ~2.4 MHz, so several nearby
frequencies fit; use two dongles for widely separated ones.

**Software:** [`rtl_airband`](https://github.com/rtl-airband/RTLSDR-Airband)
demodulates AM airband to a local Icecast. Example `/etc/rtl_airband.conf` with
two channels (DFW Tower East + Alliance Tower — 126.55 & 127.65 fit one dongle):

```conf
devices: ({
  type = "rtlsdr"; index = 0; gain = 40; centerfreq = 127.1;
  channels: (
    { freq = 126.550; modulation = "am"; outputs: (
      { type = "icecast"; server = "127.0.0.1"; port = 8000;
        mountpoint = "dfw_twr"; name = "DFW Tower"; } ); },
    { freq = 127.650; modulation = "am"; outputs: (
      { type = "icecast"; server = "127.0.0.1"; port = 8000;
        mountpoint = "afw_twr"; name = "Alliance Tower"; } ); }
  );
});
```

Verify the real tower frequencies for your airports on
[AirNav](https://www.airnav.com/) (DFW and AFW towers each use several). All
`freq`s must be within ~1.2 MHz of `centerfreq`, or use a second device block.

**Icecast + CORS** — let Web Audio use the stream without the proxy by adding to
`icecast.xml`:

```xml
<http-headers>
  <header name="Access-Control-Allow-Origin" value="*" />
</http-headers>
```

Then add Flight Wall channels pointing at `http://<pi-ip>:8000/dfw_twr` (pan
**Left**) and `http://<pi-ip>:8000/afw_twr` (pan **Right**), with **Proxy off**
(Icecast now sends CORS). See the next section for the HTTPS note.

### Broadcastify / other

Any Icecast/Shoutcast MP3 URL works. Enable **Proxy** if it lacks CORS or is
`http`. Respect each provider's terms.

## Running Flight Wall locally for audio

The Cloud Run deployment is ideal for remote control, but audio has two snags
there: your LAN SDR/Icecast isn't reachable from Google's cloud, and LiveATC may
block cloud IPs. The fix is to **also run Flight Wall on the Pi**:

```bash
npm install && npm start
```

Open `http://localhost:8080/display?screen=main` on the Pi. Now the page is
`http` + same-origin: the proxy runs from your home connection (LiveATC personal
use) and can reach your LAN Icecast directly. Settings can still live in
Firestore (`STORAGE=firestore` + credentials) or stay local (the default).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Enable ATC audio" pill won't go away | Tap it once (autoplay needs a gesture), or launch Chromium with `--autoplay-policy=no-user-gesture-required`. |
| Channel stuck "reconnecting" | The feed is down/blocked. For LiveATC on Cloud Run, run locally or use SDR. Check the URL. |
| No sound but status "live" | Check the mute button (🔊 top-right), master/channel volume, and pan (a hard-left channel is silent on a right-only speaker). |
| Only one ear has audio | That's the stereo split working — set pan to **Center** for both ears. |
