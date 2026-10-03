/**
 * A small GLSL ES 3.00 interpreter: enough of the language to *execute* the
 * fragment shaders in `src/gl/shaders/index.ts` on the CPU.
 *
 * Why this exists. D3-F17 asks for a test that the GL pipeline and the Canvas2D
 * pipeline agree within 2/255, and D3-F10 asks for a parity harness between the
 * two backends. Both are claims about two implementations of the same maths, so
 * a second hand-written copy of the shaders proves nothing: it drifts the moment
 * a constant is edited. Evaluating the *actual shader source* makes the claim
 * self-enforcing — change a constant in `EFFECTS_FRAG` and the parity test
 * fails instead of quietly diverging.
 *
 * This is a test-only tool; nothing in `src/gl` or `src/render` imports it. The
 * supported subset is deliberately small (no `#ifdef`, no structs, no
 * derivative functions) and anything outside it throws rather than being
 * silently mis-evaluated, so a shader that grows an unsupported construct fails
 * loudly.
 *
 * Value model, chosen so nothing has to be `any`:
 *   - `number`      a float or an int (GLSL ES 3.00 needs no distinction here)
 *   - `boolean`     a bool
 *   - `number[]`    a vector: `number[2]` = vec2, `number[4]` = vec4
 *   - `number[][]`  an array of vectors: `const vec2 dirs[8]`, a `mat3`
 */

export type GlslValue = number | boolean | number[] | number[][] | GlslSamplerRef

/** Samples a texture the way a LINEAR, CLAMP_TO_EDGE sampler does. */
export type GlslSampler = (uv: number[]) => number[]

/**
 * A sampler bound to a name. `CURVES_FRAG` takes its LUTs as function
 * *parameters* (`float curve(sampler2D lut, float v)`), so a lookup by
 * identifier alone would resolve every curve to whichever sampler happened to
 * be called `lut`; binding the sampler to the value and reading it back from
 * there follows the argument the way the driver does.
 */
export type GlslSamplerRef = { readonly sample: GlslSampler }

export type GlslEnv = {
  /** Every `uniform` the shader declares, already bound by name. */
  uniforms?: Record<string, GlslValue>
  /** Samplers keyed by the name the shader uses, which is not always `u_`-prefixed. */
  samplers?: Record<string, GlslSampler>
  /** `gl_FragCoord.xy` for the pixel being evaluated. */
  fragCoord: [number, number]
  /** `v_uv` for the pixel being evaluated. */
  vUv: [number, number]
  fragZ?: number
  fragW?: number
}

export class GlslError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GlslError'
  }
}

// --- lexer --------------------------------------------------------------------

type Token = { kind: 'number' | 'name' | 'op'; text: string }

const OPERATORS = [
  '++',
  '--',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '<<=',
  '>>=',
  '&&',
  '||',
  '==',
  '!=',
  '<=',
  '>=',
  '<<',
  '>>',
  '+',
  '-',
  '*',
  '/',
  '%',
  '<',
  '>',
  '=',
  '!',
  '?',
  ':',
  ';',
  ',',
  '(',
  ')',
  '{',
  '}',
  '[',
  ']',
  '.',
]

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < source.length) {
    const ch = source[i]!
    if (ch === '#' || (ch === '/' && source[i + 1] === '/')) {
      while (i < source.length && source[i] !== '\n') i += 1
      continue
    }
    if (ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r') {
      i += 1
      continue
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(source[i + 1] ?? ''))) {
      const match = /^(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?[fFuU]?/.exec(source.slice(i))
      if (!match) throw new GlslError(`bad number at offset ${i}`)
      tokens.push({ kind: 'number', text: match[0].replace(/[fFuU]$/, '') })
      i += match[0].length
      continue
    }
    if (/[A-Za-z_]/.test(ch)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i))
      if (!match) throw new GlslError(`bad name at offset ${i}`)
      tokens.push({ kind: 'name', text: match[0] })
      i += match[0].length
      continue
    }
    const op = OPERATORS.find((candidate) => source.startsWith(candidate, i))
    if (!op) throw new GlslError(`unsupported character ${JSON.stringify(ch)} at offset ${i}`)
    tokens.push({ kind: 'op', text: op })
    i += op.length
  }
  return tokens
}

// --- syntax -------------------------------------------------------------------

