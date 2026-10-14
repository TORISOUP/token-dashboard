package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"slices"
	"sync/atomic"
	"time"

	"token-monitor-turzx/internal/display"
	"token-monitor-turzx/internal/settings"
	"token-monitor-turzx/internal/turzx"
	"token-monitor-turzx/internal/usage"
)

// This is the single development composition. It substitutes inputs, not drawing or page logic.
func composeDisplayPreview(ctx context.Context, preferences *settings.Service, screen *display.Service, state *usage.State, renderer *display.CanvasRenderer, emit func(string, any)) error {
	devices := []turzx.Device{{ID: `USB\VID_1A86&PID_5722\USB35INCHIPSV2`, Name: "TURZX 3.5-inch (Specification preview)"}, {ID: `USB\VID_1CBE&PID_0092\PREVIEW92`, Name: "TURZX 9.2-inch (Specification preview)"}}
	unknown := turzx.Device{ID: `USB\VID_1A86&PID_5722\USB5INCH`, Name: "Unknown saved output"}
	fixtures := map[string]struct {
		selected string
		states   [][]turzx.Device
	}{
		"both":            {devices[0].ID, [][]turzx.Device{devices}},
		"none":            {"", [][]turzx.Device{nil}},
		"disconnected-35": {devices[0].ID, [][]turzx.Device{{devices[1]}}},
		"disconnected-92": {devices[1].ID, [][]turzx.Device{{devices[0]}}},
		"unknown":         {unknown.ID, [][]turzx.Device{devices}},
		"automatic-cycle": {"", [][]turzx.Device{devices, {devices[1]}, nil, {devices[0]}}},
	}
	mode := os.Getenv("WAILS_DISPLAY_PREVIEW_DEVICES")
	if mode == "" {
		mode = "both"
	}
	fixture, exists := fixtures[mode]
	if !exists {
		return fmt.Errorf("unknown display preview device fixture: %s", mode)
	}
	var connected atomic.Value
	connected.Store(fixture.states[0])
	initial := settings.View{Source: "Local", DisplayID: fixture.selected, LimitStyle: "gauges-35-landscape", CycleSeconds: 10, AwayMinutes: 10, Presentation: &display.Presentation{Services: map[string]map[string]display.ServiceContent{}}}
	for _, device := range append(slices.Clone(devices), unknown) {
		initial.Displays = append(initial.Displays, settings.Display{DeviceID: device.ID, Name: device.Name})
	}
	settings.UseMemory(preferences, initial, screen.Themes, func() ([]turzx.Device, error) {
		return slices.Clone(connected.Load().([]turzx.Device)), nil
	})
	if len(fixture.states) > 1 {
		go func() {
			tick := time.NewTicker(8 * time.Second)
			defer tick.Stop()
			for {
				for _, devices := range fixture.states {
					connected.Store(devices)
					select {
					case <-ctx.Done():
						return
					case <-tick.C:
					}
				}
			}
		}()
	}
	screen.Configuration = func() (display.Configuration, error) {
		view, err := preferences.Get()
		if err != nil {
			return display.Configuration{}, err
		}
		return display.Configuration{Theme: screen.Themes[view.LimitStyle], Presentation: *view.Presentation, Source: view.Source, Cycle: view.Cycle, CycleSeconds: view.CycleSeconds, Generation: view.Generation}, nil
	}
	data := []*usage.Stats{}
	for _, raw := range []string{previewUsageA, previewUsageB} {
		var stats usage.Stats
		if err := json.Unmarshal([]byte(raw), &stats); err != nil {
			return fmt.Errorf("specification fixture: %w", err)
		}
		data = append(data, &stats)
	}
	state.SetSource("Local")
	// Save invokes callbacks under its lock, so source changes are read by the input feeder.
	preferences.OnSaved = state.Touch
	go func() {
		initial := time.NewTimer(time.Second)
		defer initial.Stop()
		select {
		case <-ctx.Done():
			return
		case <-initial.C:
		}
		index := 0
		tick := time.NewTicker(8 * time.Second)
		defer tick.Stop()
		for {
			view, err := preferences.Get()
			if err != nil {
				return
			}
			_, source := state.Snapshot()
			if source != view.Source {
				state.SetSource(view.Source)
			}
			state.Set(data[index])
			index = 1 - index
			select {
			case <-ctx.Done():
				return
			case <-tick.C:
			}
		}
	}()
	go display.RunPresentation(ctx, screen, renderer, time.Minute, emit)
	return nil
}

