//go:build windows

package settings

import (
	"bytes"
	"os"
	"reflect"
	"testing"

	"token-monitor-turzx/internal/display"
	"token-monitor-turzx/internal/turzx"
)

const smallDisplay = `USB\VID_1A86&PID_5722\USB35INCHIPSV2`

func presentationThemes() map[string]display.Theme {
	return map[string]display.Theme{
		"gauges":    {ID: "gauges", Width: 1920, Height: 462, DataLayout: "gauges"},
		"bars":      {ID: "bars", Width: 1920, Height: 462, DataLayout: "bars"},
		"landscape": {ID: "landscape", Width: 480, Height: 320, DataLayout: "service-gauges"},
		"portrait":  {ID: "portrait", Width: 320, Height: 480, DataLayout: "service-bars"},
	}
}

func TestCompatibleStylesFollowCapabilitiesWithoutSavingOrAutoSelecting(t *testing.T) {
	for _, tc := range []struct {
		name    string
		target  string
		devices []turzx.Device
		count   int
		warning bool
	}{
		{name: "Automatic offline", count: 4},
		{name: "Automatic small", devices: []turzx.Device{{ID: smallDisplay}}, count: 2, warning: true},
		{name: "Automatic large", devices: []turzx.Device{{ID: first}}, count: 2},
		{name: "Automatic identifier order", devices: []turzx.Device{{ID: first}, {ID: smallDisplay}}, count: 2, warning: true},
		{name: "explicit small offline", target: smallDisplay, count: 2, warning: true},
		{name: "explicit large offline", target: first, count: 2},
		{name: "unknown saved device", target: "unknown", count: 0, warning: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			devices := tc.devices
			s, path := newService(t, &devices)
			ConfigureDisplay(s, presentationThemes())
			if err := s.write(file{Source: "Local", DisplayID: tc.target, LimitStyle: "Gauges"}); err != nil {
				t.Fatal(err)
			}
			before, _ := os.ReadFile(path)
			view, err := s.Get()
			if err != nil {
				t.Fatal(err)
			}
			if len(view.CompatibleThemeIDs) != tc.count || (view.OutputWarning != "") != tc.warning || view.LimitStyle != "gauges" || len(view.Themes) != 4 {
				t.Fatalf("unexpected derived selection: %+v", view)
			}
			after, _ := os.ReadFile(path)
			if !bytes.Equal(before, after) || view.Generation != 1 {
				t.Fatal("reading candidates changed saved state")
			}
			if tc.name == "Automatic small" {
				devices = []turzx.Device{{ID: first}}
				view, _ = s.Get()
				if view.OutputWarning != "" || view.Generation != 1 || view.LimitStyle != "gauges" {
					t.Fatal("connection update saved or automatically chose a style")
				}
			}
		})
	}
}

func TestStyleSelectionRevalidatesTheCurrentAutomaticDevice(t *testing.T) {
	devices := []turzx.Device{{ID: smallDisplay}, {ID: first}}
	s, path := newService(t, &devices)
	ConfigureDisplay(s, presentationThemes())
	before, err := s.Save(SaveRequest{Source: "Local", LimitStyle: "landscape"})
	if err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(path)
	// The selector was populated for the small device, which disconnects before Save.
	devices = []turzx.Device{{ID: first}}
	_, err = s.Save(SaveRequest{Source: "Local", LimitStyle: "portrait"})
	if fieldErrors(t, err)["limitStyle"] == "" {
		t.Fatal("an incompatible selection was accepted")
	}
	after, _ := s.Get()
	current, _ := os.ReadFile(path)
	if after.Generation != before.Generation || after.LimitStyle != "landscape" || !bytes.Equal(data, current) {
		t.Fatal("rejected style selection changed state")
	}
	// Changing only Output is allowed to preserve the old style and warn.
	after, err = s.Save(SaveRequest{Source: "Local", DisplayID: first})
	if err != nil || after.OutputWarning == "" || after.LimitStyle != "landscape" {
		t.Fatalf("output-only change: %+v, %v", after, err)
	}
}

func TestPresentationSaveFailurePreservesGenerationAndPreferences(t *testing.T) {
	devices := []turzx.Device{}
	s, path := newService(t, &devices)
	ConfigureDisplay(s, presentationThemes())
	prefs := &display.Presentation{SkipFull5h: true, Services: map[string]map[string]display.ServiceContent{"Local": {"Claude": {Enabled: false, Content: "Tokens"}}, "Hub": {"claude": {Enabled: true, Content: "Limits"}}}}
	before, err := s.Save(SaveRequest{Source: "Local", LimitStyle: "portrait", Presentation: prefs})
	if err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(path)
	signals := 0
	s.OnDisplaySaved = func() { signals++ }
	if err := os.Chmod(path, 0o444); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(path, 0o600) })
	next := display.ClonePresentation(prefs)
	next.Reverse180 = true
	if _, err := s.Save(SaveRequest{Source: "Local", Presentation: next}); err == nil {
		t.Fatal("read-only settings were replaced")
	}
	after, err := s.Get()
	if err != nil {
		t.Fatal(err)
	}
	current, _ := os.ReadFile(path)
	if !bytes.Equal(data, current) || after.Generation != before.Generation || !reflect.DeepEqual(after.Presentation, before.Presentation) || signals != 0 {
		t.Fatal("failed save changed visible state or notified rendering")
	}
}

func TestPresentationKeepsSourceSpecificMissingEntriesAndLegacyStyle(t *testing.T) {
	devices := []turzx.Device{}
	s, path := newService(t, &devices)
	ConfigureDisplay(s, presentationThemes())
	if err := s.write(file{Source: "Local", LimitStyle: "Bars"}); err != nil {
		t.Fatal(err)
	}
	_, err := s.Save(SaveRequest{Source: "Local", Presentation: &display.Presentation{Services: map[string]map[string]display.ServiceContent{"Local": {"Claude": {Enabled: false, Content: "Tokens"}}, "Hub": {"Claude": {Enabled: true, Content: "Limits"}}}}})
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.Save(SaveRequest{Source: "Local", Presentation: &display.Presentation{Reverse180: true, Services: map[string]map[string]display.ServiceContent{"Local": {"Codex": {Enabled: true, Content: "Both"}}}}})
	if err != nil {
		t.Fatal(err)
	}
	reloaded := New(path, "test.app", func() ([]turzx.Device, error) { return devices, nil }, s.logger)
	ConfigureDisplay(reloaded, presentationThemes())
	view, err := reloaded.Get()
	if err != nil {
		t.Fatal(err)
	}
	saved, _, _ := reloaded.read()
	if saved.LimitStyle != "Bars" || view.LimitStyle != "bars" || view.Presentation.Services["Local"]["Claude"].Enabled || view.Presentation.Services["Local"]["Claude"].Content != "Tokens" || view.Presentation.Services["Hub"]["Claude"].Content != "Limits" || !view.Presentation.Reverse180 {
		t.Fatal("unrelated save lost old style or per-source preferences")
	}
}
