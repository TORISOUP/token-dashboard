package display

import (
	"context"
	"encoding/base64"
	"reflect"
	"time"
)

// Services supplies the same service identities and selections used by the renderer.
func (s *Service) Services() ([]ServiceChoice, error) {
	stats, source := s.State.Snapshot()
	preferences := Presentation{}
	if s.Configuration != nil {
		config, err := s.Configuration()
		if err != nil {
			return nil, err
		}
		preferences = config.Presentation
	}
	return ServiceChoices(stats, source, preferences), nil
}

// ThemePreview prepares an independent first page; it never changes the resident cursor.
func (s *Service) ThemePreview(id string) (ThemeData, error) {
	stats, source := s.State.Snapshot()
	hidden, err := s.hiddenSet()
	if err != nil {
		return ThemeData{}, err
	}
	config := Configuration{Source: source, Theme: s.Themes[id]}
	if s.Configuration != nil {
		selected, err := s.Configuration()
		if err != nil {
			return ThemeData{}, err
		}
		config.Presentation = selected.Presentation
	}
	data := themeData(withoutHidden(stats, hidden), time.Now(), source, 0)
	if config.Theme.ServiceLayout() {
		pages, message := ServicePages(stats, time.Now(), config, hidden)
		data.ServiceMessage = message
		if len(pages) > 0 {
			data.Service = &pages[0]
		}
	}
	return data, nil
}

// RunPresentation owns page identity and deadlines independently of the view and renderer.
// Its input is the runtime configuration; persistence and USB are connected in stage 4.
func RunPresentation(ctx context.Context, s *Service, renderer *CanvasRenderer, redraw time.Duration, emit func(string, any)) {
	beat := time.NewTicker(redraw)
	defer beat.Stop()
	var previous Configuration
	var oldPages []ServicePage
	page := 0
	deadline := time.Now()
	initialized := false
	for {
		config, err := s.Configuration()
		if err != nil {
			s.Logger.Error("display_configuration_failed", "cause", err)
			return
		}
		now := time.Now()
		stats, source := s.State.Snapshot()
		config.Source = source
		hidden, err := s.hiddenSet()
		if err != nil {
			s.Logger.Warn("hidden_limits_unavailable", "cause", err)
		}
		data := themeData(withoutHidden(stats, hidden), now, source, page)
		pages := []ServicePage{}
		count := data.GaugePages
		if config.Theme.DataLayout == "bars" {
			count = data.BarPages
		}
		reset := !initialized || config.Theme.ID != previous.Theme.ID || config.Source != previous.Source || config.Cycle != previous.Cycle || !reflect.DeepEqual(config.Presentation.Services, previous.Presentation.Services) || config.Presentation.SkipFull5h != previous.Presentation.SkipFull5h
		if config.Theme.ServiceLayout() {
			var message string
			pages, message = ServicePages(stats, now, config, hidden)
			data.ServiceMessage = message
			count = len(pages)
			if !reset && config.Cycle && len(oldPages) > 0 {
				found := false
				for offset := 0; offset < len(oldPages); offset++ {
					key := oldPages[(page+offset)%len(oldPages)].Key
					for index, candidate := range pages {
						if candidate.Key == key {
							page = index
							found = true
							break
						}
					}
					if found {
						break
					}
				}
				if !found {
					page = 0
				}
			}
		}
		interval := time.Duration(config.CycleSeconds) * time.Second
		if interval <= 0 {
			interval = 10 * time.Second
		}
		if reset || !config.Cycle || page >= count {
			page = 0
		}
		if reset || config.CycleSeconds != previous.CycleSeconds {
			deadline = now.Add(interval)
		}
		if config.Cycle && count > 1 && !now.Before(deadline) {
			page = (page + 1) % count
			deadline = now.Add(interval)
		}
		if len(pages) > 0 {
			data.Service = &pages[page]
		} else if !config.Theme.ServiceLayout() {
			data = themeData(withoutHidden(stats, hidden), now, source, page)
		}
		request := FrameRequest{Theme: config.Theme.ID, Width: config.Theme.Width, Height: config.Theme.Height, Data: data, OutputFormat: "png", Reverse180: config.Presentation.Reverse180, Generation: config.Generation}
		if !config.Theme.ServiceLayout() {
			request.OutputFormat = "jpeg"
			request.Reverse180 = false
		}
		frame, err := renderer.RenderPrepared(ctx, request, count)
		if ctx.Err() != nil {
			return
		}
		if err != nil {
			s.Logger.Error("display_render_failed", "cause", err)
		} else {
			s.mu.Lock()
			s.preview = "data:image/png;base64," + base64.StdEncoding.EncodeToString(frame.PNG)
			s.mu.Unlock()
			emit(Updated, nil)
		}
		previous = config
		oldPages = pages
		initialized = true
		delay := time.Hour
		if config.Cycle && count > 1 {
			delay = max(time.Millisecond, time.Until(deadline))
		}
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-s.State.Changed():
		case <-beat.C:
		case <-timer.C:
		}
		timer.Stop()
	}
}
