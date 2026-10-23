// A lexical source guard. Database assertions verify the actual privileges.
const word = /[\p{L}\p{N}_$]/u

function quoted(sql, start, quote) {
  let value = ''
  let end = start + 1
  while (end < sql.length) {
    if (sql[end] !== quote) value += sql[end++]
    else if (sql[end + 1] === quote) { value += quote; end += 2 }
    else return { value, end: end + 1 }
  }
  throw new Error('Unterminated SQL quote')
}

function blockCommentEnd(sql, start) {
  let depth = 1
  let end = start + 2
  while (end < sql.length && depth) {
    if (sql.slice(end, end + 2) === '/*') { depth++; end += 2 }
    else if (sql.slice(end, end + 2) === '*/') { depth--; end += 2 }
    else end++
  }
  if (depth) throw new Error('Unterminated SQL comment')
  return end
}

function dollarToken(sql, index, delimiter) {
  const end = sql.indexOf(delimiter, index + delimiter.length)
  if (end < 0) throw new Error('Unterminated dollar-quoted SQL')
  return { token: { type: 'body', value: sql.slice(index + delimiter.length, end) },
    next: end + delimiter.length }
}

function wordToken(sql, index) {
  let next = index + 1
  while (next < sql.length && word.test(sql[next])) next++
  return { token: { type: 'word', value: sql.slice(index, next).toLowerCase() }, next }
}

function quotedToken(sql, index) {
  const result = quoted(sql, index, sql[index])
  return { token: { type: sql[index] === '"' ? 'identifier' : 'string', value: result.value }, next: result.end }
}

function nextToken(sql, index) {
  const rest = sql.slice(index)
  if (/^\s/.test(rest)) return { next: index + 1 }
  if (rest.startsWith('--')) {
    const newline = sql.indexOf('\n', index)
    return { next: newline < 0 ? sql.length : newline + 1 }
  }
  if (rest.startsWith('/*')) return { next: blockCommentEnd(sql, index) }
  const dollar = rest.match(/^\$(?:[A-Za-z_]\w*)?\$/)
  if (dollar) return dollarToken(sql, index, dollar[0])
  if (['"', "'"].includes(sql[index])) return quotedToken(sql, index)
  if (word.test(sql[index])) return wordToken(sql, index)
  return { token: { type: 'symbol', value: sql[index] }, next: index + 1 }
}

export function tokenize(sql) {
  const tokens = []
  let index = 0
  while (index < sql.length) {
    const { token, next } = nextToken(sql, index)
    if (token) tokens.push(token)
    index = next
  }
  return tokens
}

function statements(tokens) {
  const result = [[]]
  for (const token of tokens) {
    if (token.type === 'symbol' && token.value === ';') result.push([])
    else result.at(-1).push(token)
  }
  return result.filter((statement) => statement.length)
}

const isWord = (token, value) => token?.type === 'word' && token.value === value
const isIdentifier = (token) => ['word', 'identifier'].includes(token?.type)

function relationAt(tokens, index, kind = 'table') {
  if (!isIdentifier(tokens[index])) return null
  let schema = 'public'
  let name = tokens[index].value
  let next = index + 1
  if (tokens[next]?.value === '.') {
    schema = name
    name = tokens[next + 1]?.value
    if (!isIdentifier(tokens[next + 1])) return null
    next += 2
  }
  return { schema, name, kind, next, key: JSON.stringify([schema, name, kind]) }
}

function skipIfNotExists(tokens, index) {
  return ['if', 'not', 'exists'].every((value, offset) => isWord(tokens[index + offset], value)) ? index + 3 : index
}

function creationAt(tokens, index) {
  let next = index + 1
  if (isWord(tokens[next], 'or') && isWord(tokens[next + 1], 'replace')) next += 2
  while (['global', 'local', 'unlogged', 'temporary', 'temp', 'materialized', 'foreign', 'recursive']
    .some((value) => isWord(tokens[next], value))) {
    if (isWord(tokens[next], 'temp') || isWord(tokens[next], 'temporary')) return null
    next++
  }
  const kind = tokens[next]?.value
  if (!['table', 'view', 'sequence'].includes(kind)) return null
  return relationAt(tokens, skipIfNotExists(tokens, next + 1), kind === 'sequence' ? 'sequence' : 'table')
}

function columnDefinitions(tokens) {
  const columns = [[]]
  let depth = 0
  for (const token of tokens) {
    if (token.value === ')' && depth === 0) break
    if (token.value === ',' && depth === 0) columns.push([])
    else columns.at(-1).push(token)
    if (token.value === '(') depth++
    if (token.value === ')') depth--
  }
  return columns
}