type Expr =
  | { t: 'literal'; value: number | boolean }
  | { t: 'name'; name: string }
  | { t: 'index'; target: Expr; index: Expr }
  | { t: 'swizzle'; target: Expr; components: string }
  | { t: 'call'; callee: string; args: Expr[] }
  | { t: 'unary'; op: string; arg: Expr }
  | { t: 'binary'; op: string; left: Expr; right: Expr }
  | { t: 'assign'; op: string; target: Expr; value: Expr }
  | { t: 'ternary'; condition: Expr; whenTrue: Expr; whenFalse: Expr }
  | { t: 'increment'; target: Expr; delta: 1 | -1; prefix: boolean }

type Stmt =
  | { t: 'expression'; expr: Expr }
  | {
      t: 'declaration'
      isConst: boolean
      typeName: string
      name: string
      arraySize: Expr | null
      init: Expr | null
    }
  | { t: 'block'; body: Stmt[] }
  | { t: 'if'; condition: Expr; then: Stmt; otherwise: Stmt | null }
  | { t: 'for'; init: Stmt | null; condition: Expr | null; step: Expr | null; body: Stmt }
  | { t: 'return'; expr: Expr | null }
  | { t: 'function'; name: string; params: string[]; body: Stmt[] }

const COMPONENTS: Record<string, number> = { x: 0, r: 0, y: 1, g: 1, z: 2, b: 2, w: 3, a: 3 }

const VECTOR_ARITY: Record<string, number> = {
  float: 1,
  int: 1,
  uint: 1,
  bool: 1,
  vec2: 2,
  vec3: 3,
  vec4: 4,
  ivec2: 2,
  ivec3: 3,
  ivec4: 4,
  bvec2: 2,
  bvec3: 3,
  bvec4: 4,
}

/** Types a declaration or a parameter list can start with. */
const DECLARATION_TYPES = new Set([...Object.keys(VECTOR_ARITY), 'void', 'sampler2D'])

class Parser {
  private index = 0

  constructor(private readonly tokens: Token[]) {}

  parseProgram(): Stmt[] {
    const body: Stmt[] = []
    while (!this.done()) body.push(this.parseStatement())
    return body
  }

  private done(): boolean {
    return this.index >= this.tokens.length
  }

  private peek(offset = 0): Token | undefined {
    return this.tokens[this.index + offset]
  }

  private next(): Token {
    const token = this.tokens[this.index]
    if (!token) throw new GlslError('unexpected end of shader')
    this.index += 1
    return token
  }

  private at(text: string): boolean {
    return this.peek()?.text === text
  }

  private eat(text: string): boolean {
    if (!this.at(text)) return false
    this.index += 1
    return true
  }

  private expect(text: string): Token {
    if (!this.at(text)) {
      throw new GlslError(`expected ${text} but found ${this.peek()?.text ?? '<end of shader>'}`)
    }
    return this.next()
  }

  private name(): string {
    const token = this.next()
    if (token.kind !== 'name') throw new GlslError(`expected a name but found ${token.text}`)
    return token.text
  }

  private isType(candidate: string | undefined): boolean {
    return candidate !== undefined && DECLARATION_TYPES.has(candidate)
  }

  parseStatement(): Stmt {
    if (this.at('{')) return this.parseBlock()
    if (this.at('if')) return this.parseIf()
    if (this.at('for')) return this.parseFor()
    if (this.at('return')) {
      this.next()
      const expr = this.at(';') ? null : this.parseExpression()
      this.expect(';')
      return { t: 'return', expr }
    }
    if (this.eat(';')) return { t: 'block', body: [] }

    const declaration = this.tryParseDeclaration()
    if (declaration) return declaration

    const expr = this.parseExpression()
    this.expect(';')
    return { t: 'expression', expr }
  }

