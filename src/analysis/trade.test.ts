import { describe, it, expect, vi } from 'vitest'
import { runAnalysis } from './trade.js'
import * as yahoo from '../data/yahoo.js'
import { LLMService } from '../ai/llm.js'
import * as news from '../data/news.js'
import * as vix from '../data/vix.js'
import * as kiteOptions from '../data/kite-options.js'
import * as kiteHistorical from '../data/kite-historical.js'

vi.mock('../data/yahoo.js')
vi.mock('../ai/llm.js')
vi.mock('../data/news.js')
vi.mock('../data/vix.js')
vi.mock('../data/kite-options.js')
vi.mock('../data/kite-historical.js')
vi.mock('./sentiment.js', () => ({
  analyzeSentiment: vi.fn(() => Promise.resolve({ sentiment: 'positive', confidence: 0.8, reason: 'test' }))
}))
vi.mock('./kite-options.js', () => ({
  analyzeOptions: vi.fn(() => ({}))
}))

describe('runAnalysis', () => {
  it('should orchestrate multi-timeframe analysis correctly', async () => {
    // Setup mocks
    const mockCandle = { time: 1, open: 100, high: 110, low: 90, close: 105, volume: 1000 };
    vi.mocked(yahoo.getMultiTimeframeCandles).mockResolvedValue({
      candles1d: Array(20).fill(mockCandle),
      candles1h: [mockCandle],
      candles15m: [mockCandle],
      candles3m: [mockCandle]
    });
    vi.mocked(news.getNews).mockResolvedValue([]);
    vi.mocked(vix.getIndiaVix).mockResolvedValue({ current: 15, change: 0, sentiment: 'normal' });
    vi.mocked(kiteOptions.getOptionChain).mockResolvedValue({ quotes: {}, finalOptions: [] });
    vi.mocked(LLMService.prototype.analyzeWithAI).mockResolvedValue({
      decision: 'BUY',
      reason: 'test',
      confidence: 0.9,
      entry: 100,
      stopLoss: 90,
      targets: [120]
    });

    const result = await runAnalysis('NIFTY', 'intraday');

    expect(result.tf1h).toBeDefined();
    expect(result.tf15m).toBeDefined();
    expect(result.tf3m).toBeDefined();
    expect(result.aiDecision.decision).toBe('BUY');
    expect(LLMService.prototype.analyzeWithAI).toHaveBeenCalledWith(expect.objectContaining({
      tf1h: expect.any(Object),
      tf15m: expect.any(Object),
      tf3m: expect.any(Object),
    }));
  })
})
