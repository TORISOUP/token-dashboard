package settings

import (
	"slices"
	"strings"

	"token-monitor-turzx/internal/display"
	"token-monitor-turzx/internal/fault"
	"token-monitor-turzx/internal/turzx"
)

// ConfigureDisplay binds the available styles to the normal disk-backed settings service.
func ConfigureDisplay(s *Service, themes map[string]display.Theme) {
	s.themes, s.generation = themes, 1
}

func presentationOf(saved file) *display.Presentation {
	if saved.Presentation == nil {
		return &display.Presentation{Services: map[string]map[string]display.ServiceContent{}}
	}
	return display.ClonePresentation(saved.Presentation)
}

func mergePresentation(saved, requested *display.Presentation) *display.Presentation {
	next := presentationOf(file{Presentation: saved})
	next.Reverse180, next.SkipFull5h = requested.Reverse180, requested.SkipFull5h
	for source, services := range requested.Services {
		if next.Services[source] == nil {
			next.Services[source] = map[string]display.ServiceContent{}
		}
		for id, value := range services {
			next.Services[source][id] = value
		}
	}
	return next
}

// DisplayConfiguration snapshots selection and current transport target under the settings lock.
func DisplayConfiguration(s *Service) (display.Configuration, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	saved, _, err := s.read()
	if err != nil {
		return display.Configuration{}, err
	}
	devices, err := s.list()
	if err != nil {
		return display.Configuration{}, err
	}
	theme, exists := s.themes[themeID(saved.LimitStyle)]
	if !exists {
		return display.Configuration{}, fault.New("STYLE_UNAVAILABLE", "The selected style is unavailable.")
	}
	target := targetID(saved, devices)
	connected := slices.ContainsFunc(devices, func(d turzx.Device) bool { return d.ID == target })
	cycle, seconds := saved.Cycle, cycleSecondsOf(saved)
	if theme.ServiceLayout() {
		cycle, seconds = true, serviceCycleSecondsOf(saved)
	}
	return display.Configuration{Theme: theme, Presentation: *presentationOf(saved), Source: saved.Source, Cycle: cycle, CycleSeconds: seconds, Generation: s.generation, TargetID: target, TargetConnected: connected}, nil
}

func (s *Service) view(saved file, conn connection, devices []turzx.Device) View {
	view := viewOf(saved, conn, devices)
	if s.themes == nil {
		return view
	}
	view.Presentation = presentationOf(saved)
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