  /**
   * `precision`/`uniform`/`in`/`out` lines are dropped; everything else kept.
   * `consumeSemicolon` is false for a `for` header, which supplies its own.
   */
  private tryParseDeclaration(consumeSemicolon = true): Stmt | null {
    const start = this.index
    if (this.peek()?.kind !== 'name') return null
    const first = this.peek()?.text ?? ''

    if (['precision', 'uniform', 'in', 'out', 'flat', 'smooth', 'layout'].includes(first)) {
      while (!this.done() && !this.at(';')) this.next()
      this.expect(';')
      return { t: 'block', body: [] }
    }

    let isConst = false
    if (first === 'const') {
      isConst = true
      this.next()
    }
    if (!this.isType(this.peek()?.text)) {
      this.index = start
      return null
    }
    const typeName = this.name()

    // `type name ( params ) {` is a function definition, not a variable.
    if (this.peek()?.kind === 'name' && this.peek(1)?.text === '(') {
      const functionName = this.name()
      this.expect('(')
      const params: string[] = []
      while (!this.at(')')) {
        this.name()
        while (this.eat('[') || this.at(',')) this.next()
        params.push(this.name())
        if (!this.eat(',')) break
      }
      this.expect(')')
      const block = this.parseBlock()
      return {
        t: 'function',
        name: functionName,
        params,
        body: block.t === 'block' ? block.body : [],
      }
    }

    const variable = this.name()
    let arraySize: Expr | null = null
    if (this.eat('[')) {
      arraySize = this.parseExpression()
      this.expect(']')
    }
    const init = this.eat('=') ? this.parseExpression() : null
    if (consumeSemicolon) this.expect(';')
    return { t: 'declaration', isConst, typeName, name: variable, arraySize, init }
  }

  private parseBlock(): Stmt {
    this.expect('{')
    const body: Stmt[] = []
    while (!this.at('}')) {
      if (this.done()) throw new GlslError('unbalanced {')
      body.push(this.parseStatement())
    }
    this.expect('}')
    return { t: 'block', body }
  }

  private parseIf(): Stmt {
    this.expect('if')
    this.expect('(')
    const condition = this.parseExpression()
    this.expect(')')
    const then = this.parseStatement()
    const otherwise = this.eat('else') ? this.parseStatement() : null
    return { t: 'if', condition, then, otherwise }
  }

  private parseFor(): Stmt {
    this.expect('for')
    this.expect('(')
    let init: Stmt | null = null
    if (!this.at(';')) {
      init = this.tryParseDeclaration(false)
      if (!init) init = { t: 'expression', expr: this.parseExpression() }
    }
    this.expect(';')
    const condition = this.at(';') ? null : this.parseExpression()
    this.expect(';')
    const step = this.at(')') ? null : this.parseExpression()
    this.expect(')')
    return { t: 'for', init, condition, step, body: this.parseStatement() }
  }

  parseExpression(): Expr {
    return this.parseAssignment()
  }

  private parseAssignment(): Expr {
    const left = this.parseTernary()
    const token = this.peek()
    if (token && token.kind === 'op' && ['=', '+=', '-=', '*=', '/=', '%='].includes(token.text)) {
      this.next()
      return { t: 'assign', op: token.text, target: left, value: this.parseAssignment() }
    }
    return left
  }

  private parseTernary(): Expr {
    const condition = this.parseBinary(0)
    if (!this.eat('?')) return condition
    const whenTrue = this.parseAssignment()
    this.expect(':')
    return { t: 'ternary', condition, whenTrue, whenFalse: this.parseAssignment() }
  }

  private static readonly PRECEDENCE: Record<string, number> = {
    '||': 1,
    '&&': 2,
    '==': 3,
    '!=': 3,
    '<': 4,
    '>': 4,
    '<=': 4,
    '>=': 4,
    '+': 5,
    '-': 5,
    '*': 6,
    '/': 6,
    '%': 6,
  }

  private parseBinary(minPrecedence: number): Expr {
    let left = this.parseUnary()
    for (;;) {
      const token = this.peek()
      if (!token || token.kind !== 'op') return left
      const precedence = Parser.PRECEDENCE[token.text]
      if (precedence === undefined || precedence < minPrecedence) return left
      this.next()
      left = { t: 'binary', op: token.text, left, right: this.parseBinary(precedence + 1) }
    }
  }

  private parseUnary(): Expr {
    const token = this.peek()
    if (token && token.kind === 'op' && ['-', '+', '!', '++', '--'].includes(token.text)) {
      this.next()
      if (token.text === '++' || token.text === '--') {
        return {
          t: 'increment',
          target: this.parseUnary(),
          delta: token.text === '++' ? 1 : -1,
          prefix: true,
        }
      }
      return { t: 'unary', op: token.text, arg: this.parseUnary() }
    }
    return this.parsePostfix()
  }

  private parsePostfix(): Expr {
    let base = this.parsePrimary()
    for (;;) {
      if (this.eat('.')) {
        base = { t: 'swizzle', target: base, components: this.name() }
        continue
      }
      if (this.eat('[')) {
        const index = this.parseExpression()
        this.expect(']')
        base = { t: 'index', target: base, index }
        continue
      }
      const token = this.peek()
      if (token && token.kind === 'op' && (token.text === '++' || token.text === '--')) {
        this.next()
        return { t: 'increment', target: base, delta: token.text === '++' ? 1 : -1, prefix: false }
      }
      return base
    }
  }

