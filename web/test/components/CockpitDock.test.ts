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
            symbol: 'NIFTY 24200 CE',
            type: 'CE',
            mode: 'AUTONOMOUS',
            quantity: 50,
            entryPrice: 140,
            currentPrice: 170,
            peakPrice: 175,
            peakPct: 25,
            ratchetTierText: 'Tier 2: Locked +55% MFE',
            stopLoss: 160,
            unrealizedPnl: 1500,
            unrealizedPnlPct: 21.4,
          },
        ],
      },
    })

    const content = wrapper.find('[data-test="dock-positions-content"]')
    expect(content.text()).toContain('NIFTY 24200 CE')
    expect(content.text()).toContain('Tier 2: Locked +55% MFE')
    expect(content.text()).toContain('+₹1500.00')
  })

  it('emits scalePosition and closePosition on button clicks', async () => {
    const wrapper = mount(CockpitDock, {
      props: {
        activeTab: 'positions',
        marketState: 'open',
        positions: [
          {
            id: 'pos-101',
            symbol: 'NIFTY 24200 CE',
            type: 'CE',
            mode: 'AUTONOMOUS',
            quantity: 50,
            entryPrice: 140,
            currentPrice: 170,
            peakPrice: 175,
            peakPct: 25,
            ratchetTierText: 'Tier 2',
            stopLoss: 160,
            unrealizedPnl: 1500,
            unrealizedPnlPct: 21.4,
          },
        ],
      },
    })

    const scaleBtn = wrapper.find('[data-test="scale-btn"]')
    await scaleBtn.trigger('click')
    expect(wrapper.emitted('scalePosition')![0]).toEqual(['pos-101', 50])

    const closeBtn = wrapper.find('[data-test="close-btn"]')
    await closeBtn.trigger('click')
    expect(wrapper.emitted('closePosition')![0]).toEqual(['pos-101'])
  })

  it('renders closed trades with forensic metrics when history tab is selected', () => {
    const wrapper = mount(CockpitDock, {
      props: {
        activeTab: 'history',
        marketState: 'closed',
        closedTrades: [
          {
            id: 'TRD-TEST-1',
            symbol: 'NIFTY 24150 CE',
            entryPrice: 100,
            exitPrice: 140,
            exitAttribution: 'Ratchet Tier 3 Lock',
            peakMfePct: 40,
            mfeCapturePct: 80,
            netPnl: 2000,
            forensicVerdict: 'Clean Trend Capture',
          },
        ],
      },
    })

    const content = wrapper.find('[data-test="dock-history-content"]')
    expect(content.text()).toContain('TRD-TEST-1')
    expect(content.text()).toContain('Ratchet Tier 3 Lock')
    expect(content.text()).toContain('80.0%')
    expect(content.text()).toContain('+₹2000.00')
    expect(content.text()).toContain('Clean Trend Capture')
  })
})
