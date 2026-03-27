# myAir for Homey

Homey integration for Advantage Air `myAir` systems.

This app adds a central control device for the air conditioner itself plus zone devices for each discovered zone, so Homey can automate unit state, mode, fan speed, zone opening, and supported zone temperature setpoints.

## Features

- Control the main aircon unit from Homey.
- Create Homey devices for each `myAir` zone.
- Support both zone temperature control and vent-percentage control, depending on zone type.
- Expose signal quality for room sensors where available.
- Provide Homey Flow cards for common control and status automations.
- Optional outbound command throttling to serialize writes to controllers that do not like rapid back-to-back commands.
- Shared retry handling for both polling and outgoing commands.
- Communication-failure Flow trigger with hourly suppression and summary tags.

## Devices

### myAir Unit Control

Main aircon device with:

- `onoff`
- `aircon_mode`
- `aircon_fan`

Supported modes:

- `cool`
- `heat`
- `fan`
- `dry`

Supported fan speeds:

- `low`
- `medium`
- `high`
- `auto`

### myAir Zone Control

One zone device per discovered zone.

Depending on the zone type reported by the controller, a zone may expose:

- `onoff`
- `target_temperature`
- `measure_temperature`
- `measure_ventopen`
- `target_ventopen`
- `wifi_signal`

Notes:

- Temperature-control zones expose `target_temperature`.
- Vent-control zones expose `target_ventopen` in 5% steps.
- `measure_ventopen` is available on all zones handled by the app.
- `wifi_signal` reports a simple quality label such as `Excellent`, `Good`, `Poor`, `Weak`, `Dead`, or `No Sensor`.

## Flow Support

### Action Cards

- `Set aircon mode`
- `Set aircon fan speed`

### Condition Cards

- `Aircon mode is`
- `Fan speed is`

### Trigger Cards

- `Mode has changed to...`
- `Target temperature changed`
- `Communication with aircon failed`

The communication-failure trigger is attached to the control device and includes these tags:

- `source`
- `failure_count`
- `summary`
- `last_error`

It is rate-limited to at most once per hour per control device. Additional failures in that period are accumulated into the next trigger summary.

## App Settings

The settings page provides:

- `MyAir IP Address`
- `Polling Interval (seconds)`
- `Request Timeout (seconds)`
- `Command throttling`
- `Inter-command delay (ms)`
- `Retry count`
- `Retry delay (ms)`

Behavior notes:

- Polling interval and request timeout changes require an app restart.
- Command throttling and retry settings apply immediately.
- Command throttling is disabled by default.
- Retry count defaults to `1`, meaning one retry after the initial attempt.

## Reliability Features

### Command throttling

When enabled, outgoing `/setAircon` commands are queued and sent one at a time with a configurable delay between sends. This is useful for controllers that become unreliable when multiple commands are sent too quickly.

When disabled, commands are sent immediately unless a queue is already draining.

### Shared retries

Both polling requests and outgoing command requests use the same retry settings:

- retry count
- retry delay

Only a fully failed operation is counted as a communication failure. Individual retry attempts are not exposed as separate failures.

### Communication-failure reporting

If polling or command sending still fails after all retries:

- the failure is logged
- the control driver records it
- the `Communication with aircon failed` trigger may fire

The trigger summary can contain combined counts such as:

- `3 polling failures this period`
- `2 polling failures, 1 command failure this period`

## Setup

1. Install the app in Homey.
2. Open the app settings page.
3. Enter the IP address of the `myAir` controller.
4. Pair the control device and zone devices.
5. Optionally adjust polling, timeout, throttling, and retry settings.

## Notes and limitations

- This app assumes a single `myAir` controller IP in app settings.
- The communication-failure trigger is emitted against the control device, not individual zone devices.
- Pairing/validation requests are separate from the runtime communication-failure trigger behavior.
- `app.json` is generated from `.homeycompose`; source-of-truth Flow definitions live under `.homeycompose`.

## Development

Useful commands:

```bash
npm run lint
```

## Support

- Community thread: <https://community.homey.app/t/app-pro-myair/112114>
- Issues: <https://github.com/github-acedom/net.acedom.myair/issues>
