import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AgentPipelineHud from '../../app/components/cockpit/AgentPipelineHud.vue'

describe('AgentPipelineHud.vue', () => {
  it('renders live multi-agent pipeline when market is open', () => {
    const wrapper = mount(AgentPipelineHud, {
      props: {
        marketState: 'open',
        agents: {
          Orchestrator: { status: 'active', message: 'Trend mode selected' },
          'Adversarial Critic': { status: 'decided', message: 'Risk verified' },
          'Consensus Judge': { status: 'decided', message: 'BUY signal confirmed' },
          'Risk Manager': { status: 'active', message: 'Position protected' },
        },
        activeSpecialist: 'SCALPER',
      },
    })

    expect(wrapper.find('[data-test="hud-live-section"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="hud-closed-section"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('ACTIVE')
    expect(wrapper.text()).toContain('SCALPER')
  })

  it('emits selectAgent when node is clicked', async () => {
    const wrapper = mount(AgentPipelineHud, {
      props: {
        marketState: 'open',
        agents: {
          Orchestrator: { status: 'active', message: 'Analyzing' },
        },
      },
    })

    const orchBtn = wrapper.find('[data-test="hud-orchestrator-btn"]')
    await orchBtn.trigger('click')
    expect(wrapper.emitted('selectAgent')![0]).toEqual(['Orchestrator'])
  })

  it('renders real EOD debrief metrics calculated from tradeHistory when closed', () => {
    const today = new Date().toISOString().split('T')[0]
    const wrapper = mount(AgentPipelineHud, {
      props: {
        marketState: 'closed',
        tradeHistory: [
          { id: 't1', closedAt: `${today}T10:00:00Z`, pnl: '1500' },
          { id: 't2', closedAt: `${today}T11:00:00Z`, pnl: '-500' },
        ],
        marketStatusMessage: 'Market is Closed',
      },
    })

    expect(wrapper.find('[data-test="hud-live-section"]').exists()).toBe(false)
    const closedSec = wrapper.find('[data-test="hud-closed-section"]')
    expect(closedSec.exists()).toBe(true)
    expect(closedSec.text()).toContain('2 TRADES (1W / 1L)')
    expect(closedSec.text()).toContain('50.0%')
    expect(closedSec.text()).toContain('+₹1,000.00')
    expect(closedSec.text()).toContain('Market is Closed')
  })
})
