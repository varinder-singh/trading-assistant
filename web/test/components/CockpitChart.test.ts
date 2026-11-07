import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import CockpitChart from '../../app/components/cockpit/CockpitChart.vue'

describe('CockpitChart.vue', () => {
  it('renders timeframes and emits update:selectedTimeframe', async () => {
    const wrapper = mount(CockpitChart, {
      props: {
        selectedTimeframe: '3m',
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

  it('renders mode title depending on marketState', async () => {
    const wrapperOpen = mount(CockpitChart, {
      props: { marketState: 'open' },
    })
    expect(wrapperOpen.find('[data-test="chart-mode-title"]').text()).toBe('INTRADAY LIVE EXECUTION')

    const wrapperClosed = mount(CockpitChart, {
      props: { marketState: 'closed' },
    })
    expect(wrapperClosed.find('[data-test="chart-mode-title"]').text()).toBe('EOD FULL-DAY TRAJECTORY REPLAY')
  })

  it('renders AI entry tooltip in open state', () => {
    const wrapper = mount(CockpitChart, {
      props: { marketState: 'open' },
    })
    expect(wrapper.find('[data-test="chart-entry-tooltip"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="chart-entry-tooltip"]').text()).toContain('MAS AUTONOMOUS ENTRY')
  })
})
