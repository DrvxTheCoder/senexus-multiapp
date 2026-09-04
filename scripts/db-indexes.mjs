import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const rows = await db.$queryRawUnsafe(`
  SELECT tablename, indexname, indexdef
  FROM pg_indexes
  WHERE schemaname = 'public'
  ORDER BY tablename, indexname
`)
console.log('total indexes:', rows.length)
for (const r of rows) console.log(`${r.tablename}\t${r.indexname}\t${r.indexdef.replace(/^CREATE (UNIQUE )?INDEX \S+ ON public\.\S+ USING \S+ /,'')}`)
await db.$disconnect()
