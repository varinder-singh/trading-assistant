import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AutonomousCockpit from '../../app/components/cockpit/AutonomousCockpit.vue'

describe('AutonomousCockpit.vue', () => {
  it('renders all 4 major sections (Header, HUD, Main, Dock)', () => {
    const wrapper = mount(AutonomousCockpit, {
      props: {
        symbol: 'NIFTY 50',
        livePrice: 24185.4,
        dailyPnl: 4850,
      },
    })

    expect(wrapper.text()).toContain('AEGIS')
    expect(wrapper.text()).toContain('Autonomous Trading Cockpit')
    expect(wrapper.text()).toContain('MAS PIPELINE:')
    expect(wrapper.text()).toContain('INTRADAY LIVE EXECUTION')
    expect(wrapper.text()).toContain('Agent Council (MAS)')
    expect(wrapper.text()).toContain('ACTIVE POSITIONS')
  })

  it('switches to closed market mode and updates titles accordingly', async () => {
    const wrapper = mount(AutonomousCockpit, {
      props: {
        isMarketOpen: false,
      },
    })

    const closedBtn = wrapper.find('[data-test="state-closed-btn"]')
    await closedBtn.trigger('click')

    expect(wrapper.text()).toContain('EOD MISSION DEBRIEF:')
    expect(wrapper.text()).toContain('EOD FULL-DAY TRAJECTORY REPLAY')
    expect(wrapper.text()).toContain("Tomorrow's Plan")
  })
})