function implicitColumnSequence(table, column, problems) {
  if (!isIdentifier(column[0])) return []
  if (!column.slice(1).some((token) => token.type === 'word'
    && ['smallserial', 'serial', 'bigserial', 'identity'].includes(token.value))) return []
  const name = `${table.name}_${column[0].value}_seq`
  if (new TextEncoder().encode(name).length > 63) {
    problems.push('use an explicitly named sequence for long serial/identity identifiers')
    return []
  }
  return [{ schema: table.schema, name, kind: 'sequence', key: JSON.stringify([table.schema, name, 'sequence']) }]
}

function implicitSequences(statement, problems) {
  const start = statement.findIndex((token, index) => isWord(token, 'create')
    || (isWord(token, 'alter') && isWord(statement[index + 1], 'table')))
  if (start < 0) return []
  statement = statement.slice(start)
  let table
  let columns = []
  if (isWord(statement[0], 'create')) {
    table = creationAt(statement, 0)
    if (!table || !statement.slice(0, table.next).some((token) => isWord(token, 'table'))) return []
    if (statement[table.next]?.value === '(') columns = columnDefinitions(statement.slice(table.next + 1))
  } else if (isWord(statement[0], 'alter') && isWord(statement[1], 'table')) {
    let start = isWord(statement[2], 'if') ? 4 : 2
    if (isWord(statement[start], 'only')) start++
    table = relationAt(statement, start)
    if (!table) return []
    for (const clause of columnDefinitions(statement.slice(table.next))) {
      if (!isWord(clause[0], 'add')) continue
      const start = isWord(clause[1], 'column') ? 2 : 1
      columns.push(clause.slice(skipIfNotExists(clause, start)))
    }
  }
  if (table?.schema !== 'public') return []
  return columns.flatMap((column) => implicitColumnSequence(table, column, problems))
}

function nextvalSequences(statement, problems) {
  const result = []
  const declaredNames = new Set(statement.flatMap((token, index) => {
    const created = isWord(token, 'create') ? creationAt(statement, index) : null
    return created ? [created.next - 1] : []
  }))
  for (const [index, token] of statement.entries()) {
    if (!isWord(token, 'nextval') || statement[index + 1]?.value !== '(' || declaredNames.has(index)) continue
    const literal = statement[index + 2]
    const relation = literal?.type === 'string' ? relationAt(tokenize(literal.value), 0, 'sequence') : null
    if (!relation) problems.push('cannot inspect non-literal nextval sequence; use a literal regclass name')
    else if (relation.schema === 'public') result.push(relation)
  }
  return result
}

function defaultGrantProblems(statement, problems) {
  const start = statement.findIndex((token, index) => isWord(token, 'alter') && isWord(statement[index + 1], 'default'))
  if (start < 0) return
  statement = statement.slice(start)
  const grant = statement.findIndex((token) => isWord(token, 'grant'))
  const on = statement.findIndex((token) => isWord(token, 'on'))
  if (grant < 0 || !['tables', 'sequences'].includes(statement[on + 1]?.value)) return
  const schema = statement.findIndex((token) => isWord(token, 'schema'))
  if (schema < 0 || statement.slice(schema + 1, grant).some((token) => token.value === 'public')) {
    problems.push('restores blanket default public relation access; grant named objects instead')
  }
}

function createdRelations(tokens) {
  return tokens.map((token, index) => isWord(token, 'create') ? creationAt(tokens, index) : null)
    .filter((relation) => relation?.schema === 'public')
}

function selectIntoIndex(statement) {
  let depth = 0
  let selected = false
  return statement.findIndex((token) => {
    if (token.value === '(') depth++
    if (token.value === ')') depth--
    if (depth !== 0) return false
    if (isWord(token, 'select')) selected = true
    return selected && isWord(token, 'into')
  })
}

function selectIntoRelations(tokens) {
  return statements(tokens).flatMap((statement) => {
    const into = selectIntoIndex(statement)
    if (into < 0) return []
    let next = into + 1
    if (['temp', 'temporary'].some((value) => isWord(statement[next], value))) return []
    if (isWord(statement[next], 'unlogged')) next++
    if (isWord(statement[next], 'table')) next++
    const relation = relationAt(statement, next)
    return relation?.schema === 'public' ? [relation] : []
  })
}

function checkSchemaGrant(statement, start, on, problems) {
  if (!isWord(statement[start], 'grant') || !isWord(statement[on + 1], 'schema')) return
  const to = statement.findIndex((token, index) => index > on && isWord(token, 'to'))
  const publicSchema = statement.slice(on + 2, to).some((token) => isIdentifier(token) && token.value === 'public')
  const create = statement.slice(start + 1, on).some((token) => ['create', 'all'].includes(token.value))
  if (publicSchema && create) problems.push('grants CREATE/ALL on public schema; use named-object access')
}

