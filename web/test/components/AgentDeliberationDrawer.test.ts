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

  it('renders real options analysis data when available in tab 2', () => {
    const wrapper = mount(AgentDeliberationDrawer, {
      props: {
        activeTab: 'secondary',
        marketState: 'open',
        optionsAnalysis: {
          pcr: 1.34,
          maxPain: 25000,
        },
      },
    })

    const content = wrapper.find('[data-test="tab-secondary-content"]')
    expect(content.text()).toContain('1.34')
    expect(content.text()).toContain('25000')
  })

  it('renders agent status and messages in tab 1', () => {
    const wrapper = mount(AgentDeliberationDrawer, {
      props: {
        activeTab: 'primary',
        marketState: 'closed',
        agents: {
          Orchestrator: { status: 'idle', message: 'Awaiting market open...' },
          'Consensus Judge': { status: 'decided', message: 'All EOD positions settled.' },
        },
      },
    })

    const content = wrapper.find('[data-test="tab-primary-content"]')
    expect(content.text()).toContain('Awaiting market open...')
    expect(content.text()).toContain('All EOD positions settled.')
  })

  it('emits selectStock when a screener candidate is clicked in tab 3', async () => {
    const wrapper = mount(AgentDeliberationDrawer, {
      props: {
        activeTab: 'tertiary',
        marketState: 'open',
        screenerData: {
          topGainers: [{ symbol: 'TCS', lastPrice: 3850, changePct: 2.1 }],
        },
      },
    })

    const item = wrapper.find('[data-test="screener-item"]')
    expect(item.exists()).toBe(true)
    await item.trigger('click')
    expect(wrapper.emitted('selectStock')![0]).toEqual(['TCS'])
  })
})