  private parsePrimary(): Expr {
    const token = this.next()
    if (token.kind === 'number') return { t: 'literal', value: Number(token.text) }
    if (token.kind === 'name') {
      if (token.text === 'true' || token.text === 'false') {
        return { t: 'literal', value: token.text === 'true' }
      }
      if (this.at('(')) return this.parseArguments(token.text)
      if (this.at('[') && this.isType(token.text)) {
        // `vec2[8]( ... )`: an array of constructor results, e.g. the tap
        // directions in BLUR_FRAG and EFFECTS_FRAG.
        this.next()
        const size = Number(this.next().text)
        this.expect(']')
        const call = this.parseArguments(token.text)
        if (call.t !== 'call') throw new GlslError('expected a constructor call')
        return { t: 'call', callee: `${token.text}[${size}]`, args: call.args }
      }
      return { t: 'name', name: token.text }
    }
    if (token.text === '(') {
      const expr = this.parseExpression()
      this.expect(')')
      return expr
    }
    throw new GlslError(`unexpected token ${token.text}`)
  }

  private parseArguments(callee: string): Expr {
    this.expect('(')
    const args: Expr[] = []
    while (!this.at(')')) {
      args.push(this.parseAssignment())
      if (!this.eat(',')) break
    }
    this.expect(')')
    return { t: 'call', callee, args }
  }
}

// --- value helpers ------------------------------------------------------------

function isSamplerRef(value: GlslValue): value is GlslSamplerRef {
  return typeof value === 'object' && value !== null && 'sample' in value
}

function isMatrix(value: GlslValue): value is number[][] {
  return Array.isArray(value) && Array.isArray(value[0])
}

function scalar(value: GlslValue): number {
  if (isSamplerRef(value)) throw new GlslError('expected a scalar, found a sampler')
  if (typeof value === 'number') return value
  if (typeof value === 'boolean') return value ? 1 : 0
  if (isMatrix(value)) throw new GlslError('expected a scalar, found a matrix')
  return value[0] ?? 0
}

function at(value: GlslValue, index: number): number {
  if (isSamplerRef(value)) throw new GlslError('expected a scalar, found a sampler')
  if (typeof value === 'number') return value
  if (typeof value === 'boolean') return value ? 1 : 0
  if (isMatrix(value)) throw new GlslError('expected a scalar, found a matrix')
  return value[index] ?? 0
}

function spread(value: GlslValue, length: number): number[] {
  if (isSamplerRef(value)) throw new GlslError('expected a vector, found a sampler')
  if (typeof value === 'number') return filled(value, length)
  if (typeof value === 'boolean') return filled(value ? 1 : 0, length)
  if (isMatrix(value)) throw new GlslError('expected a vector, found a matrix')
  return value.slice()
}

/** A GLSL vector is 1..4 components; anything else means a value lost its type. */
function filled(value: number, length: number): number[] {
  if (!Number.isInteger(length) || length < 1 || length > 4) {
    throw new GlslError(`cannot broadcast to width ${length}; the value lost its type`)
  }
  return new Array<number>(length).fill(value)
}

function width(value: GlslValue): number {
  if (isSamplerRef(value)) throw new GlslError('expected a vector, found a sampler')
  if (typeof value === 'number' || typeof value === 'boolean') return 1
  if (isMatrix(value)) throw new GlslError('expected a vector, found a matrix')
  return value.length
}

type Mapper = (a: number, b: number, c: number, index: number) => number

/**
 * Componentwise application. A result of width 1 is a GLSL `float`, not a
 * one-component vector: there is no such type, and letting a scalar stay a
 * scalar is what keeps `vec * float` and `float * float` distinguishable.
 */
function map2(
  a: GlslValue,
  b: GlslValue,
  fn: (x: number, y: number, index: number) => number,
): GlslValue {
  const length = Math.max(width(a), width(b))
  const left = spread(a, length)
  const right = spread(b, length)
  const out = left.map((value, index) => fn(value, right[index]!, index))
  return length === 1 ? out[0]! : out
}

function map3(a: GlslValue, b: GlslValue, c: GlslValue, fn: Mapper): GlslValue {
  const length = Math.max(width(a), width(b), width(c))
  const left = spread(a, length)
  const middle = spread(b, length)
  const right = spread(c, length)
  const out = left.map((value, index) => fn(value, middle[index]!, right[index]!, index))
  return length === 1 ? out[0]! : out
}

