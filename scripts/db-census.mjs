import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const models = ['user','account','session','verificationToken','holding','firm','userFirm','module','firmModule','moduleDependency','department','employee','contract','employeeTransfer','leaveRequest','leaveBalance','absence','mission','missionExpense','payrollConfig','employeeSalary','payslip','client','userClientAssignment','clientFirmAssignment','clientQuarterlyReport','partner','partnerBranch','partnerAgreement','benefitPlan','employeeCoverageEnrollment','contribution','claim','fileObject','employeeDocument','dashboardView','auditLog']
const out = {}
for (const m of models) {
  try { out[m] = await db[m].count() } catch (e) { out[m] = 'ERR: ' + e.message.split('\n')[0] }
}
console.log('=== ROW COUNTS ===')
for (const [k,v] of Object.entries(out)) console.log(String(v).padStart(7), k)
console.log('\n=== FIRMS ===')
console.table(await db.firm.findMany({ select: { id:true, slug:true, name:true, themeColor:true, logo:true, holdingId:true } }))
console.log('\n=== HOLDINGS ===')
console.table(await db.holding.findMany({ select: { id:true, name:true } }))
console.log('\n=== EMPLOYEES PER FIRM ===')
console.table(await db.employee.groupBy({ by:['firmId','status'], _count:{_all:true} }))
console.log('\n=== CONTRACTS BY TYPE x STATUS ===')
console.table(await db.contract.groupBy({ by:['type','status'], _count:{_all:true} }))
console.log('\n=== USERFIRM ROLES ===')
console.table(await db.userFirm.groupBy({ by:['role'], _count:{_all:true} }))
console.log('\n=== MODULES ===')
console.table(await db.module.findMany({ select:{slug:true,name:true,basePath:true,isActive:true,isSystem:true} }))
console.log('\n=== FIRM MODULES ===')
console.table(await db.firmModule.findMany({ select:{firmId:true,isEnabled:true,module:{select:{slug:true}}} }))
await db.$disconnect()
