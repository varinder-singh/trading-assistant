import { describe, it, expect, vi } from 'vitest'
import { UserRepository } from '../src/db/repositories/user-repo.js'
import { encryptSecret } from '../src/utils/crypto.js'

describe('UserRepository Alpaca & US Market Profile Isolation', () => {
  it('reads and updates enableUsMarket and alpacaTradingMode on profiles', async () => {
    let savedProfile: any = {
      id: 'user_us_trader',
      tradeMode: 'PAPER',
      watchedSymbol: 'AAPL',
      watchedMode: 'intraday',
      allowedUniverses: 'INDEX_OPTIONS,EQUITY,STOCK_OPTIONS',
      enableUsMarket: false,
      alpacaTradingMode: 'PAPER',
    }

    const mockDb: any = {
      updateTable: vi.fn().mockReturnValue({
        set: vi.fn().mockImplementation((updates) => {
          savedProfile = { ...savedProfile, ...updates }
          return {
            where: vi.fn().mockReturnValue({
              execute: vi.fn().mockResolvedValue({}),
            }),
          }
        }),
      }),
      selectFrom: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            executeTakeFirst: vi.fn().mockImplementation(async () => savedProfile),
          }),
        }),
      }),
    }

    const userRepo = new UserRepository(mockDb)

    // Verify initial profile state
    const initialProfile = await userRepo.getUserProfileByUserId('user_us_trader')
    expect(initialProfile?.enableUsMarket).toBe(false)
    expect(initialProfile?.alpacaTradingMode).toBe('PAPER')

    // Update to enable US market with LIVE mode
    await userRepo.updateUniversePreferences('user_us_trader', {
      enableUsMarket: true,
      alpacaTradingMode: 'LIVE',
    })

    const updatedProfile = await userRepo.getUserProfileByUserId('user_us_trader')
    expect(updatedProfile?.enableUsMarket).toBe(true)
    expect(updatedProfile?.alpacaTradingMode).toBe('LIVE')
  })

  it('securely upserts, retrieves, and decrypts user Alpaca credentials', async () => {
    let savedBrokerAccount: any = null

    const mockDb: any = {
      selectFrom: vi.fn().mockImplementation((table: string) => ({
        select: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation((col: string, op: string, val: any) => ({
            where: vi.fn().mockImplementation((col2: string, op2: string, val2: any) => ({
              executeTakeFirst: vi.fn().mockImplementation(async () => savedBrokerAccount),
            })),
          })),
        }),
      })),
      insertInto: vi.fn().mockReturnValue({
        values: vi.fn().mockImplementation((values) => {
          savedBrokerAccount = values
          return {
            execute: vi.fn().mockResolvedValue({}),
          }
        }),
      }),
      updateTable: vi.fn().mockReturnValue({
        set: vi.fn().mockImplementation((updates) => {
          savedBrokerAccount = { ...savedBrokerAccount, ...updates }
          return {
            where: vi.fn().mockReturnValue({
              execute: vi.fn().mockResolvedValue({}),
            }),
          }
        }),
      }),
      deleteFrom: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            executeTakeFirst: vi.fn().mockImplementation(async () => {
              savedBrokerAccount = null
              return { numDeletedRows: 1n }
            }),
          }),
        }),
      }),
    }

    const userRepo = new UserRepository(mockDb)

    // 1. Initial lookup returns null
    const noCreds = await userRepo.getAlpacaCredentials('user_alpaca_1')
    expect(noCreds).toBeNull()

    // 2. Insert new credentials (stored encrypted with AES-256-GCM)
    await userRepo.upsertAlpacaCredentials('user_alpaca_1', {
      apiKey: 'PK_USER_KEY_XYZ',
      secretKey: 'SK_USER_SECRET_ABC',
      paper: true,
    })

    expect(savedBrokerAccount).toBeDefined()
    expect(savedBrokerAccount.brokerName).toBe('alpaca')
    expect(savedBrokerAccount.apiKey).toBe('PK_USER_KEY_XYZ')
    // Secret must NEVER be stored in plain text
    expect(savedBrokerAccount.apiSecretEncrypted).not.toBe('SK_USER_SECRET_ABC')
    expect(savedBrokerAccount.accessToken).toBe('PAPER')

    // 3. Retrieve and verify automatic decryption
    const decryptedCreds = await userRepo.getAlpacaCredentials('user_alpaca_1')
    expect(decryptedCreds).toBeDefined()
    expect(decryptedCreds?.apiKey).toBe('PK_USER_KEY_XYZ')
    expect(decryptedCreds?.secretKey).toBe('SK_USER_SECRET_ABC')
    expect(decryptedCreds?.paper).toBe(true)

    // 4. Update credentials to LIVE mode
    await userRepo.upsertAlpacaCredentials('user_alpaca_1', {
      apiKey: 'AK_LIVE_KEY_999',
      secretKey: 'SK_LIVE_SECRET_888',
      paper: false,
    })

    const liveCreds = await userRepo.getAlpacaCredentials('user_alpaca_1')
    expect(liveCreds?.apiKey).toBe('AK_LIVE_KEY_999')
    expect(liveCreds?.secretKey).toBe('SK_LIVE_SECRET_888')
    expect(liveCreds?.paper).toBe(false)

    // 5. Delete credentials
    const deleted = await userRepo.deleteBrokerAccount('user_alpaca_1', 'alpaca')
    expect(deleted).toBe(true)
    const afterDelete = await userRepo.getAlpacaCredentials('user_alpaca_1')
    expect(afterDelete).toBeNull()
  })
})
