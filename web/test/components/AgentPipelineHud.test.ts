import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AgentPipelineHud from '../../app/components/cockpit/AgentPipelineHud.vue'

describe('AgentPipelineHud.vue', () => {
  it('renders live multi-agent pipeline when market is open', () => {
    const wrapper = mount(AgentPipelineHud, {
      props: {
        marketState: 'open',
        orchestratorAgent: 'SCALPER AGENT',
        specialists: { structure: 'VAH Break', options: 'Call Unwind', gti: 85 },
        criticRisk: 'Low Risk',
        consensus: 'BUY 24200 CE',
        consensusConfidence: 95,
        ratchetTier: 'Tier 3 (+65% MFE)',
      },
    })

    expect(wrapper.find('[data-test="hud-live-section"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="hud-closed-section"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('SCALPER AGENT')
    expect(wrapper.text()).toContain('VAH Break')
    expect(wrapper.text()).toContain('85')
    expect(wrapper.text()).toContain('BUY 24200 CE (95%)')
    expect(wrapper.text()).toContain('Tier 3 (+65% MFE)')
  })

  it('emits selectAgent when node is clicked', async () => {
    const wrapper = mount(AgentPipelineHud, {
      props: {
        marketState: 'open',
      },
    })

    const orchBtn = wrapper.find('[data-test="hud-orchestrator-btn"]')
    await orchBtn.trigger('click')
    expect(wrapper.emitted('selectAgent')![0]).toEqual(['orchestrator'])

    const criticBtn = wrapper.find('[data-test="hud-critic-btn"]')
    await criticBtn.trigger('click')
    expect(wrapper.emitted('selectAgent')![1]).toEqual(['critic'])
  })

  it('renders EOD debrief metrics when market is closed', () => {
    const wrapper = mount(AgentPipelineHud, {
      props: {
        marketState: 'closed',
        eodOutcome: {
          wins: 5,
          losses: 0,
          winRate: 100,
          mfeCapturedPct: 75.5,
          savedCapital: 4200,
          scenariosCount: 3,
          nextOpenText: 'Tomorrow 09:15 IST',
        },
      },
    })

    expect(wrapper.find('[data-test="hud-live-section"]').exists()).toBe(false)
    const closedSec = wrapper.find('[data-test="hud-closed-section"]')
    expect(closedSec.exists()).toBe(true)
    expect(closedSec.text()).toContain('5 WINS / 0 LOSS (100% WIN RATE)')
    expect(closedSec.text()).toContain('75.5% PEAK MFE CAPTURED')
    expect(closedSec.text()).toContain('4,200 REVERSAL SAVE')
  })
})
