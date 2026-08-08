# Setting up the display device

The display is just a web page. Any device with a full-screen browser works — a
Raspberry Pi, an old tablet or phone, a Fire TV stick, a mini PC, or a smart TV's
built-in browser. Point it at:

```
https://YOUR-SERVICE-URL/display?screen=main
```

Use a different `screen` id per physical display (e.g. `?screen=kitchen`) and
configure each one separately from the control panel.

> Tip: from the control panel, use **Copy** to grab the exact display URL.

---

## Raspberry Pi (recommended kiosk)

Works on a Pi 3, 4, 5, or Zero 2 W with Raspberry Pi OS.

### 1. Install a browser and helpers

```bash
sudo apt update
sudo apt install -y chromium-browser unclutter
```

### 2. Auto-start Chromium in kiosk mode

Create an autostart entry:

```bash
mkdir -p ~/.config/autostart
cat > ~/.config/autostart/flightwall.desktop <<'EOF'
[Desktop Entry]
Type=Application
Name=Flight Wall
Exec=/usr/bin/chromium-browser --kiosk --incognito --noerrdialogs \
  --disable-infobars --check-for-update-interval=31536000 \
  --disable-session-crashed-bubble \
  "https://YOUR-SERVICE-URL/display?screen=main"
EOF
```

Replace `YOUR-SERVICE-URL`. Reboot and it launches full-screen on login.

### 3. Stop the screen from blanking

Edit `~/.config/lxsession/LXDE-pi/autostart` (create it if missing) and add:

```
@xset s off
@xset -dpms
@xset s noblank
@unclutter -idle 0        # hide the mouse cursor
```

On newer Wayland-based Pi OS, disable blanking via
`Preferences → Screen Configuration`, or `raspi-config` → *Display Options →
Screen Blanking → Off*.

### 4. Rotate the screen (optional, for portrait walls)

`raspi-config` → *Display Options*, or add `display_rotate=1` to
`/boot/firmware/config.txt`. The layout adapts to portrait automatically.

---

## Fire TV / Android TV / Android tablet

1. Install a kiosk browser — **Fully Kiosk Browser** (recommended) or any
   full-screen browser.
2. Set the start URL to your `/display?screen=…` URL.
3. In Fully Kiosk, enable *Start URL on boot*, *Keep screen on*, and *Fullscreen*.
   Optionally set a nightly reload.
4. Disable the device's sleep/screensaver in system settings.

For a spare Android phone/tablet: install Fully Kiosk (or use Chrome's *Add to
Home screen* → open, then rotate to landscape), and enable *Stay awake* in
Developer Options while charging.

---

## Generic browser / smart TV

Open the display URL and press <kbd>F11</kbd> (or the browser's full-screen
option). The in-page ⛶ button also toggles full screen. Disable the TV's
screensaver/sleep. This is the simplest option for a quick trial.

---

## Tips

- **Prevent burn-in** on OLED panels: lower brightness, or switch to the
  **Minimal** theme (less large solid colour), and consider a nightly reload.
- **Wi-Fi only?** Fine — the display just needs internet to reach the service.
- **Performance:** the page is lightweight, but on a Pi Zero keep `refreshSec` at
  10s+ and `maxFlights` modest for the smoothest result.
- **Portrait vs landscape:** both work; the board and radar reflow to fit.
- **Kiosk exit:** on a Pi, <kbd>Ctrl</kbd>+<kbd>W</kbd> or <kbd>Alt</kbd>+<kbd>F4</kbd>;
  plug in a keyboard if needed.

---

## Multiple displays

Each screen id is independent:

```
https://YOUR-SERVICE-URL/display?screen=living-room
https://YOUR-SERVICE-URL/display?screen=office
```

In the control panel, use **＋ New** to create a screen id, configure it, and open
its URL on the matching device. One deployment can drive as many screens as you
like.

---

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| "Set your location" on screen | Area mode with no home set — set a lat/lon in the control panel. |
| "No aircraft overhead" | Genuinely quiet sky, or radius too small — widen the radius. |
| "reconnecting" pill | Temporary network/upstream blip; it keeps the last data and recovers. |
| Routes/airlines missing | Not all flights have route data (esp. general aviation). |
| Saves rejected | A `CONTROL_PIN` is set — enter it in the control panel. |
| Screen goes black after a while | Disable screen blanking/sleep (see above). |
