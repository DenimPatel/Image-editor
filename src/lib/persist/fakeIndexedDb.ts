/**
 * Test double for IndexedDB.
 *
 * jsdom ships no IndexedDB and the repo has no `fake-indexeddb` dependency, so
 * this is the smallest surface `idb` and `persist/session.ts` actually touch:
 * open/upgrade, transactions over one or more stores, and
 * put/get/delete/getAllKeys. `idb` reaches these through `addEventListener` and
 * `instanceof IDBTransaction`-style checks, so the classes below are installed
 * as globals rather than faked with plain objects.
 *
 * Records are stored by reference instead of structured-cloned. Every migration
 * in this repo builds fresh objects, so no test depends on the clone.
 */

type Listener = (event: Event) => void

class Emitter {
  private readonly listeners = new Map<string, Set<Listener>>()

  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>()
    set.add(listener)
    this.listeners.set(type, set)
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener)
  }

  emit(type: string): void {
    const event = { type } as unknown as Event
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event)
  }
}

export type StoreName = string

type StoreNames = string[] & { contains: (name: string) => boolean }

function withContains(names: string[]): StoreNames {
  const list = names.slice() as StoreNames
  list.contains = (name) => list.includes(name)
  return list
}

export class FakeIDBRequest extends Emitter {
  result: unknown = undefined
  error: DOMException | null = null
  source: FakeIDBObjectStore | null = null
  transaction: FakeIDBTransaction | null = null
  settled = false
}

export class FakeIDBObjectStore {
  constructor(
    private readonly db: FakeIDBDatabase,
    readonly name: StoreName,
    readonly transaction: FakeIDBTransaction,
  ) {}

  get keyPath(): string {
    return this.db.keyPaths.get(this.name) ?? 'id'
  }

  put(value: unknown, key?: IDBValidKey): FakeIDBRequest {
    const record = (value ?? {}) as Record<string, unknown>
    const id = String(key ?? record[this.keyPath] ?? '')
    return this.request(() => {
      this.db.failNextWrite(this.name)
      if (id === '' || id === 'undefined') throw new DOMException('no key', 'DataError')
      const buffer = this.transaction.stage(this.name)
      buffer.rows.set(id, value)
      buffer.keys.add(id)
      return id
    })
  }

  get(key: IDBValidKey): FakeIDBRequest {
    return this.request(() => this.transaction.view(this.name).rows.get(String(key)))
  }

  getAll(): FakeIDBRequest {
    return this.request(() => [...this.transaction.view(this.name).rows.values()])
  }

  getAllKeys(): FakeIDBRequest {
    return this.request(() => [...this.transaction.view(this.name).keys])
  }

  count(): FakeIDBRequest {
    return this.request(() => this.transaction.view(this.name).rows.size)
  }

  delete(key: IDBValidKey): FakeIDBRequest {
    return this.request(() => {
      const buffer = this.transaction.stage(this.name)
      buffer.rows.delete(String(key))
      buffer.keys.delete(String(key))
      return undefined
    })
  }

  clear(): FakeIDBRequest {
    return this.request(() => {
      const buffer = this.transaction.stage(this.name)
      buffer.rows.clear()
      buffer.keys.clear()
      return undefined
    })
  }

  private request(run: () => unknown): FakeIDBRequest {
    const request = new FakeIDBRequest()
    request.source = this
    request.transaction = this.transaction
    this.transaction.track(request, run)
    return request
  }
}

/** Present so `idb`'s `instanceof IDBIndex` / `IDBCursor` probes do not throw. */
export class FakeIDBIndex {}
export class FakeIDBCursor {}

export class FakeIDBTransaction extends Emitter {
  error: DOMException | null = null
  private readonly inFlight = new Set<FakeIDBRequest>()
  /**
   * A readwrite transaction is all-or-nothing, so its writes are staged here and
   * applied to the database on `complete`. Without this, a request that ran
   * before its sibling threw stayed applied — and a test asserting that a
   * quota-exceeded save leaves the previous session alone would have been
   * asserting the fake's infidelity rather than the store's behaviour.
   */
  private readonly staged = new Map<StoreName, { rows: Map<string, unknown>; keys: Set<string> }>()
  private finished = false