function negate(value: GlslValue): GlslValue {
  if (isSamplerRef(value)) throw new GlslError('cannot negate a sampler')
  if (typeof value === 'number') return -value
  if (typeof value === 'boolean') throw new GlslError('cannot negate a bool')
  if (isMatrix(value)) return value.map((row) => negate(row) as number[])
  return value.map((entry) => -entry)
}

function matTimesVec(matrix: number[][], vector: number[], transpose: boolean): number[] {
  return matrix.map((row, rowIndex) =>
    row.reduce((sum, entry, colIndex) => {
      const element = transpose ? matrix[colIndex]![rowIndex]! : entry
      return sum + element * (vector[colIndex] ?? 0)
    }, 0),
  )
}

const ARITHMETIC: Record<string, (a: number, b: number) => number> = {
  '+': (a, b) => a + b,
  '-': (a, b) => a - b,
  '*': (a, b) => a * b,
  '/': (a, b) => a / b,
  '%': (a, b) => a % b,
}

function arithmetic(op: string, left: GlslValue, right: GlslValue): GlslValue {
  if (isMatrix(left) && Array.isArray(right) && !isMatrix(right)) {
    if (op === '*') return matTimesVec(left, spread(right, left.length), false)
    throw new GlslError(`mat${op}vec is not allowed in GLSL`)
  }
  if (Array.isArray(left) && !isMatrix(left) && isMatrix(right)) {
    if (op === '*') return matTimesVec(right, spread(left, right.length), true)
    throw new GlslError(`vec${op}mat is not allowed in GLSL`)
  }
  const fn = ARITHMETIC[op]
  if (!fn) throw new GlslError(`unsupported operator ${op}`)
  return map2(left, right, fn)
}

const RELATIONAL: Record<string, (a: number, b: number) => boolean> = {
  '<': (a, b) => a < b,
  '>': (a, b) => a > b,
  '<=': (a, b) => a <= b,
  '>=': (a, b) => a >= b,
}

function compare(op: string, left: GlslValue, right: GlslValue): boolean {
  if (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.length > 0
  ) {
    const parts = left.map((entry, index) => compare(op, entry, right[index]!))
    return op === '!=' ? parts.some(Boolean) : parts.every(Boolean)
  }
  if (op === '==') return scalar(left) === scalar(right)
  if (op === '!=') return scalar(left) !== scalar(right)
  const fn = RELATIONAL[op]
  if (!fn) throw new GlslError(`unsupported comparison ${op}`)
  return fn(scalar(left), scalar(right))
}

// --- evaluation ---------------------------------------------------------------

type Scope = { values: Map<string, GlslValue>; parent: Scope | null }

function scopeOf(parent: Scope | null): Scope {
  return { values: new Map(), parent }
}

function read(scope: Scope, name: string): GlslValue {
  for (let node: Scope | null = scope; node; node = node.parent) {
    if (node.values.has(name)) return node.values.get(name)!
  }
  throw new GlslError(`unbound identifier ${name}`)
}

function write(scope: Scope, name: string, value: GlslValue): void {
  for (let node: Scope | null = scope; node; node = node.parent) {
    if (node.values.has(name)) {
      node.values.set(name, value)
      return
    }
  }
  scope.values.set(name, value)
}

type Frame = {
  functions: Map<string, { params: string[]; body: Stmt[] }>
  samplers: Record<string, GlslSampler>
  scope: Scope
}

const COMPONENTWISE_MATH: Record<string, (value: number) => number> = {
  fract: (value) => value - Math.floor(value),
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  exp: Math.exp,
  exp2: (value) => 2 ** value,
  log: Math.log,
  sqrt: Math.sqrt,
  abs: Math.abs,
  sign: Math.sign,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  radians: (value) => (value * Math.PI) / 180,
  degrees: (value) => (value * 180) / Math.PI,
  trunc: Math.trunc,
}

const VECTOR_CONSTRUCTORS = new Set([
  'vec2',
  'vec3',
  'vec4',
  'ivec2',
  'ivec3',
  'ivec4',
  'bvec2',
  'bvec3',
  'bvec4',
])

