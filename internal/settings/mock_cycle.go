package settings

import "token-monitor-turzx/internal/turzx"

// UseCycleMock swaps only the storage and device-list boundaries for the UI discussion.
// The server-only startup composition calls it; normal startup keeps disk-backed settings.
func UseCycleMock(s *Service) {
	const small = `USB\VID_1A86&PID_5722&MOCK\USB35INCHIPSV2`
	const large = `USB\VID_1CBE&PID_0092\MOCK92`
	s.memory = &file{Source: "Local", DisplayID: small, DisplayName: "TURZX 3.5-inch (Mock)", LimitStyle: "gauges-35-landscape", CycleSeconds: 30, ServiceCycleSeconds: 10}
	s.list = func() ([]turzx.Device, error) {
		return []turzx.Device{{ID: small, Name: "TURZX 3.5-inch (Mock)"}, {ID: large, Name: "TURZX 9.2-inch (Mock)"}}, nil
	}
}
