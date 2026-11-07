import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AgentDeliberationDrawer from '../../app/components/cockpit/AgentDeliberationDrawer.vue'

describe('AgentDeliberationDrawer.vue', () => {
  it('switches tabs and displays corresponding content', async () => {
    const wrapper = mount(AgentDeliberationDrawer, {
      props: {
        activeTab: 'primary',
        marketState: 'open',
      },
    })

    expect(wrapper.find('[data-test="tab-primary-content"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="tab-secondary-content"]').exists()).toBe(false)

    const greeksBtn = wrapper.find('[data-test="tab-secondary-btn"]')
    await greeksBtn.trigger('click')
    expect(wrapper.emitted('update:activeTab')![0]).toEqual(['secondary'])
  })

  it('renders Greeks and active strike buildup correctly in tab 2', () => {
    const wrapper = mount(AgentDeliberationDrawer, {
      props: {
        activeTab: 'secondary',
        marketState: 'open',
        greeks: {
          delta: 0.54,
          theta: 165.5,
          gamma: 0.0031,
          ivRank: 32.5,
          strikeBuildup: [
            { strike: '24,200 ATM', ceOi: 40, peOi: 60, totalText: '62.0L' },
          ],
        },
      },
    })

    const content = wrapper.find('[data-test="tab-secondary-content"]')
    expect(content.text()).toContain('+0.54 Δ')
    expect(content.text()).toContain('₹165.50')
    expect(content.text()).toContain('32.5%')
    expect(content.text()).toContain('24,200 ATM')
  })

  it('renders tomorrow reference levels and scenarios when market is closed', () => {
    const wrapper = mount(AgentDeliberationDrawer, {
      props: {
        activeTab: 'primary',
        marketState: 'closed',
        tomorrowPlan: {
          levels: { val: 24050, poc: 24120, vah: 24220 },
          scenarios: [
            {
              code: 'A',
              title: 'SCENARIO A: Breakout',
              agent: 'TREND AGENT',
              description: 'Wait for 5m close above 24,220 VAH.',
              borderColor: 'border-emerald-500',
            },
          ],
        },
      },
    })

    const content = wrapper.find('[data-test="tab-primary-content"]')
    expect(content.text()).toContain('24050.00')
    expect(content.text()).toContain('24120.00')
    expect(content.text()).toContain('24220.00')
    expect(content.text()).toContain('SCENARIO A: Breakout')
  })

  it('emits selectStock when a screener candidate is clicked in tab 3', async () => {
    const wrapper = mount(AgentDeliberationDrawer, {
      props: {
        activeTab: 'tertiary',
        marketState: 'open',
        screener: [
          { symbol: 'TCS', trigger: 'POC Test', change: '+1.2%', gti: 88 },
        ],
      },
    })

    const item = wrapper.find('[data-test="screener-item"]')
    expect(item.exists()).toBe(true)
    await item.trigger('click')
    expect(wrapper.emitted('selectStock')![0]).toEqual(['TCS'])
  })
})
