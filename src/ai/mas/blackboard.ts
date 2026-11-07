import type { AIOptionAction, TradingAgentType } from '../types.js'
import type {
  AgentMessage,
  CompactOptionStrikeRow,
  ConflictMatrix,
  MacroBlackboardSlice,
  MacroSpecialistReport,
  OptionsBlackboardSlice,
  OptionsSpecialistReport,
  PreFlightGateSummary,
  StructureBlackboardSlice,
  StructureSpecialistReport,
  TimeframeSummarySlice,
  TradingDomainPolicyConfig,
} from './types.js'
import { DEFAULT_TRADING_DOMAIN_POLICY } from './types.js'
import type { MultiLevelVerifier } from './contracts.js'

function downsampleNumbers(values: readonly number[], maxPoints: number = 15): readonly number[] {
  if (values.length <= maxPoints) return values
  const step = Math.max(1, Math.floor(values.length / maxPoints))
  return values.filter((_, idx) => idx % step === 0 || idx === values.length - 1).slice(0, maxPoints)
}

function toTimeframeSlice(tf: any, fallbackName: string): TimeframeSummarySlice {
  const swings = Array.isArray(tf?.swings) ? tf.swings.slice(-10) : []
  return Object.freeze({
    timeframe: tf?.timeframe || fallbackName,
    price: Number(tf?.price || 0),
    vwap: Number(tf?.vwap || 0),
    vwapPosition: String(tf?.vwapPosition || 'unknown'),
    vwapZScore: Number((tf?.vwapZScore ?? 0).toFixed(3)),
    rsi14: Number(tf?.rsi ?? 50),
    support: Number(tf?.support || 0),
    resistance: Number(tf?.resistance || 0),
    atr14: Number((tf?.atr14 ?? 20).toFixed(2)),
    trend: String(tf?.trend || 'sideways'),
    ema: tf?.ema || {},
    emaSlope: tf?.emaSlope || {},
    adx: tf?.adx,
    wavePhase: tf?.waveContext?.currentPhase,
    wave5Target: tf?.waveContext?.wave5Target,
    fibZones: tf?.waveContext?.fibZones,
    openingRange: tf?.openingRange,
    recentSwingsCount: swings.length,
  })
}

export class BlackboardContextScoper {
  constructor(private readonly policy: TradingDomainPolicyConfig = DEFAULT_TRADING_DOMAIN_POLICY) {}

  /**
   * Computes deterministic, regime-scoped and setup-scoped Pre-Flight Gates (Fix F1).
   * - |vwapZScore| > 2.0 restricts SCALPER mean-reversion entries, NOT TREND Wave 3 breakouts.
   * - Reversal Quality Score < 3 restricts Playbook B (INSTITUTIONAL_TRAP) setups.
   */
  public computePreFlightGates(input: any, activeAgent: TradingAgentType): PreFlightGateSummary {
    const vixCheck = this.checkVixCircuitBreaker(Number(input?.vix?.current ?? 15))
    if (vixCheck) return vixCheck

    const metrics = this.extractGateMetrics(input)
    const perm = this.evaluateGatePermissions(metrics)

    const scalperAllowedActions = this.toActionList(perm.scalperAllowsCe, perm.scalperAllowsPe)
    const trendAllowedActions = this.toActionList(perm.trendAllowsCe, perm.trendAllowsPe)
    const trapAllowedActions = this.toActionList(perm.trapAllowsCe, perm.trapAllowsPe)

    const isWave3 = input?.tf15m?.waveContext?.currentPhase === 'WAVE_3'
    const effectiveActions = activeAgent === 'TREND' || isWave3 ? trendAllowedActions : scalperAllowedActions

    return Object.freeze({
      isBlocked: effectiveActions.length === 1 && effectiveActions[0] === 'NONE',
      blockReasons: this.buildBlockReasons(metrics, perm),
      allowedActions: effectiveActions,
      scalperAllowedActions,
      trendAllowedActions,
      trapAllowedActions,
      reducedSizingMandatory: false,
      cautionNotes: this.buildCautionNotes(metrics.gtiConf, metrics.gtiComposite),
    })
  }

