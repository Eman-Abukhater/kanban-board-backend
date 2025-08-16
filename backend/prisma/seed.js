const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
  
  const adminPass = await bcrypt.hash('admin123', 10);
  const empPass = await bcrypt.hash('employee123', 10);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      name: 'Osama Ahmed',
      email: 'admin@example.com',
      password_hash: adminPass,
      role: 'admin',
    },
  });

  const employee = await prisma.user.upsert({
    where: { email: 'employee@example.com' },
    update: {},
    create: {
      name: 'Abeer F.',
      email: 'employee@example.com',
      password_hash: empPass,
      role: 'employee',
    },
  });

  const project = await prisma.sqlProject.upsert({
    where: { project_id: 1001 },
    update: {},
    create: {
      project_id: 1001,
      project_name: 'ESAP ERP – Pilot',
      description: 'Seed project',
      status: 'open',
    },
  });

  console.log({ admin, employee, project });
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
