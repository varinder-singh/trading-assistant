import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import FlightControlHeader from '../../app/components/cockpit/FlightControlHeader.vue'

describe('FlightControlHeader.vue', () => {
  it('renders symbol, live price and positive pnl correctly', () => {
    const wrapper = mount(FlightControlHeader, {
      props: {
        symbol: 'BANKNIFTY',
        livePrice: 51200.5,
        priceChange: 340.2,
        priceChangePct: 0.67,
        dailyPnl: 6500,
        marketState: 'open',
        flightMode: 'auto',
      },
    })

    expect(wrapper.text()).toContain('BANKNIFTY')
    expect(wrapper.text()).toContain('51,200.50')
    expect(wrapper.text()).toContain('+340.20')
    expect(wrapper.text()).toContain('+₹6,500.00')
    expect(wrapper.text()).toContain("TODAY'S P&L (NET)")
    expect(wrapper.find('[data-test="panic-btn"]').exists()).toBe(true)
  })

  it('emits update:marketState when closed state button is clicked', async () => {
    const wrapper = mount(FlightControlHeader, {
      props: {
        marketState: 'open',
      },
    })

    const closedBtn = wrapper.find('[data-test="state-closed-btn"]')
    expect(closedBtn.exists()).toBe(true)
    await closedBtn.trigger('click')

    expect(wrapper.emitted('update:marketState')).toBeTruthy()
    expect(wrapper.emitted('update:marketState')![0]).toEqual(['closed'])
  })

  it('emits update:flightMode when mode buttons are clicked', async () => {
    const wrapper = mount(FlightControlHeader, {
      props: {
        flightMode: 'auto',
      },
    })

    const supervisedBtn = wrapper.find('[data-test="mode-supervised-btn"]')
    await supervisedBtn.trigger('click')
    expect(wrapper.emitted('update:flightMode')![0]).toEqual(['supervised'])

    const haltBtn = wrapper.find('[data-test="mode-halt-btn"]')
    await haltBtn.trigger('click')
    expect(wrapper.emitted('update:flightMode')![1]).toEqual(['halt'])
  })

  it('renders closed market state with token validity and without panic button', () => {
    const wrapper = mount(FlightControlHeader, {
      props: {
        marketState: 'closed',
      },
    })

    expect(wrapper.text()).toContain('TODAY REALIZED NET')
    expect(wrapper.find('[data-test="panic-btn"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="token-status-btn"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="token-status-btn"]').text()).toContain('KITE AUTH: ACTIVE')
  })

  it('renders active position pill in header when positions are open', () => {
    const wrapper = mount(FlightControlHeader, {
      props: {
        symbol: 'NIFTY',
        marketState: 'open',
        positions: [
          {
            symbol: 'NIFTY26N0925000PE',
            quantity: 65,
            avgEntryPrice: 34.0,
            unrealizedPnL: 159.25,
            trailingSlLocked: 34.75,
            t1Hit: true,
          },
        ],
      },
    })

    const pill = wrapper.find('[data-test="header-active-position-pill"]')
    expect(pill.exists()).toBe(true)
    expect(pill.text()).toContain('NIFTY26N0925000PE')
    expect(pill.text()).toContain('65x @ ₹34.00')
    expect(pill.text()).toContain('T1 LOCKED 🥇')
  })
})