const previewUsageA = `{
 "periods":{
  "today":{"totalTokens":987654321,"costUsd":12.34,"clients":{"claude":1234567,"codex":0,"gemini":55555555},"clientCosts":{"claude":12.34,"codex":0,"gemini":5.67}},
  "month":{"totalTokens":9876543210,"costUsd":123.45,"clients":{"claude":123456789,"codex":9876543,"gemini":555555555},"clientCosts":{"claude":123.45,"codex":67.89,"gemini":56.78}},
  "allTime":{"totalTokens":98765432100,"costUsd":1234.56,"clients":{"claude":9223372036854775807,"codex":987654321,"gemini":5555555555},"clientCosts":{"claude":1234.56,"codex":678.90,"gemini":567.89}}
 },
 "limits":{"providers":[
  {"provider":"Claude","accountLabel":"personal","planLabel":"Pro","windows":[
   {"kind":"session","label":"Sonnet 5h","showMeter":true,"remainingPercent":30,"resetsAt":"2026-10-15T05:00:00Z"},
   {"kind":"weekly","label":"Sonnet weekly","showMeter":true,"remainingPercent":72,"resetsAt":"2026-10-21T05:00:00Z"},
   {"kind":"session","label":"Opus 5h","showMeter":true,"remainingPercent":42,"resetsAt":"2026-10-15T05:00:00Z"},
   {"kind":"weekly","label":"Opus weekly","showMeter":true,"remainingPercent":65,"resetsAt":"2026-10-21T05:00:00Z"},
   {"kind":"daily","label":"Extra daily","showMeter":true,"remainingPercent":null},
   {"kind":"billing","label":"Credits monthly","showMeter":true,"remainingPercent":80,"resetsAt":"2026-11-01T00:00:00Z"}
  ]},
  {"provider":"Claude","accountLabel":"work","planLabel":"Team","windows":[{"kind":"session","label":"5h","showMeter":true,"remainingPercent":15,"resetsAt":"2026-10-15T03:00:00Z"},{"kind":"weekly","label":"weekly","showMeter":true,"remainingPercent":89,"resetsAt":"2026-10-20T00:00:00Z"}]},
  {"provider":"Codex","planLabel":"Plus","windows":[{"kind":"session","label":"5h","showMeter":true,"remainingPercent":99.6,"resetsAt":"2026-10-15T02:00:00Z"},{"kind":"weekly","label":"weekly","showMeter":true,"remainingPercent":55,"resetsAt":"2026-10-21T00:00:00Z"}]},
  {"provider":"Idle service","planLabel":"Standard","windows":[{"kind":"session","label":"5h","showMeter":true,"remainingPercent":100,"resetsAt":"2026-10-15T02:00:00Z"}]},
  {"provider":"Unknown service with a longer display name","planLabel":"Custom","windows":[{"kind":"weekly","label":"weekly","showMeter":true,"remainingPercent":null},{"kind":"daily","label":"Internal daily","showMeter":false,"remainingPercent":0}]}
 ]}
}`

const previewUsageB = `{
 "periods":{
  "today":{"totalTokens":987654322,"costUsd":12.35,"clients":{"claude":7654321,"codex":42,"gemini":55555556},"clientCosts":{"claude":23.45,"codex":0,"gemini":5.68}},
  "month":{"totalTokens":9876543211,"costUsd":123.46,"clients":{"claude":123456790,"codex":9876544,"gemini":555555556},"clientCosts":{"claude":123.46,"codex":67.90,"gemini":56.79}},
  "allTime":{"totalTokens":98765432101,"costUsd":1234.57,"clients":{"claude":9223372036854775806,"codex":987654322,"gemini":5555555556},"clientCosts":{"claude":1234.57,"codex":678.91,"gemini":567.90}}
 },
 "limits":{"providers":[
  {"provider":"Claude","accountLabel":"personal","planLabel":"Pro","windows":[
   {"kind":"session","label":"Sonnet 5h","showMeter":true,"remainingPercent":14,"resetsAt":"2026-10-15T05:00:00Z"},
   {"kind":"weekly","label":"Sonnet weekly","showMeter":true,"remainingPercent":72,"resetsAt":"2026-10-21T05:00:00Z"},
   {"kind":"session","label":"Opus 5h","showMeter":true,"remainingPercent":42,"resetsAt":"2026-10-15T05:00:00Z"},
   {"kind":"weekly","label":"Opus weekly","showMeter":true,"remainingPercent":65,"resetsAt":"2026-10-21T05:00:00Z"},
   {"kind":"daily","label":"Extra daily","showMeter":true,"remainingPercent":null},
   {"kind":"billing","label":"Credits monthly","showMeter":true,"remainingPercent":80,"resetsAt":"2026-11-01T00:00:00Z"}
  ]},
  {"provider":"Claude","accountLabel":"work","planLabel":"Team","windows":[{"kind":"session","label":"5h","showMeter":true,"remainingPercent":25,"resetsAt":"2026-10-15T03:00:00Z"},{"kind":"weekly","label":"weekly","showMeter":true,"remainingPercent":89,"resetsAt":"2026-10-20T00:00:00Z"}]},
  {"provider":"Codex","planLabel":"Plus","windows":[{"kind":"session","label":"5h","showMeter":true,"remainingPercent":99.6,"resetsAt":"2026-10-15T02:00:00Z"},{"kind":"weekly","label":"weekly","showMeter":true,"remainingPercent":55,"resetsAt":"2026-10-21T00:00:00Z"}]},
  {"provider":"Idle service","planLabel":"Standard","windows":[{"kind":"session","label":"5h","showMeter":true,"remainingPercent":100,"resetsAt":"2026-10-15T02:00:00Z"}]},
  {"provider":"Unknown service with a longer display name","planLabel":"Custom","windows":[{"kind":"weekly","label":"weekly","showMeter":true,"remainingPercent":null},{"kind":"daily","label":"Internal daily","showMeter":false,"remainingPercent":0}]}
 ]}
}`