function evaluate(expr: Expr, frame: Frame): GlslValue {
  switch (expr.t) {
    case 'literal':
      return expr.value
    case 'name':
      return read(frame.scope, expr.name)
    case 'index': {
      const target = evaluate(expr.target, frame)
      const at_ = Math.round(scalar(evaluate(expr.index, frame)))
      if (isMatrix(target)) return target[at_] ?? []
      if (Array.isArray(target)) return target[at_] ?? 0
      throw new GlslError('cannot index a scalar')
    }
    case 'swizzle': {
      const target = evaluate(expr.target, frame)
      const values = [...expr.components].map((name) => {
        const index = COMPONENTS[name]
        if (index === undefined) throw new GlslError(`bad swizzle .${expr.components}`)
        return at(target, index)
      })
      // `.z` is a float in GLSL, not a one-component vector.
      return values.length === 1 ? values[0]! : values
    }
    case 'unary': {
      const value = evaluate(expr.arg, frame)
      if (expr.op === '+') return value
      if (expr.op === '-') return negate(value)
      return typeof value === 'boolean' ? !value : map2(value, 0, (a) => (a === 0 ? 1 : 0))
    }
    case 'binary': {
      if (expr.op === '&&' || expr.op === '||') {
        const left = Boolean(evaluate(expr.left, frame))
        if (expr.op === '&&' && !left) return false
        if (expr.op === '||' && left) return true
        return Boolean(evaluate(expr.right, frame))
      }
      if (['==', '!=', '<', '>', '<=', '>='].includes(expr.op)) {
        return compare(expr.op, evaluate(expr.left, frame), evaluate(expr.right, frame))
      }
      return arithmetic(expr.op, evaluate(expr.left, frame), evaluate(expr.right, frame))
    }
    case 'ternary':
      return evaluate(evaluate(expr.condition, frame) ? expr.whenTrue : expr.whenFalse, frame)
    case 'increment': {
      const before = scalar(evaluate(expr.target, frame))
      store(frame, expr.target, before + expr.delta)
      return expr.prefix ? before + expr.delta : before
    }
    case 'assign': {
      const target = expr.target
      const current = evaluate(target, frame)
      const raw =
        expr.op === '='
          ? evaluate(expr.value, frame)
          : arithmetic(expr.op.slice(0, -1), current, evaluate(expr.value, frame))
      // `vec += float` is componentwise in GLSL, so a scalar has to be spread
      // across the components the target already has.
      const value =
        Array.isArray(current) &&
        !isMatrix(current) &&
        current.length > 1 &&
        (typeof raw === 'number' || typeof raw === 'boolean')
          ? spread(raw, current.length)
          : raw
      store(frame, target, value)
      return value
    }
    case 'call':
      return invoke(frame, expr.callee, expr.args)
    default:
      throw new GlslError('unhandled expression')
  }
}

function store(frame: Frame, target: Expr, value: GlslValue): void {
  if (target.t === 'name') {
    write(frame.scope, target.name, value)
    return
  }
  if (target.t === 'index') {
    const container = evaluate(target.target, frame)
    const index = Math.round(scalar(evaluate(target.index, frame)))
    if (!Array.isArray(container)) throw new GlslError('cannot index-assign a scalar')
    container[index] = isSamplerRef(value) ? 0 : (value as number)
    return
  }
  if (target.t === 'swizzle') {
    const base = evaluate(target.target, frame)
    if (!Array.isArray(base) || isMatrix(base))
      throw new GlslError('unsupported swizzle assignment')
    const parts = spread(value, target.components.length)
    ;[...target.components].forEach((name, position) => {
      const index = COMPONENTS[name]
      if (index === undefined) throw new GlslError(`bad swizzle .${target.components}`)
      base[index] = parts[position]!
    })
    return
  }
  throw new GlslError('unsupported assignment target')
}

