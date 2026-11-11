import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AutonomousCockpit from '../../app/components/cockpit/AutonomousCockpit.vue'

describe('AutonomousCockpit.vue', () => {
  it('renders all 4 major sections (Header, HUD, Main, Dock)', () => {
    const wrapper = mount(AutonomousCockpit, {
      props: {
        symbol: 'NIFTY',
        livePrice: 25030.35,
        dailyPnl: 0,
        isMarketOpen: false,
        marketStatusMessage: 'Market is Closed',
        tradeHistory: [],
      },
    })

    expect(wrapper.text()).toContain('AEGIS')
    expect(wrapper.text()).toContain('Autonomous Trading Cockpit')
    expect(wrapper.text()).toContain('NIFTY')
    expect(wrapper.text()).toContain('25,030.35')
    expect(wrapper.text()).toContain('EOD MISSION DEBRIEF:')
    expect(wrapper.text()).toContain("TODAY'S CLOSED TRADES & FORENSIC LOGS (0)")
  })

  it('switches to open market mode when toggle is clicked', async () => {
    const wrapper = mount(AutonomousCockpit, {
      props: {
        isMarketOpen: false,
      },
    })

    const openBtn = wrapper.find('[data-test="state-open-btn"]')
    await openBtn.trigger('click')

    expect(wrapper.text()).toContain('MAS PIPELINE:')
    expect(wrapper.text()).toContain('INTRADAY LIVE EXECUTION')
  })
})
