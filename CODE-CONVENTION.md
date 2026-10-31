# Code Conventions

General code conventions for writing clean, readable, and testable TypeScript code. These conventions apply across all modules in the codebase.

---

## Functions and Methods

### Keep small and focused

Functions and methods should do one thing and do it well. Aim for fewer than 10 statements. If you feel the urge to write a comment above a group of statements to explain what they do together, extract those statements into a named private method or standalone function instead. A comment above a single expression or chained pipeline is fine.

### One level of abstraction per method

Mixing high-level orchestration with low-level detail in the same method makes code hard to follow. Each method should operate at a single level.

### Flat Code and Early Returns

Keep the happy path at the top level of the method. Return early for edge cases and guard conditions so the main logic is never indented inside an `if` block.

**❌ Avoid:**

```typescript
public async evaluate(request: QueryRequest): Promise<QueryResponse> {
  const oceanLegs = request.servicePlanLegs.filter(leg => isOceanTransportMode(leg.transportMode))
  const { vesselLegs, messages } = await this.segmentToLegService.toVesselLegs(oceanLegs)

  if (vesselLegs.length > 0) {
    const leadServices = await this.leadService.findByVesselLegs(vesselLegs)

    const firstVesselLeg = getFirstPortOfLoadVesselLeg(vesselLegs, oceanLegs)
    const lastVesselLeg = getLastPortOfDischargeVesselLeg(vesselLegs, oceanLegs)
    const results = await Promise.all([
      this.checkHardStop(firstVesselLeg, request, leadServices, 'FirstPortOfLoad'),
      this.checkHardStop(lastVesselLeg, request, leadServices, 'LastPortOfDischarge'),
    ])

    return this.toQueryResponse(results, messages)
  } else {
    return { equipmentAvailability: 'AVAILABLE', rejectedLegs: [], messages }
  }
}
```

**✅ Prefer:**

```typescript
public async evaluate(request: QueryRequest): Promise<QueryResponse> {
  const oceanLegs = request.servicePlanLegs.filter(leg => isOceanTransportMode(leg.transportMode))
  const { vesselLegs, messages } = await this.segmentToLegService.toVesselLegs(oceanLegs)

  if (vesselLegs.length === 0) {
    return { equipmentAvailability: 'AVAILABLE', rejectedLegs: [], messages }
  }

  const leadRoutes = await this.leadRouteService.findByVesselLegs(vesselLegs)

  const firstVesselLeg = getFirstVesselLeg(vesselLegs, oceanLegs)
  const lastVesselLeg = getLastDischargeVesselLeg(vesselLegs, oceanLegs)
  const results = await Promise.all([
    this.checkHardStop(firstVesselLeg, request, leadRoutes, 'FirstLoad'),
    this.checkHardStop(lastVesselLeg, request, leadRoutes, 'LastDischarge'),
  ])

  return this.toQueryResponse(results, messages)
}
```

### Avoid Boolean Parameters

A boolean parameter is a flag that makes a method do two things. Split it into two methods instead.

**❌ Avoid:**

```typescript
private checkHardStop(vesselLeg: VesselLeg, isDeparture: boolean): Promise<Result>
```

**✅ Prefer:**

```typescript
private checkDepartureHardStop(vesselLeg: VesselLeg): Promise<Result>
private checkArrivalHardStop(vesselLeg: VesselLeg): Promise<Result>
```

### Avoid Imperative Loops and Mutations

Prefer declarative array methods over imperative loops. Avoid `for`, `forEach`, `while`, and `push` in favour of `map`, `filter`, `reduce`, `flatMap`, `find`, `some`, and `every`.

**❌ Avoid:**

```typescript
const results: string[] = []
for (const item of items) {
  if (item.active) {
    results.push(item.label)
  }
}
```

**✅ Prefer:**

```typescript
const results = items.filter((item) => item.active).map((item) => item.label)
```

**❌ Avoid:**

```typescript
let total = 0
for (const item of items) {
  total += item.price
}
```

**✅ Prefer:**

```typescript
const total = items.reduce((sum, item) => sum + item.price, 0)
```

---

## Classes vs Standalone Functions

### Use `class` by default

A `class` is the default choice for any named component. This includes anything with a clear domain identity or responsibility — services, repositories, controllers, handlers, mappers — regardless of whether it currently has dependencies or state. Classes are easier to extend with dependencies later and signal that the unit is a first-class domain concept.