  private checkVixCircuitBreaker(vixCurrent: number): PreFlightGateSummary | null {
    if (vixCurrent <= this.policy.maxVixAllowed) return null
    const noneOnly: readonly AIOptionAction[] = Object.freeze(['NONE'])
    return Object.freeze({
      isBlocked: true,
      blockReasons: [`VIX (${vixCurrent.toFixed(2)}) exceeds circuit breaker (${this.policy.maxVixAllowed})`],
      allowedActions: noneOnly,
      scalperAllowedActions: noneOnly,
      trendAllowedActions: noneOnly,
      trapAllowedActions: noneOnly,
      reducedSizingMandatory: true,
      cautionNotes: [],
    })
  }

  private extractGateMetrics(input: any) {
    const zScore15m = Number(input?.tf15m?.vwapZScore ?? 0)
    const rsi15m = Number(input?.tf15m?.rsi ?? 50)
    const gtiScore = input?.tf15m?.gtiScore || input?.gtiScore
    const gtiConf = Number(gtiScore?.confidence ?? 0)
    const gtiComposite = Number(gtiScore?.composite ?? 0)
    const revBull = Number(input?.reversalScore?.bullish ?? 3)
    const revBear = Number(input?.reversalScore?.bearish ?? 3)
    const rsi5m = Number(input?.tf5m?.rsi ?? 50)
    const isWave5 = input?.tf15m?.waveContext?.currentPhase === 'WAVE_5'

    return { zScore15m, rsi15m, gtiConf, gtiComposite, revBull, revBear, rsi5m, isWave5 }
  }

  private evaluateGatePermissions(metrics: ReturnType<typeof this.extractGateMetrics>) {
    const gtiBlocksCe = metrics.gtiConf > 30 && metrics.gtiComposite < -this.policy.gtiSevereOppositionThreshold
    const gtiBlocksPe = metrics.gtiConf > 30 && metrics.gtiComposite > this.policy.gtiSevereOppositionThreshold

    const scalperAllowsCe = !gtiBlocksCe && metrics.zScore15m <= this.policy.maxScalperVwapZScore
    const scalperAllowsPe = !gtiBlocksPe && metrics.zScore15m >= -this.policy.maxScalperVwapZScore

    const trendBlowoffCe =
      (metrics.zScore15m > this.policy.maxTrendBlowoffVwapZScore && metrics.rsi15m > 80) ||
      metrics.rsi5m > 80 ||
      (metrics.isWave5 && metrics.rsi5m > 70)
    const trendBlowoffPe =
      (metrics.zScore15m < -this.policy.maxTrendBlowoffVwapZScore && metrics.rsi15m < 20) ||
      metrics.rsi5m < 20 ||
      (metrics.isWave5 && metrics.rsi5m < 30)

    const trendAllowsCe = !gtiBlocksCe && !trendBlowoffCe
    const trendAllowsPe = !gtiBlocksPe && !trendBlowoffPe
    const trapAllowsCe =
      metrics.revBull >= this.policy.minTrapReversalScore && metrics.zScore15m <= this.policy.maxScalperVwapZScore
    const trapAllowsPe =
      metrics.revBear >= this.policy.minTrapReversalScore && metrics.zScore15m >= -this.policy.maxScalperVwapZScore

    return {
      gtiBlocksCe,
      gtiBlocksPe,
      scalperAllowsCe,
      scalperAllowsPe,
      trendBlowoffCe,
      trendBlowoffPe,
      trendAllowsCe,
      trendAllowsPe,
      trapAllowsCe,
      trapAllowsPe,
    }
  }

  private buildBlockReasons(
    metrics: ReturnType<typeof this.extractGateMetrics>,
    perm: ReturnType<typeof this.evaluateGatePermissions>
  ): readonly string[] {
    return Object.freeze([
      ...(perm.gtiBlocksCe ? [`GTI composite (${metrics.gtiComposite.toFixed(2)}) severely opposes BUY_CE`] : []),
      ...(perm.gtiBlocksPe ? [`GTI composite (${metrics.gtiComposite.toFixed(2)}) severely opposes BUY_PE`] : []),
      ...(perm.trendBlowoffCe && !perm.gtiBlocksCe
        ? [
            `Trend momentum overheated (5m RSI: ${metrics.rsi5m.toFixed(1)}${metrics.isWave5 ? ', Wave 5' : ''}) blocks BUY_CE until pullback to 5m EMA9/VWAP`,
          ]
        : []),
      ...(perm.trendBlowoffPe && !perm.gtiBlocksPe
        ? [
            `Trend momentum oversold (5m RSI: ${metrics.rsi5m.toFixed(1)}${metrics.isWave5 ? ', Wave 5' : ''}) blocks BUY_PE until bounce to 5m EMA9/VWAP`,
          ]
        : []),
      ...(!perm.scalperAllowsCe && perm.trendAllowsCe
        ? [
            `15m VWAP Z-Score (${metrics.zScore15m.toFixed(2)}) > +2.0 blocks SCALPER BUY_CE (allowed only for TREND/Breakout)`,
          ]
        : []),
      ...(!perm.scalperAllowsPe && perm.trendAllowsPe
        ? [
            `15m VWAP Z-Score (${metrics.zScore15m.toFixed(2)}) < -2.0 blocks SCALPER BUY_PE (allowed only for TREND/Breakout)`,
          ]
        : []),
    ])
  }

