// backend/prisma/seed.js
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
  // passwords
  const passAdmin = await bcrypt.hash('admin123', 10);
  const passEmp   = await bcrypt.hash('employee123', 10);
  const passEmp2  = await bcrypt.hash('employee234', 10);
  const passEmp3  = await bcrypt.hash('employee345', 10);

  
  // 205 - Osama Ahmed (admin)
  await prisma.user.upsert({
    where: { email: 'osama@example.com' },
    update: {
      name: 'Osama Ahmed',
      role: 'admin',
      password_hash: passAdmin,
    },
    create: {
      user_id: 205,
      name: 'Osama Ahmed',
      email: 'osama@example.com',
      password_hash: passAdmin,
      role: 'admin',
    },
  });

  // 301 - Abeer F. (employee)
  await prisma.user.upsert({
    where: { email: 'abeer@example.com' },
    update: {
      name: 'Abeer F.',
      role: 'employee',
      password_hash: passEmp,
    },
    create: {
      user_id: 301,
      name: 'Abeer F.',
      email: 'abeer@example.com',
      password_hash: passEmp,
      role: 'employee',
    },
  });

  // 302 - Badr N. (employee)
  await prisma.user.upsert({
    where: { email: 'badr@example.com' },
    update: {
      name: 'Badr N.',
      role: 'employee',
      password_hash: passEmp2,
    },
    create: {
      user_id: 302,
      name: 'Badr N.',
      email: 'badr@example.com',
      password_hash: passEmp2,
      role: 'employee',
    },
  });

  // 303 - Carim K. (employee)
  await prisma.user.upsert({
    where: { email: 'carim@example.com' },
    update: {
      name: 'Carim K.',
      role: 'employee',
      password_hash: passEmp3,
    },
    create: {
      user_id: 303,
      name: 'Carim K.',
      email: 'carim@example.com',
      password_hash: passEmp3,
      role: 'employee',
    },
  });

  // ---- PROJECT 1001 (so your Board List loads) ----
  await prisma.sqlProject.upsert({
    where: { project_id: 1001 },
    update: {},
    create: {
      project_id: 1001,
      project_name: 'ESAP ERP – Pilot',
      description: 'Seed project',
      status: 'open',
    },
  });

    await prisma.$executeRawUnsafe(`
    SELECT setval(
      pg_get_serial_sequence('"User"', 'user_id'),
      GREATEST((SELECT MAX("user_id") FROM "User"), 1) + 1,
      false
    );
  `);

  console.log('Seed complete');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