function invoke(frame: Frame, callee: string, args: Expr[]): GlslValue {
  const arrayForm = /^(\w+)\[(\d+)\]$/.exec(callee)
  if (arrayForm) {
    // `vec2[8](a, b, ...)` builds an array of eight vec2s.
    const typeName = arrayForm[1]!
    const count = Number(arrayForm[2])
    if (args.length !== count) throw new GlslError(`${callee}() got ${args.length} entries`)
    const items: number[][] = []
    for (const arg of args) {
      const built = invoke(frame, typeName, [arg])
      if (!Array.isArray(built) || isMatrix(built)) {
        throw new GlslError(`${callee}() built a non-vector entry`)
      }
      items.push(built)
    }
    return items
  }

  if (callee === 'texture') {
    const samplerExpr = args[0]
    if (!samplerExpr) throw new GlslError('texture() needs a sampler argument')
    const bound = evaluate(samplerExpr, frame)
    const sampler = isSamplerRef(bound)
      ? bound.sample
      : samplerExpr.t === 'name'
        ? frame.samplers[samplerExpr.name]
        : undefined
    if (!sampler) throw new GlslError('texture() got an unbound sampler')
    const uv = args[1] ? spread(evaluate(args[1], frame), 2) : [0, 0]
    return spread(sampler(uv), 4)
  }

  const userFunction = frame.functions.get(callee)
  if (userFunction) {
    const scope = scopeOf(frame.scope)
    userFunction.params.forEach((param, position) => {
      const arg = args[position]
      scope.values.set(param, arg ? evaluate(arg, frame) : 0)
    })
    const returned = runBlock(userFunction.body, { ...frame, scope })
    if (!returned || returned.value === null) {
      throw new GlslError(`${callee}() returned no value`)
    }
    return returned.value
  }

  if (VECTOR_CONSTRUCTORS.has(callee)) {
    const arity = VECTOR_ARITY[callee]!
    const values = args.map((arg) => evaluate(arg, frame))
    if (values.length === arity) return values.map((entry) => scalar(entry))
    // `vec3(someVec2, 1.0)` and the broadcast form `vec3(0.0)` are both legal.
    const head = values[0] === undefined ? [] : spread(values[0], width(values[0]!))
    const tail = values.slice(1).map((entry) => scalar(entry))
    const flat = [...head, ...tail]
    if (flat.length === arity) return flat
    if (flat.length === 1) return new Array<number>(arity).fill(flat[0]!)
    throw new GlslError(`${callee}() got ${flat.length} components`)
  }

  const values = args.map((arg) => evaluate(arg, frame))
  const first = values[0] ?? 0
  const second = values[1] ?? 0
  const third = values[2] ?? 0

  switch (callee) {
    case 'float':
      return scalar(first)
    case 'int':
    case 'uint':
      return Math.round(scalar(first))
    case 'bool':
      return scalar(first) !== 0
    case 'clamp':
      return map3(first, second, third, (x, low, high) => Math.min(Math.max(x, low), high))
    case 'mix':
      return map3(first, second, third, (a, b, t) => a + (b - a) * t)
    case 'max':
      // Not `Math.max` directly: the mapper is called as (a, b, index) and the
      // index would be treated as a third candidate.
      return map2(first, second, (a, b) => Math.max(a, b))
    case 'min':
      return map2(first, second, (a, b) => Math.min(a, b))
    case 'step':
      // `step(edge, x)` is 0 where x < edge. The arguments used to be passed to
      // `map2` the other way round, which inverted it: no shader in the tree
      // called `step()` until the D3-F23 shoulder did, and a parity harness that
      // quietly evaluates a legal builtin backwards is worse than no harness.
      return map2(first, second, (edge, x) => (x < edge ? 0 : 1))
    case 'smoothstep': {
      const e0 = first
      const e1 = second
      const x = third
      return map3(e0, e1, x, (low, high, value) => {
        const t = Math.min(1, Math.max(0, (value - low) / (high - low || 1)))
        return t * t * (3 - 2 * t)
      })
    }
    case 'mod':
      return map2(first, second, (a, b) => a - b * Math.floor(a / b))
    case 'pow':
      return map2(first, second, (a, b) => a ** b)
    case 'dot':
      return spread(first, Math.max(1, width(first))).reduce(
        (sum, entry, index) => sum + entry * at(second, index),
        0,
      )
    case 'length':
      return Math.hypot(...spread(first, width(first)))
    case 'distance':
      return Math.hypot(
        ...spread(first, width(first)).map((entry, index) => entry - at(second, index)),
      )
    case 'normalize':
      return map2(first, first, (a, _b, index) => {
        const length = Math.hypot(...spread(first, width(first))) || 1
        return index < width(first) ? a / length : a
      })
    default: {
      const fn = COMPONENTWISE_MATH[callee]
      if (!fn) throw new GlslError(`unsupported builtin ${callee}()`)
      if (typeof first === 'number' || typeof first === 'boolean') return fn(scalar(first))
      return spread(first, width(first)).map(fn)
    }
  }
}

type Returned = { returned: true; value: GlslValue | null }