  constructor(
    readonly db: FakeIDBDatabase,
    readonly names: StoreNames,
    readonly mode: string,
  ) {
    super()
  }

  get objectStoreNames(): StoreNames {
    return withContains(this.names)
  }

  objectStore(name: StoreName): FakeIDBObjectStore {
    return new FakeIDBObjectStore(this.db, name, this)
  }

  /** The rows and keys a request in this transaction can see, staged or not. */
  view(name: StoreName): { rows: Map<string, unknown>; keys: Set<string> } {
    return this.staged.get(name) ?? { rows: this.db.rows(name), keys: this.db.keys(name) }
  }

  /** The write buffer for `name`, seeded from what the database holds now. */
  stage(name: StoreName): { rows: Map<string, unknown>; keys: Set<string> } {
    let buffer = this.staged.get(name)
    if (!buffer) {
      buffer = { rows: new Map(this.db.rows(name)), keys: new Set(this.db.keys(name)) }
      this.staged.set(name, buffer)
    }
    return buffer
  }

  /**
   * Run one store operation on a later microtask, then settle the transaction
   * once its last request is done — or abort it, failing every sibling request
   * the way a real transaction does.
   */
  track(request: FakeIDBRequest, run: () => unknown): void {
    this.inFlight.add(request)
    queueMicrotask(() => {
      if (request.settled) return
      if (this.finished) {
        this.abort(new DOMException('transaction is no longer active', 'TransactionInactiveError'))
        return
      }
      try {
        request.result = run()
      } catch (error) {
        this.abort(
          error instanceof DOMException ? error : new DOMException('write failed', 'UnknownError'),
        )
        return
      }
      request.settled = true
      this.inFlight.delete(request)
      request.emit('success')
      if (this.inFlight.size > 0) return
      this.finished = true
      this.commit()
      this.emit('complete')
    })
  }

  private commit(): void {
    for (const [name, buffer] of this.staged) this.db.commit(name, buffer.rows, buffer.keys)
    this.staged.clear()
  }

  private abort(error: DOMException): void {
    this.finished = true
    this.error = error
    for (const request of this.inFlight) {
      request.settled = true
      request.error = error
      this.inFlight.delete(request)
      request.emit('error')
    }
    // Staged writes are dropped: an aborted transaction leaves the database
    // exactly as it found it.
    this.staged.clear()
    this.emit('abort')
  }
}

export class FakeIDBDatabase extends Emitter {
  version: number
  readonly keyPaths = new Map<StoreName, string>()
  private readonly tables = new Map<StoreName, Map<string, unknown>>()
  private readonly ids = new Map<StoreName, Set<string>>()

  constructor(
    readonly name: string,
    version: number,
    /** `${store}:${errorName}` of the write that should fail next. */
    readonly pendingWriteFailures: string[],
  ) {
    super()
    this.version = version
  }

  rows(store: StoreName): Map<string, unknown> {
    return this.tables.get(store) ?? new Map<string, unknown>()
  }

  keys(store: StoreName): Set<string> {
    return this.ids.get(store) ?? new Set<string>()
  }

  /** Apply a completed transaction's staged writes. */
  commit(store: StoreName, rows: Map<string, unknown>, keys: Set<string>): void {
    this.tables.set(store, rows)
    this.ids.set(store, keys)
  }

  get objectStoreNames(): StoreNames {
    return withContains([...this.tables.keys()])
  }

  failNextWrite(store: StoreName): void {
    const index = this.pendingWriteFailures.findIndex((entry) => entry.startsWith(`${store}:`))
    if (index === -1) return
    const name = this.pendingWriteFailures.splice(index, 1)[0].slice(store.length + 1)
    throw new DOMException(`${name} while writing ${store}`, name)
  }

  createObjectStore(name: StoreName, options: { keyPath?: string } = {}): FakeIDBObjectStore {
    this.tables.set(name, new Map())
    this.ids.set(name, new Set())
    this.keyPaths.set(name, options.keyPath ?? 'id')
    return new FakeIDBObjectStore(
      this,
      name,
      new FakeIDBTransaction(this, withContains([]), 'versionchange'),
    )
  }

  deleteObjectStore(name: StoreName): void {
    this.tables.delete(name)
    this.ids.delete(name)
  }

