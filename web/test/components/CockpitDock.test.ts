import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import CockpitDock from '../../app/components/cockpit/CockpitDock.vue'

describe('CockpitDock.vue', () => {
  it('renders active positions table in open state', () => {
    const wrapper = mount(CockpitDock, {
      props: {
        activeTab: 'positions',
        marketState: 'open',
        positions: [
          {
            id: 'pos-101',
            symbol: 'NIFTY24O1924200CE',
            quantity: 50,
            buyPrice: 140,
            lastPrice: 170,
            stopLoss: 160,
            unrealizedPnL: 1500,
          },
        ],
      },
    })

    const content = wrapper.find('[data-test="dock-positions-content"]')
    expect(content.text()).toContain('NIFTY24O1924200CE')
    expect(content.text()).toContain('+₹1500.00')
  })

  it('renders PaperPosition fields with avgEntryPrice, trailingSlLocked and T1 hit badge', () => {
    const wrapper = mount(CockpitDock, {
      props: {
        activeTab: 'positions',
        marketState: 'open',
        positions: [
          {
            symbol: 'NIFTY26N0925000PE',
            token: 12345,
            quantity: 65,
            avgEntryPrice: 34.0,
            currentPrice: 36.45,
            trailingSlLocked: 34.75,
            aiStopLoss: 34.75,
            t1Target: 36.45,
            t1Hit: true,
            unrealizedPnL: 159.25,
          },
        ],
      },
    })

    const content = wrapper.find('[data-test="dock-positions-content"]')
    expect(content.text()).toContain('NIFTY26N0925000PE')
    expect(content.text()).toContain('₹34.00')
    expect(content.text()).toContain('₹36.45')
    expect(content.text()).toContain('₹34.75')
    expect(content.text()).toContain('LOCKED')
    expect(content.text()).toContain('🥇 HIT')
    expect(content.text()).toContain('+₹159.25')
  })

  it('emits closePosition on button click', async () => {
    const wrapper = mount(CockpitDock, {
      props: {
        activeTab: 'positions',
        marketState: 'open',
        positions: [
          {
            id: 'pos-101',
            symbol: 'NIFTY24O1924200CE',
            quantity: 50,
            buyPrice: 140,
            lastPrice: 170,
            stopLoss: 160,
            unrealizedPnL: 1500,
          },
        ],
      },
    })

    const closeBtn = wrapper.find('[data-test="close-btn"]')
    await closeBtn.trigger('click')
    expect(wrapper.emitted('closePosition')![0]).toEqual(['pos-101'])
  })

  it('renders real historical trades when history tab is selected', () => {
    const wrapper = mount(CockpitDock, {
      props: {
        activeTab: 'history',
        marketState: 'closed',
        tradeHistory: [
          {
            id: 'TRD-TEST-1234',
            symbol: 'NIFTY24O1924150CE',
            side: 'BUY',
            quantity: 50,
            entryPrice: '100.00',
            exitPrice: '140.00',
            exitReason: 'Target hit',
            pnl: '2000.00',
            openedAt: '2026-11-08T09:30:00Z',
          },
        ],
      },
    })

    const content = wrapper.find('[data-test="dock-history-content"]')
    expect(content.text()).toContain('TRD-TEST')
    expect(content.text()).toContain('NIFTY24O1924150CE')
    expect(content.text()).toContain('Target hit')
    expect(content.text()).toContain('+₹2000.00')
  })

  it('expands forensic log when history row is clicked', async () => {
    const wrapper = mount(CockpitDock, {
      props: {
        activeTab: 'history',
        marketState: 'closed',
        tradeHistory: [
          {
            id: 'TRD-FORENSIC-01',
            symbol: 'NIFTY24O1924150PE',
            side: 'BUY',
            quantity: 50,
            entryPrice: '120.00',
            exitPrice: '150.00',
            exitReason: 'Profit Ratchet Lock',
            pnl: '1500.00',
            aiReasoning: 'Bullish exhaustion detected at resistance. Trailing SL locked +₹1500.',
            setup: 'TRAP_REVERSAL',
            vixLevel: '14.2',
            openedAt: '2026-11-08T10:00:00Z',
          },
        ],
      },
    })

    const row = wrapper.find('[data-test="history-row"]')
    await row.trigger('click')

    expect(wrapper.text()).toContain('FORENSIC AUDIT & DECISION TRACE')
    expect(wrapper.text()).toContain('TRAP_REVERSAL')
    expect(wrapper.text()).toContain('Bullish exhaustion detected at resistance')
  })

  it('paginates trade history when there are more than 10 trades', async () => {
    // Generate 25 dummy trades
    const trades = Array.from({ length: 25 }, (_, i) => ({
      id: `TRD-${i + 1}`,
      symbol: 'NIFTY24O1924150CE',
      side: 'BUY',
      quantity: 50,
      entryPrice: '100.00',
      exitPrice: '110.00',
      pnl: '500.00',
      openedAt: '2026-11-08T10:00:00Z',
    }))

    const wrapper = mount(CockpitDock, {
      props: {
        activeTab: 'history',
        marketState: 'closed',
        tradeHistory: trades,
      },
    })

    // Initially displays first 10 trades
    const rowsPage1 = wrapper.findAll('[data-test="history-row"]')
    expect(rowsPage1.length).toBe(10)
    expect(wrapper.text()).toContain('Page 1 of 3')
    expect(wrapper.text()).toContain('Showing 1-10 of 25 trades')

    // Click next page
    const nextBtn = wrapper.find('[data-test="next-page-btn"]')
    expect(nextBtn.exists()).toBe(true)
    await nextBtn.trigger('click')

    const rowsPage2 = wrapper.findAll('[data-test="history-row"]')
    expect(rowsPage2.length).toBe(10)
    expect(wrapper.text()).toContain('Page 2 of 3')
    expect(wrapper.text()).toContain('Showing 11-20 of 25 trades')
  })
})
