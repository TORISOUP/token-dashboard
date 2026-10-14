package settings

import (
	"slices"
	"strings"

	"token-monitor-turzx/internal/display"
	"token-monitor-turzx/internal/turzx"
)

// UseMemory is called only by the explicit development composition. The file schema is unchanged.
func UseMemory(s *Service, initial View, themes map[string]display.Theme, devices func() ([]turzx.Device, error)) {
	s.memory = &file{Source: initial.Source, DisplayID: initial.DisplayID, LimitStyle: initial.LimitStyle, Cycle: initial.Cycle, CycleSeconds: initial.CycleSeconds, AwayMinutes: initial.AwayMinutes}
	for _, device := range initial.Displays {
		if device.DeviceID == initial.DisplayID {
			s.memory.DisplayName = device.Name
		}
	}
	s.presentation = display.ClonePresentation(initial.Presentation)
	s.themes = themes
	s.generation = 1
	s.list = devices
}

func (s *Service) view(saved file, conn connection, devices []turzx.Device) View {
	view := viewOf(saved, conn, devices)
	if s.memory == nil {
		return view
	}
	view.Presentation = display.ClonePresentation(s.presentation)
	view.SpecificationPreview = true
	view.Generation = s.generation
	view.LimitStyle = themeID(saved.LimitStyle)
	for _, theme := range s.themes {
		view.Themes = append(view.Themes, theme)
	}
	slices.SortFunc(view.Themes, func(a, b display.Theme) int {
		rank := func(t display.Theme) int {
			if t.ID == "gauges" {
				return 0
			}
			if t.ID == "bars" {
				return 1
			}
			return 2
		}
		if rank(a) != rank(b) {
			return rank(a) - rank(b)
		}
		return strings.Compare(a.Name, b.Name)
	})
	target := targetID(saved, devices)
	view.CompatibleThemeIDs = []string{}
	for _, theme := range view.Themes {
		if supportsTheme(target, theme) {
			view.CompatibleThemeIDs = append(view.CompatibleThemeIDs, theme.ID)
		}
	}
	if _, known := turzx.ProfileForID(target); target != "" && !known {
		view.OutputWarning = "Cannot identify the selected output. USB output is paused."
	} else if theme := s.themes[view.LimitStyle]; !supportsTheme(target, theme) {
		view.OutputWarning = "Selected style size is not supported by this output. USB output is paused."
	}
	return view
}

func targetID(saved file, devices []turzx.Device) string {
	if saved.DisplayID != "" || len(devices) == 0 {
		return saved.DisplayID
	}
	return slices.MinFunc(devices, func(a, b turzx.Device) int { return strings.Compare(a.ID, b.ID) }).ID
}

func themeID(style string) string {
	switch style {
	case "", "Gauges":
		return "gauges"
	case "Bars":
		return "bars"
	default:
		return style
	}
}

func supportsTheme(target string, theme display.Theme) bool {
	if target == "" {
		return true // Automatic without a connected output permits preview configuration.
	}
	profile, known := turzx.ProfileForID(target)
	return known && profile.Supports(theme.Width, theme.Height)
}