  transaction(names: StoreName | StoreName[], mode = 'readonly'): FakeIDBTransaction {
    const list = typeof names === 'string' ? [names] : names
    for (const name of list) {
      if (!this.tables.has(name)) throw new DOMException(`no store ${name}`, 'NotFoundError')
    }
    return new FakeIDBTransaction(this, withContains(list), mode)
  }
}

export class FakeIDBFactory {
  private readonly databases = new Map<string, FakeIDBDatabase>()
  readonly openFailures: string[] = []
  /** Shared with every database this factory creates, so a failure can be armed before the first open. */
  readonly pendingWriteFailures: string[] = []
  lastOpened: FakeIDBDatabase | null = null

  open(name: string, version = 1): FakeIDBRequest {
    const request = new FakeIDBRequest()
    queueMicrotask(() => {
      const failure = this.openFailures.shift()
      if (failure) {
        request.error = new DOMException(failure, 'SecurityError')
        request.emit('error')
        return
      }
      const existing = this.databases.get(name)
      if (existing && existing.version >= version) {
        this.lastOpened = existing
        request.result = existing
        request.emit('success')
        return
      }
      const db = existing ?? new FakeIDBDatabase(name, 0, this.pendingWriteFailures)
      db.version = version
      this.databases.set(name, db)
      this.lastOpened = db
      request.result = db
      request.transaction = new FakeIDBTransaction(db, withContains([]), 'versionchange')
      request.emit('upgradeneeded')
      request.emit('success')
    })
    return request
  }

  deleteDatabase(name: string): FakeIDBRequest {
    const request = new FakeIDBRequest()
    queueMicrotask(() => {
      this.databases.delete(name)
      request.emit('success')
    })
    return request
  }
}

export type FakeIndexedDb = {
  factory: IDBFactory
  /** Keys currently stored in a store, so a test can assert GC behaviour. */
  keys: (store: string) => string[]
  read: <T>(store: string, key: string) => T | undefined
  /**
   * Put a row directly, the way a build from before the current schema would
   * have left it. Going through the real store's own writer would migrate the
   * shape first, which is exactly what a legacy-row test must not do.
   */
  write: (store: string, key: string, row: unknown) => void
  /** Make the next write to `store` fail the way a full disk does. */
  failNextWrite: (store: string, errorName: string) => void
  /** Make the next `indexedDB.open` fail, as Safari private mode does. */
  failNextOpen: (message: string) => void
}

const GLOBALS = [
  'IDBDatabase',
  'IDBObjectStore',
  'IDBIndex',
  'IDBCursor',
  'IDBTransaction',
  'IDBRequest',
] as const

const CONSTRUCTORS: Record<(typeof GLOBALS)[number], unknown> = {
  IDBDatabase: FakeIDBDatabase,
  IDBObjectStore: FakeIDBObjectStore,
  IDBIndex: FakeIDBIndex,
  IDBCursor: FakeIDBCursor,
  IDBTransaction: FakeIDBTransaction,
  IDBRequest: FakeIDBRequest,
}

/**
 * Install a fresh fake on `globalThis.indexedDB` — plus the global classes `idb`
 * probes with `instanceof` — and return handles for driving failures and
 * inspecting what was written.
 */
export function installFakeIndexedDb(): FakeIndexedDb {
  const factory = new FakeIDBFactory()
  const globals = globalThis as unknown as Record<string, unknown>
  globals.indexedDB = factory
  for (const name of GLOBALS) globals[name] = CONSTRUCTORS[name]
  return {
    factory: factory as unknown as IDBFactory,
    keys: (store) => {
      const db = factory.lastOpened
      return db ? [...db.keys(store)] : []
    },
    read: <T>(store: string, key: string) => {
      const db = factory.lastOpened
      return db ? (db.rows(store).get(key) as T | undefined) : undefined
    },
    write: (store: string, key: string, row: unknown) => {
      const db = factory.lastOpened
      if (!db) throw new Error('no database opened')
      const rows = db.rows(store) as Map<string, unknown>
      rows.set(key, row)
      db.keys(store).add(key)
    },
    failNextWrite: (store, errorName) => {
      factory.pendingWriteFailures.push(`${store}:${errorName}`)
    },
    failNextOpen: (message) => {
      factory.openFailures.push(message)
    },
  }
}