  private buildCautionNotes(gtiConf: number, gtiComposite: number): readonly string[] {
    const isMild = gtiConf > 30 && Math.abs(gtiComposite) >= this.policy.gtiMildOppositionThreshold
    return isMild
      ? Object.freeze([`GTI composite (${gtiComposite.toFixed(2)}) requires directional confirmation`])
      : Object.freeze([])
  }

  private toActionList(allowCe: boolean, allowPe: boolean): readonly AIOptionAction[] {
    return Object.freeze([
      ...(allowCe ? (['BUY_CE'] as const) : []),
      ...(allowPe ? (['BUY_PE'] as const) : []),
      'NONE' as const,
    ])
  }

  public buildStructureSlice(input: any): StructureBlackboardSlice {
    const istTime = input?.time || new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })
    const dc = input?.dailyContext
    const vp = dc?.previousDayVolumeProfile

    const rawTicks = Array.isArray(input?.liveContext?.recentTicks)
      ? input.liveContext.recentTicks.map((t: any) => Number(t?.last_price ?? t ?? 0)).filter((n: number) => n > 0)
      : []

    return Object.freeze({
      symbol: String(input?.symbol || 'NIFTY'),
      mode: String(input?.mode || 'intraday'),
      istTime,
      tf1h: toTimeframeSlice(input?.tf1h, '1h'),
      tf30m: toTimeframeSlice(input?.tf30m || input?.tf15m, '30m'),
      tf15m: toTimeframeSlice(input?.tf15m, '15m'),
      tf5m: toTimeframeSlice(input?.tf5m || input?.tf15m, '5m'),
      dailyContext: dc
        ? Object.freeze({
            atr14: Number(dc.atr14 || 20),
            pdh: Number(dc.pdh || 0),
            pdl: Number(dc.pdl || 0),
            pdc: Number(dc.pdc || 0),
            pdr: Number(dc.pdr || 0),
            isCompression: Boolean(dc.isCompression),
            openingRange: dc.openingRange,
            ...(vp
              ? {
                  volumeProfile: {
                    poc: vp.poc,
                    vah: vp.vah,
                    val: vp.val,
                    profileType: vp.profileType,
                  },
                }
              : {}),
          })
        : null,
      reversalScore: Object.freeze({
        bullish: Number(input?.reversalScore?.bullish ?? 0),
        bearish: Number(input?.reversalScore?.bearish ?? 0),
      }),
      ...(input?.liveContext
        ? {
            liveTrigger: Object.freeze({
              reason: String(input.liveContext.reason || 'Live Breakout'),
              lastPrice: Number(input.liveContext.tick?.last_price || input?.tf15m?.price || 0),
              downsampledTicks: downsampleNumbers(rawTicks, 15),
            }),
          }
        : {}),
      omittedContextManifest: Object.freeze([
        'raw_ohlcv_candles_stripped (use timeframe indicators)',
        'swing_points_truncated_to_10 (use inspectWaveAndSwings tool for full list)',
        'options_chain_isolated (handled by OptionsFlowAgent)',
        'previousDecision_stripped_in_stage1_to_prevent_anchoring_bias',
      ]),
    })
  }

  public buildOptionsSlice(input: any): {
    slice: OptionsBlackboardSlice
    compactRows: readonly CompactOptionStrikeRow[]
  } {
    const opt = input?.optionsAnalysisZerodha || input?.optionsAnalysis || {}
    const rawRows: any[] = Array.isArray(opt.rows) ? opt.rows : []
    const compactRows: CompactOptionStrikeRow[] = rawRows.map((r) =>
      Object.freeze({
        strike: Number(r.strike || 0),
        type: (r.type === 'PE' ? 'PE' : 'CE') as 'CE' | 'PE',
        symbol: String(r.symbol || ''),
        ltp: Number(r.ltp || 0),
        oi: Number(r.oi || 0),
        intervalOi: Number(r.intervalOi || 0),
        buildup: String(r.buildup || 'Neutral'),
        delta: Number((r.greeks?.delta ?? 0).toFixed(3)),
        gamma: Number((r.greeks?.gamma ?? 0).toFixed(5)),
        theta: Number((r.greeks?.theta ?? 0).toFixed(2)),
        iv: Number((r.greeks?.iv ?? 0.15).toFixed(4)),
      })
    )

    const atmStrike = Number(opt.atmStrike || 0)
    const focusedRows =
      atmStrike > 0 ? compactRows.filter((r) => Math.abs(r.strike - atmStrike) <= 200) : compactRows.slice(0, 10)

    const shortCoveringStrikes = (opt.windowStats?.topShortCovering || [])
      .filter((r: any) => r.type === 'CE')
      .map((r: any) => Number(r.strike))

    const slice: OptionsBlackboardSlice = Object.freeze({
      symbol: String(input?.symbol || 'NIFTY'),
      spotPrice: Number(input?.tf15m?.price || 0),
      atmStrike,
      pcr: Number(opt.pcr ?? 1),
      pcrAtm: Number(opt.pcrAtm ?? 1),
      pcrChange: opt.pcrChange !== undefined ? Number(opt.pcrChange) : undefined,
      atmNetFlow: opt.atmNetFlow !== undefined ? Number(opt.atmNetFlow) : undefined,
      flowSentiment: opt.flowSentiment ? String(opt.flowSentiment) : undefined,
      shortCoveringStrikes: Object.freeze(shortCoveringStrikes),
      sentiment: String(opt.sentiment || 'neutral'),
      atmSentiment: String(opt.atmSentiment || 'neutral'),
      marketFlow: String(opt.marketFlow || 'NEUTRAL'),
      supportWall: Number(opt.support || 0),
      resistanceWall: Number(opt.resistance || 0),
      ivRank: Number((opt.ivRank ?? 0).toFixed(1)),
      ivPercentile: Number((opt.ivPercentile ?? 0).toFixed(1)),
      daysToExpiry: Number((opt.greeksContext?.daysToExpiry ?? 2).toFixed(2)),
      recommendedBuyStrikeCE: opt.greeksContext?.recommendedBuyStrikeCE,
      recommendedBuyStrikePE: opt.greeksContext?.recommendedBuyStrikePE,
      topShortCovering: (opt.windowStats?.topShortCovering || []).map(
        (r: any) => `${r.strike} ${r.type} (${r.intervalOi})`
      ),
      topLongBuildup: (opt.windowStats?.topLongBuildup || []).map(
        (r: any) => `${r.strike} ${r.type} (+${r.intervalOi})`
      ),
      focusedRows: Object.freeze(focusedRows),
      omittedContextManifest: Object.freeze([
        'distant_strikes_omitted (use inspectOptionStrikeChain tool)',
        'payoff_simulation_available_via_simulateStrikePayoff_tool',
      ]),
    })

    return { slice, compactRows: Object.freeze(compactRows) }
  }

  public buildMacroSlice(input: any): MacroBlackboardSlice {
    const istTime = input?.time || new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })
    return Object.freeze({
      symbol: String(input?.symbol || 'NIFTY'),
      istTime,
      vix: Object.freeze({
        current: Number(input?.vix?.current ?? 15),
        change: Number(input?.vix?.change ?? 0),
        sentiment: String(input?.vix?.sentiment || 'normal'),
      }),
      newsSentiment: input?.sentiment || { sentiment: 'neutral', confidence: 0.5, reason: 'No headlines' },
      gtiScore: input?.tf15m?.gtiScore || input?.gtiScore,
      omittedContextManifest: Object.freeze([
        'technical_chart_isolated (handled by RegimeAndStructureAgent)',
        'options_chain_isolated (handled by OptionsFlowAgent)',
      ]),
    })
  }

  /**
   * B5 (Ch. 6 p. 144): Computes ConflictMatrix with Peer Credence Weighting (CP-WBFT)
   * and explicit missing-perspective attribution if any specialist degraded during fan-out.
   */
  public computeConflictMatrix(params: {
    structureEnvelope?: AgentMessage<StructureSpecialistReport> | undefined
    optionsEnvelope?: AgentMessage<OptionsSpecialistReport> | undefined
    macroEnvelope?: AgentMessage<MacroSpecialistReport> | undefined
    verifier: MultiLevelVerifier
  }): ConflictMatrix {
    const { structureEnvelope, optionsEnvelope, macroEnvelope, verifier } = params

    const missingPerspectives = [
      ...(!structureEnvelope || structureEnvelope.lifecycleState !== 'succeeded'
        ? ['Missing analyses: [RegimeAndStructureAgent] degraded — flag coverage gap']
        : []),
      ...(!optionsEnvelope || optionsEnvelope.lifecycleState !== 'succeeded'
        ? ['Missing analyses: [OptionsFlowAgent] degraded — flag coverage gap']
        : []),
      ...(!macroEnvelope || macroEnvelope.lifecycleState !== 'succeeded'
        ? ['Missing analyses: [MacroSentimentAgent] degraded — flag coverage gap']
        : []),
    ]

    const entries = [
      structureEnvelope
        ? {
            name: 'RegimeAndStructureAgent',
            bias: structureEnvelope.handoff.claim.bias,
            conf: structureEnvelope.handoff.claim.confidence,
            weight: verifier.getPeerCredenceWeight('RegimeAndStructureAgent'),
          }
        : null,
      optionsEnvelope
        ? {
            name: 'OptionsFlowAgent',
            bias: optionsEnvelope.handoff.claim.bias,
            conf: optionsEnvelope.handoff.claim.confidence,
            weight: verifier.getPeerCredenceWeight('OptionsFlowAgent'),
          }
        : null,
      macroEnvelope
        ? {
            name: 'MacroSentimentAgent',
            bias: macroEnvelope.handoff.claim.bias,
            conf: macroEnvelope.handoff.claim.confidence,
            weight: verifier.getPeerCredenceWeight('MacroSentimentAgent'),
          }
        : null,
    ].filter((e): e is NonNullable<typeof e> => e !== null)

    const weightedBullishScore = entries
      .filter((e) => e.bias === 'BULLISH')
      .reduce((sum, e) => sum + (e.conf / 100) * e.weight, 0)
    const weightedBearishScore = entries
      .filter((e) => e.bias === 'BEARISH')
      .reduce((sum, e) => sum + (e.conf / 100) * e.weight, 0)

    const hasBullish = entries.some((e) => e.bias === 'BULLISH')
    const hasBearish = entries.some((e) => e.bias === 'BEARISH')
    const hasDirectConflict = hasBullish && hasBearish

    const conflicts = [
      ...(structureEnvelope &&
      optionsEnvelope &&
      structureEnvelope.handoff.claim.bias !== 'NEUTRAL' &&
      optionsEnvelope.handoff.claim.bias !== 'NEUTRAL' &&
      structureEnvelope.handoff.claim.bias !== optionsEnvelope.handoff.claim.bias
        ? [
            `Structure (${structureEnvelope.handoff.claim.bias}) directly opposes Options Flow (${optionsEnvelope.handoff.claim.bias})`,
          ]
        : []),
      ...(macroEnvelope?.handoff.claim.vetoRecommended
        ? [`MacroSentimentAgent recommended VETO: ${macroEnvelope.handoff.claim.reason}`]
        : []),
    ]

    const highestEntry =
      entries.length > 0
        ? entries.reduce((best, curr) => (curr.conf * curr.weight > best.conf * best.weight ? curr : best))
        : { name: 'None' }

    const unanimousDirection =
      entries.length >= 2 && entries.every((e) => e.bias === 'BULLISH')
        ? 'BULLISH'
        : entries.length >= 2 && entries.every((e) => e.bias === 'BEARISH')
          ? 'BEARISH'
          : 'NONE'

    return Object.freeze({
      unanimousDirection,
      hasDirectConflict,
      conflicts: Object.freeze(conflicts),
      missingPerspectives: Object.freeze(missingPerspectives),
      weightedBullishScore: Number(weightedBullishScore.toFixed(3)),
      weightedBearishScore: Number(weightedBearishScore.toFixed(3)),
      highestConvictionAgent: highestEntry.name,
    })
  }
}
