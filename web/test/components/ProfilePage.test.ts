import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import ProfilePage from '../../app/pages/profile.vue'

describe('ProfilePage.vue', () => {
  let mockPutPayloads: any[] = []

  beforeEach(() => {
    mockPutPayloads = []

    // Mock Nuxt globals used by profile.vue
    ;(globalThis as any).useSupabaseUser = () => ref({ id: 'user-123', email: 'trader@example.com' })
    ;(globalThis as any).navigateTo = vi.fn()
    ;(globalThis as any).useFetch = vi.fn(async (url: string, opts?: any) => {
      if (opts?.method === 'PUT') {
        mockPutPayloads.push(opts.body)
        return { data: ref({ success: true }), error: ref(null) }
      }
      if (url === '/api/profile') {
        return {
          data: ref({
            id: 'user-123',
            fullName: null, // Empty fullName (as in user screenshot)
            email: 'trader@example.com',
            tradeMode: 'PAPER',
            allowedUniverses: 'INDEX_OPTIONS,EQUITY,STOCK_OPTIONS',
            stockOptionPreference: 'PREFER_OPTIONS_IF_LISTED',
            equityHoldingMode: 'MIS',
            equityRiskPerTrade: 1500,
            maxActivePositions: 10,
            maxIndexPositions: 2,
            maxDailyTrades: 30,
            enablePullbackEntry: true,
          }),
          error: ref(null),
        }
      }
      return { data: ref([]), error: ref(null) }
    })

    ;(globalThis as any).$fetch = vi.fn(async (url: string, opts?: any) => {
      if (url === '/api/profile') {
        if (opts?.method === 'PUT') {
          mockPutPayloads.push(opts.body)
          return { success: true, profile: opts.body }
        }
        return {
          id: 'user-123',
          fullName: null,
          email: 'trader@example.com',
          tradeMode: 'PAPER',
          allowedUniverses: 'INDEX_OPTIONS,EQUITY,STOCK_OPTIONS',
          stockOptionPreference: 'PREFER_OPTIONS_IF_LISTED',
          equityHoldingMode: 'MIS',
          equityRiskPerTrade: 1500,
          maxActivePositions: 10,
          maxIndexPositions: 2,
          maxDailyTrades: 30,
          enablePullbackEntry: true,
        }
      }
      if (url === '/api/profile/connections') return []
      return {}
    })
  })

  it('renders a scrollable viewport container (h-screen overflow-y-auto)', async () => {
    const wrapper = mount(ProfilePage, {
      global: {
        stubs: {
          NuxtLink: { template: '<a><slot /></a>' },
        },
      },
    })
    await flushPromises()

    const scrollContainer = wrapper.find('[data-test="profile-scroll-container"]')
    expect(scrollContainer.exists()).toBe(true)
    expect(scrollContainer.classes()).toContain('h-screen')
    expect(scrollContainer.classes()).toContain('overflow-y-auto')
  })

  it('keeps Save Changes button enabled when fullName is empty and saves Reserved NIFTY Index Slots changes', async () => {
    const wrapper = mount(ProfilePage, {
      global: {
        stubs: {
          NuxtLink: { template: '<a><slot /></a>' },
        },
      },
    })
    await flushPromises()

    const saveBtn = wrapper.find('[data-test="save-profile-btn"]')
    expect(saveBtn.exists()).toBe(true)
    // Save button MUST be enabled even though fullName is empty
    expect((saveBtn.element as HTMLButtonElement).disabled).toBe(false)

    // Change Reserved NIFTY Index Slots from 2 to 8 (matching user screenshot)
    const indexSlotsInput = wrapper.find('[data-test="max-index-positions-input"]')
    expect(indexSlotsInput.exists()).toBe(true)
    await indexSlotsInput.setValue('8')

    // Verify dynamic helper text updates stock slot allocation (10 - 8 = 2 slots)
    expect(wrapper.text()).toContain('Stocks get up to 2 slots')

    // Submit form to save changes
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    // Verify PUT /api/profile was called and saved the updated records
    expect(mockPutPayloads).toHaveLength(1)
    expect(mockPutPayloads[0]).toMatchObject({
      allowedUniverses: 'INDEX_OPTIONS,EQUITY,STOCK_OPTIONS',
      stockOptionPreference: 'PREFER_OPTIONS_IF_LISTED',
      equityHoldingMode: 'MIS',
      equityRiskPerTrade: 1500,
      maxActivePositions: 10,
      maxIndexPositions: 8,
      maxDailyTrades: 30,
      enablePullbackEntry: true,
    })
    expect(wrapper.text()).toContain('Settings updated successfully!')
  })

  it('allows user to change Total Active Positions (10), Reserved Slots (2), and Daily Trades (30) to custom values and persists them', async () => {
    const wrapper = mount(ProfilePage, {
      global: {
        stubs: {
          NuxtLink: { template: '<a><slot /></a>' },
        },
      },
    })
    await flushPromises()

    // Change 10 -> 16
    const activePositionsInput = wrapper.find('[data-test="max-active-positions-input"]')
    await activePositionsInput.setValue('16')

    // Change 2 -> 6
    const indexPositionsInput = wrapper.find('[data-test="max-index-positions-input"]')
    await indexPositionsInput.setValue('6')

    // Change 30 -> 45
    const dailyTradesInput = wrapper.find('[data-test="max-daily-trades-input"]')
    await dailyTradesInput.setValue('45')

    // Dynamic stock slot helper text: 16 - 6 = 10 slots
    expect(wrapper.text()).toContain('Stocks get up to 10 slots')

    // Submit form
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(mockPutPayloads).toHaveLength(1)
    expect(mockPutPayloads[0]).toMatchObject({
      maxActivePositions: 16,
      maxIndexPositions: 6,
      maxDailyTrades: 45,
    })
    expect(wrapper.text()).toContain('Settings updated successfully!')
  })
})