function checkBlanket(statement, start, on, problems) {
  const clause = statement.slice(on + 1)
  const to = clause.findIndex((token) => isWord(token, 'to') || isWord(token, 'from'))
  const schema = clause.findIndex((token) => isWord(token, 'schema'))
  const schemas = clause.slice(schema + 1, to < 0 ? undefined : to)
  if (['tables', 'sequences'].includes(clause[1]?.value)
    && (schema < 0 || schemas.some((token) => isIdentifier(token) && token.value === 'public'))
    && isWord(statement[start], 'grant')) problems.push('uses a blanket public-schema grant')
}

function namedTargets(statement, next, kind) {
  const result = []
  while (next < statement.length) {
    const relation = relationAt(statement, next, kind)
    if (!relation) break
    next = relation.next
    if (relation.schema === 'public') result.push(relation.key)
    if (statement[next]?.value !== ',') break
    next++
  }
  const hasRecipient = statement.slice(next).some((token) => isWord(token, 'to') || isWord(token, 'from'))
  return hasRecipient ? result : []
}

function privilegeTargets(statement, problems) {
  const start = statement.findIndex((token) => isWord(token, 'grant') || isWord(token, 'revoke'))
  if (start < 0) return []
  const on = statement.findIndex((token, index) => index > start && isWord(token, 'on'))
  if (on < 0) return []
  checkSchemaGrant(statement, start, on, problems)
  let next = on + 1
  if (isWord(statement[next], 'all')) {
    checkBlanket(statement, start, on, problems)
    return []
  }
  const kind = isWord(statement[next], 'sequence') ? 'sequence' : 'table'
  if (['table', 'sequence'].some((value) => isWord(statement[next], value))) next++
  else if (['function', 'procedure', 'schema', 'type', 'database', 'routine'].some((value) => isWord(statement[next], value))) return []
  return namedTargets(statement, next, kind)
}

function isRoutine(statement) {
  const next = isWord(statement[1], 'or') && isWord(statement[2], 'replace') ? 3 : 1
  return isWord(statement[0], 'create')
    && ['function', 'procedure'].some((value) => isWord(statement[next], value))
}

function hasDynamicExecute(tokens) {
  let privilegeClause = false
  return tokens.some((token, index) => {
    if (isWord(token, 'grant') || isWord(token, 'revoke')) privilegeClause = true
    if (isWord(token, 'on') || token.value === ';') privilegeClause = false
    return isWord(token, 'execute') && !privilegeClause
      && !['function', 'procedure'].some((kind) => isWord(tokens[index + 1], kind))
  })
}

function inspectRoutineBodies(statement, problems) {
  const start = statement.findIndex((token, index) => isWord(token, 'create') && isRoutine(statement.slice(index)))
  if (start < 0) return
  statement = statement.slice(start)
  const as = statement.findIndex((token) => isWord(token, 'as'))
  if (as < 0) return
  const body = statement[as + 1]
  if (!['body', 'string'].includes(body?.type)) {
    problems.push('cannot inspect routine body; use dollar-quoted SQL')
    return
  }
  const inner = tokenize(body.value)
  const language = statement.findIndex((token) => isWord(token, 'language'))
  const selectsIntoTable = statement[language + 1]?.value === 'sql' && selectIntoRelations(inner).length
  if (createdRelations(inner).length || hasDynamicExecute(inner) || selectsIntoTable) {
    problems.push('uses runtime object DDL or dynamic EXECUTE in a routine; use explicit schema SQL')
  }
}

function expandBlocks(tokens, problems) {
  const expanded = []
  for (const statement of statements(tokens)) {
    if (isWord(statement[0], 'do')) {
      const body = statement.find((token) => ['body', 'string'].includes(token.type))
      if (!body) { problems.push('cannot inspect DO block'); continue }
      const inner = tokenize(body.value)
      if (hasDynamicExecute(inner)) {
        problems.push('uses dynamic EXECUTE in a DO block; move object DDL into explicit SQL')
      }
      expanded.push(...expandBlocks(inner, problems))
    } else {
      inspectRoutineBodies(statement, problems)
      expanded.push(statement)
    }
  }
  return expanded
}

export function findGrantProblems(sql) {
  const problems = []
  const tokens = tokenize(sql)
  const parsed = expandBlocks(tokens, problems)
  const decisions = new Set(parsed.flatMap((statement) => privilegeTargets(statement, problems)))
  for (const statement of parsed) defaultGrantProblems(statement, problems)
  const implicit = parsed.flatMap((statement) => [...implicitSequences(statement, problems),
    ...nextvalSequences(statement, problems)])
  for (const relation of [...parsed.flatMap(createdRelations), ...selectIntoRelations(tokens), ...implicit]) {
    if (!decisions.has(relation.key)) {
      problems.push(`creates public.${relation.name} without a matching ${relation.kind} GRANT or REVOKE in the same file`)
    }
  }
  return [...new Set(problems)]
}