function runStatement(stmt: Stmt, frame: Frame): Returned | null {
  switch (stmt.t) {
    case 'expression':
      evaluate(stmt.expr, frame)
      return null
    case 'declaration': {
      const value =
        stmt.init !== null
          ? evaluate(stmt.init, frame)
          : stmt.arraySize
            ? new Array<number>(Math.round(scalar(evaluate(stmt.arraySize, frame)))).fill(0)
            : 0
      frame.scope.values.set(stmt.name, value)
      return null
    }
    case 'block':
      return runBlock(stmt.body, frame)
    case 'if': {
      const inner: Frame = { ...frame, scope: scopeOf(frame.scope) }
      if (evaluate(stmt.condition, inner)) return runStatement(stmt.then, inner)
      return stmt.otherwise ? runStatement(stmt.otherwise, inner) : null
    }
    case 'for': {
      const loopScope = scopeOf(frame.scope)
      const loop: Frame = { ...frame, scope: loopScope }
      if (stmt.init) runStatement(stmt.init, loop)
      for (;;) {
        if (stmt.condition && !evaluate(stmt.condition, loop)) return null
        const returned = runStatement(stmt.body, { ...loop, scope: scopeOf(loopScope) })
        if (returned) return returned
        if (stmt.step) evaluate(stmt.step, loop)
      }
    }
    case 'return':
      // A bare `return;` is a void return: there is no value, and the caller
      // must keep whatever was written to the output variable. Returning 0
      // instead turned every early exit in a fragment shader into transparent
      // black, and then into the matte once the output pass flattened it.
      return { returned: true, value: stmt.expr ? evaluate(stmt.expr, frame) : null }
    case 'function':
      return null
    default:
      throw new GlslError('unhandled statement')
  }
}

function runBlock(body: Stmt[], frame: Frame): Returned | null {
  for (const stmt of body) {
    const returned = runStatement(stmt, frame)
    if (returned) return returned
  }
  return null
}

export type CompiledShader = { body: Stmt[] }

/** Drop the preprocessor, precision and `in`/`out`/`uniform` declaration lines. */
function bodyOf(source: string): string {
  return source
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim()
      return (
        !trimmed.startsWith('#') &&
        !trimmed.startsWith('precision ') &&
        !trimmed.startsWith('uniform ') &&
        !trimmed.startsWith('in ') &&
        !trimmed.startsWith('out ')
      )
    })
    .join('\n')
}

/**
 * Parse a fragment shader. Throws on anything this interpreter cannot execute
 * faithfully, so a shader that grows an unsupported construct fails a parity
 * test loudly instead of being compared against a wrong reference.
 */
export function compileFragment(source: string): CompiledShader {
  return { body: new Parser(tokenize(bodyOf(source))).parseProgram() }
}

/** Evaluate one fragment of `shader` and return its `outColor` as rgba 0..1. */
export function runFragment(shader: CompiledShader, env: GlslEnv): number[] {
  const functions = new Map<string, { params: string[]; body: Stmt[] }>()
  for (const stmt of shader.body) {
    if (stmt.t === 'function') functions.set(stmt.name, { params: stmt.params, body: stmt.body })
  }

  const root = scopeOf(null)
  for (const [name, value] of Object.entries(env.uniforms ?? {})) root.values.set(name, value)
  // A sampler uniform resolves to the sampler itself, not to the recorded
  // texture unit: the unit number means nothing without a driver, and
  // `texture()` has to be able to tell the four curves LUTs apart.
  for (const [name, sampler] of Object.entries(env.samplers ?? {})) {
    root.values.set(name, { sample: sampler })
  }
  root.values.set('gl_FragCoord', [
    env.fragCoord[0],
    env.fragCoord[1],
    env.fragZ ?? 0,
    env.fragW ?? 1,
  ])
  root.values.set('v_uv', [env.vUv[0], env.vUv[1]])
  // `out vec4 outColor;` is stripped with the other declaration lines, so the
  // output is seeded here and every assignment in main() resolves to it.
  root.values.set('outColor', [0, 0, 0, 0])

  const frame: Frame = { functions, samplers: env.samplers ?? {}, scope: scopeOf(root) }
  const main = shader.body.find(
    (stmt): stmt is Extract<Stmt, { t: 'function' }> =>
      stmt.t === 'function' && stmt.name === 'main',
  )
  if (!main) throw new GlslError('the shader has no main()')
  const returned = runBlock(main.body, frame)
  // `main()` is void, so a returned value can only come from a non-conforming
  // shader. A bare `return;` is the common early-exit shape and means "whatever
  // outColor already holds".
  if (returned && returned.value !== null) return spread(returned.value, 4)
  return spread(read(root, 'outColor'), 4)
}
