import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import CockpitChart from '../../app/components/cockpit/CockpitChart.vue'

describe('CockpitChart.vue', () => {
  it('renders timeframes and emits update:selectedTimeframe', async () => {
    const wrapper = mount(CockpitChart, {
      props: {
        selectedTimeframe: '15m',
        marketState: 'open',
      },
    })

    const buttons = wrapper.findAll('[data-test="timeframe-btn"]')
    expect(buttons.length).toBe(4)

    const btn5m = buttons.find((b) => b.text() === '5m')
    expect(btn5m).toBeDefined()
    await btn5m!.trigger('click')

    expect(wrapper.emitted('update:selectedTimeframe')![0]).toEqual(['5m'])
  })

  it('renders mode title depending on marketState', () => {
    const wrapperOpen = mount(CockpitChart, {
      props: { marketState: 'open' },
    })
    expect(wrapperOpen.find('[data-test="chart-mode-title"]').text()).toBe('INTRADAY LIVE EXECUTION')

    const wrapperClosed = mount(CockpitChart, {
      props: { marketState: 'closed' },
    })
    expect(wrapperClosed.find('[data-test="chart-mode-title"]').text()).toBe('HISTORICAL TRAJECTORY REPLAY')
  })

  it('reacts to livePrice prop updates without crashing', async () => {
    const wrapper = mount(CockpitChart, {
      props: {
        candles: [
          { time: 1731123900, open: 24100, high: 24150, low: 24080, close: 24120 },
        ],
        livePrice: 24120,
        selectedTimeframe: '15m',
      },
    })

    expect(wrapper.text()).toContain('LTP: 24120.00')

    await wrapper.setProps({ livePrice: 24165.5 })
    expect(wrapper.text()).toContain('LTP: 24165.50')
  })

  it('renders floating active trade overlay on chart when positions exist', () => {
    const wrapper = mount(CockpitChart, {
      props: {
        marketState: 'open',
        positions: [
          {
            symbol: 'NIFTY26N0925000PE',
            quantity: 65,
            avgEntryPrice: 34.0,
            currentPrice: 36.45,
            unrealizedPnL: 159.25,
            trailingSlLocked: 34.75,
            t1Target: 36.45,
            t1Hit: true,
          },
        ],
      },
    })

    const overlay = wrapper.find('[data-test="chart-active-trade-overlay"]')
    expect(overlay.exists()).toBe(true)
    expect(overlay.text()).toContain('NIFTY26N0925000PE')
    expect(overlay.text()).toContain('₹34.00')
    expect(overlay.text()).toContain('₹36.45')
    expect(overlay.text()).toContain('T1 HIT 🥇')
    expect(overlay.text()).toContain('SL: ₹34.75')
  })
})
