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

  it('renders mobile bottom navigation bar with all 5 tabs and allows tab switching', async () => {
    const wrapper = mount(AutonomousCockpit, {
      props: {
        symbol: 'NIFTY',
        tradeHistory: [
          {
            id: 'TRD-TODAY-01',
            symbol: 'NIFTY24O1924200CE',
            side: 'BUY',
            quantity: 50,
            pnl: 1200,
            closedAt: new Date().toISOString(),
          },
        ],
      },
    })

    const nav = wrapper.find('[data-test="mobile-bottom-nav"]')
    expect(nav.exists()).toBe(true)

    // Check all 5 tabs exist
    expect(wrapper.find('[data-test="mobile-tab-positions"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="mobile-tab-history"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="mobile-tab-chart"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="mobile-tab-agents"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="mobile-tab-events"]').exists()).toBe(true)

    // Forensics badge reflects today's trade count
    expect(wrapper.find('[data-test="mobile-tab-history"]').text()).toContain('Forensics')
    expect(wrapper.find('[data-test="mobile-tab-history"]').text()).toContain('1')

    // Switch tab to Chart
    const chartTab = wrapper.find('[data-test="mobile-tab-chart"]')
    await chartTab.trigger('click')

    // Switch tab to Forensics
    const historyTab = wrapper.find('[data-test="mobile-tab-history"]')
    await historyTab.trigger('click')
    expect(wrapper.text()).toContain('CLOSED TRADES & FORENSICS')
  })
})
