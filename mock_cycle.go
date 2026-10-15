package main

import (
	"os"

	"token-monitor-turzx/internal/settings"
	"token-monitor-turzx/internal/usage"
)

// startCycleMock is the single startup composition point for the Cycle UI discussion.
func startCycleMock(config *settings.Service, state *usage.State) bool {
	if !serverMode || os.Getenv("WAILS_CYCLE_MOCK") != "1" {
		return false
	}
	settings.UseCycleMock(config)
	claude, second, codex := 32.0, 76.0, 58.0
	state.Set(&usage.Stats{
		Periods: usage.Periods{
			Today:   usage.Period{TotalTokens: 120000, CostUSD: 3.25, ClientBreakdown: &usage.ClientBreakdown{Clients: map[string]int64{"claude": 80000, "codex": 40000}, ClientCosts: map[string]float64{"claude": 2.10, "codex": 1.15}}},
			Month:   usage.Period{TotalTokens: 3600000, CostUSD: 92.50, ClientBreakdown: &usage.ClientBreakdown{Clients: map[string]int64{"claude": 2400000, "codex": 1200000}, ClientCosts: map[string]float64{"claude": 62.50, "codex": 30}}},
			AllTime: usage.Period{TotalTokens: 9200000, CostUSD: 250, ClientBreakdown: &usage.ClientBreakdown{Clients: map[string]int64{"claude": 6200000, "codex": 3000000}, ClientCosts: map[string]float64{"claude": 170, "codex": 80}}},
		},
		Limits: usage.Limits{Providers: []usage.Provider{
			{Provider: "Claude", AccountLabel: "personal", PlanLabel: "Personal", Windows: []usage.Window{{Kind: "session", Label: "5h", ShowMeter: true, RemainingPercent: &claude}}},
			{Provider: "Claude", AccountLabel: "work", PlanLabel: "Work", Windows: []usage.Window{{Kind: "session", Label: "5h", ShowMeter: true, RemainingPercent: &second}}},
			{Provider: "Codex", AccountLabel: "personal", PlanLabel: "Plus", Windows: []usage.Window{{Kind: "session", Label: "5h", ShowMeter: true, RemainingPercent: &codex}}},
		}},
	})
	return true
}
