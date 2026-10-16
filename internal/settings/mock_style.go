package settings

import "token-monitor-turzx/internal/turzx"

// UseStyleMock is called only by the explicit server startup composition for UI agreement.
func UseStyleMock(s *Service) {
	const small = `USB\VID_1A86&PID_5722\USB35INCHIPSV2`
	const large = `USB\VID_1CBE&PID_0092\MOCK92`
	s.memory = &file{Source: "Local", DisplayID: small, DisplayName: "TURZX 3.5-inch (Mock)", LimitStyle: "Bars", ServiceCycleSeconds: 10}
	s.prepareStyle = s.compatibleStyle
	s.list = func() ([]turzx.Device, error) {
		return []turzx.Device{{ID: small, Name: "TURZX 3.5-inch (Mock)"}, {ID: large, Name: "TURZX 9.2-inch (Mock)"}}, nil
	}
}