```typescript
export class TradeMapper {
  public toTrades(trades: TradesEntity[]): Trade[] {
    return trades.map((trade) => this.toTrade(trade))
  }

  private toTrade(trade: TradeEntity): Trade {
    // ...
  }
}
```

### Standalone functions for pure utilities

Use a standalone function only when the logic has no domain identity — it is purely algorithmic, stateless, and not conceptually owned by any specific type or module. Formatting, parsing, and mathematical helpers are typical examples.

```typescript
export function stringifyPortcall(portcall: Portcall): string {
  return `service ${portcall.departureServiceCode}-${portcall.departureServiceDirection}, ...`
}
```

### Use concrete class types in constructor parameters

Inject concrete class types as constructor parameters — do not extract interfaces solely for decoupling. Interfaces add indirection and maintenance overhead that is not justified in our projects.

```typescript
// ✅ Prefer
constructor(private readonly service: FeatureChangeLogService) {}

// ❌ Avoid
constructor(private readonly service: IFeatureChangeLogService) {}
```

---

## Conditionals

### Value-producing branches — use ternary or logical operators

When both branches exist only to produce a value, replace `if/else` with a ternary or logical operator.

**❌ Avoid:**

```typescript
let label: string
if (item.active) {
  label = item.name
} else {
  label = 'unknown'
}
```

**✅ Prefer:**

```typescript
const label = item.active ? item.name : 'unknown'
```

**✅ Prefer logical operators for defaults:**

```typescript
const label = item.name ?? 'unknown'
const isValid = item.active && item.verified
```

### Guard clauses — bare `if` with early return

Use a bare `if` (no `else` branch) for guard clauses: preconditions that exit early before the main logic. This keeps the happy path at the outermost indentation level.

```typescript
if (!event.headers) {
  return
}

if (!customer) {
  throw new Error('Customer not found')
}
```

### Two equally weighted outcomes — `if/else` is fine

When both branches carry out a meaningful side effect and neither is a guard or edge case, `if/else` communicates the mutual exclusivity clearly and should be kept.

```typescript
// ✅ Both branches are deliberate outcomes — if/else is the right tool
if (attempt < this.maxRetries) {
  await this.delay(attempt)
  await this.retryHandler(payload, attempt + 1)
} else {
  await this.deadLetterQueueSink.sendToDeadLetterQueue(payload)
}
```

Converting this pattern to an early return would make the `sendToDeadLetterQueue` call look like fallthrough cleanup rather than an intentional final action.

---

## Dependency Injection

Use **[typed-inject](https://github.com/nicojs/typed-inject)** for dependency injection. Declare dependencies via a `static readonly inject` tuple on the class. The tuple values must match the token names registered on the injector.

```typescript
export class TradeAnalysisService {
  public static readonly inject = ['tradeAnalysisRepository'] as const

  constructor(private readonly equipmentHardStopRepository: TradeAnalysisRepository) {}
}
```

- Always declare dependencies through the constructor — never reference a module-level singleton directly inside a class.
- The `inject` tuple enforces type-safe token resolution at compile time; do not bypass it by accessing the injector directly.
- Prefer narrow interfaces over concrete class types in constructor parameters to keep units decoupled and easier to mock in tests.

---

## Testability

- Every class should be testable in isolation by injecting mock dependencies through the constructor.
- Standalone utility functions should be testable without any setup or mocking.
- Avoid coupling logic to global state, module-level singletons, or hard-coded imports of concrete implementations.
- Write code so that the arrange/act/assert structure of a unit test is obvious and requires minimal setup.

## Database Migration Scripts

### Prefer query-builder APIs over raw SQL

Use capabilities from the adopted database framework first, such as Kysely or Knex, instead of handwritten SQL strings. This keeps queries type-safe, easier to refactor, and more consistent with the rest of the codebase.

**❌ Avoid:**

```typescript
await sql`UPDATE marketanalysis.orders SET status = 'ACTIVE'`.execute(db)
```

Prefer

**✅ Prefer:**

```typescript
await db.withSchema('marketanalysis').updateTable('orders').set({ status: 'ACTIVE' }).execute()
```

**Exception**

Use raw SQL only when the framework does not support the required operation or would make the query significantly less clear. In those cases, keep the raw SQL minimal and add a short comment explaining why framework APIs were not used.
