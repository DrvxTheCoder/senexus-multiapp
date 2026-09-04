import { Prisma } from '@prisma/client'
import fs from 'node:fs'

const raw = fs.readFileSync('prisma/schema.prisma', 'utf8').replace(/\r\n/g, '\n')

// map "Model.field" -> { native, comment } straight from the schema text
const rawField = new Map()
let cur = null
for (const line of raw.split('\n')) {
  const m = line.match(/^model\s+(\w+)\s*\{/)
  if (m) { cur = m[1]; continue }
  if (line.startsWith('}')) { cur = null; continue }
  if (!cur) continue
  const f = line.match(/^\s{2}(\w+)\s+(\S+)(.*)$/)
  if (!f) continue
  const rest = f[3] || ''
  const native = (rest.match(/@db\.[\w()\s,]+/) || [''])[0].trim()
  const comment = (rest.match(/\/\/\s*(.+)$/) || [null, ''])[1].trim()
  rawField.set(`${cur}.${f[1]}`, { native, comment })
}

const L = []
const p = (s = '') => L.push(s)

const models = Prisma.dmmf.datamodel.models
const enums = Prisma.dmmf.datamodel.enums

p('## Enums')
p()
p('| Enum | Values |')
p('| --- | --- |')
for (const e of enums) p(`| \`${e.name}\` | ${e.values.map(v => `\`${v.name}\``).join(' · ')} |`)
p()

p('## Models')
p()
for (const m of models) {
  const scalars = m.fields.filter(f => f.kind !== 'object')
  const rels = m.fields.filter(f => f.kind === 'object')
  p(`### \`${m.name}\` → table \`${m.dbName || m.name}\``)
  p()
  p('| Field | Type | Null | Notes |')
  p('| --- | --- | --- | --- |')
  for (const f of scalars) {
    const meta = rawField.get(`${m.name}.${f.name}`) || {}
    const notes = []
    if (f.isId) notes.push('**PK**')
    if (f.isUnique) notes.push('unique')
    if (f.hasDefaultValue) {
      const d = f.default
      notes.push('default `' + (typeof d === 'object' && d !== null ? (d.name === 'dbgenerated' ? 'dbgenerated' : d.name + '()') : JSON.stringify(d)) + '`')
    }
    if (f.isUpdatedAt) notes.push('`@updatedAt`')
    if (meta.native) notes.push('`' + meta.native + '`')
    if (meta.comment) notes.push('— ' + meta.comment)
    p(`| \`${f.name}\` | ${f.type}${f.isList ? '[]' : ''} | ${f.isRequired ? 'no' : 'yes'} | ${notes.join(', ')} |`)
  }
  p()
  if (rels.length) {
    p('**Relations**')
    p()
    p('| Field | Target | Card. | FK | On delete | Relation name |')
    p('| --- | --- | --- | --- | --- | --- |')
    for (const f of rels) {
      const fk = (f.relationFromFields || []).join(', ')
      const named = f.relationName && !/^\w+To\w+$/.test(f.relationName) ? '`' + f.relationName + '`' : ''
      p(`| \`${f.name}\` | \`${f.type}\` | ${f.isList ? 'many' : f.isRequired ? 'one' : 'one?'} | ${fk ? '`' + fk + '`' : '—'} | ${f.relationOnDelete || '—'} | ${named || '—'} |`)
    }
    p()
  }
  const cons = []
  if (m.primaryKey) cons.push('`@@id([' + m.primaryKey.fields.join(', ') + '])`')
  for (const u of m.uniqueFields) cons.push('`@@unique([' + u.join(', ') + '])`')
  const idField = m.fields.find(f => f.isId)
  if (idField) cons.unshift('`@id` on `' + idField.name + '`')
  for (const f of m.fields) if (f.isUnique && !f.isId) cons.push('`@unique` on `' + f.name + '`')
  p('**Constraints:** ' + (cons.length ? cons.join(' · ') : 'none'))
  p()
  p('---')
  p()
}

fs.writeFileSync('docs/_generated-models.md', L.join('\n'), 'utf8')
console.log('models:', models.length, 'enums:', enums.length, 'lines:', L.length)
