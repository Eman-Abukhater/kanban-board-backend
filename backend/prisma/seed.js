// prisma/seed.js
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const { v4: uuid } = require('uuid');

const prisma = new PrismaClient();

async function main() {
  // ---- USERS ----
  const passAdmin = await bcrypt.hash('admin123', 10);
  const passEmp   = await bcrypt.hash('employee123', 10);
  const passEmp2  = await bcrypt.hash('employee234', 10);
  const passEmp3  = await bcrypt.hash('employee345', 10);

  await prisma.user.upsert({
    where: { email: 'osama@example.com' },
    update: { name: 'Osama Ahmed', role: 'admin', password_hash: passAdmin },
    create: { user_id: 205, name: 'Osama Ahmed', email: 'osama@example.com', password_hash: passAdmin, role: 'admin' },
  });
  await prisma.user.upsert({
    where: { email: 'abeer@example.com' },
    update: { name: 'Abeer F.', role: 'employee', password_hash: passEmp },
    create: { user_id: 301, name: 'Abeer F.', email: 'abeer@example.com', password_hash: passEmp, role: 'employee' },
  });
  await prisma.user.upsert({
    where: { email: 'badr@example.com' },
    update: { name: 'Badr N.', role: 'employee', password_hash: passEmp2 },
    create: { user_id: 302, name: 'Badr N.', email: 'badr@example.com', password_hash: passEmp2, role: 'employee' },
  });
  await prisma.user.upsert({
    where: { email: 'carim@example.com' },
    update: { name: 'Carim K.', role: 'employee', password_hash: passEmp3 },
    create: { user_id: 303, name: 'Carim K.', email: 'carim@example.com', password_hash: passEmp3, role: 'employee' },
  });

  // ---- PROJECT (fkpoid=1001 so your Board List loads) ----
  const fkpoid = 1001;
  await prisma.sqlProject.upsert({
    where: { project_id: fkpoid },
    update: {},
    create: { project_id: fkpoid, project_name: 'ESAP ERP – Pilot', description: 'Seed project', status: 'open' },
  });

  // ---- BOARD + MEMBERS ----
  const fkboardid = uuid(); // or 'DEMO-FK' if you want a fixed id
  const board = await prisma.board.create({
    data: {
      fkboardid,
      project_id: fkpoid,
      title: 'ESAP ERP – Pilot',
      description: 'Seeded board',
      status: 'open',
      progress: 0,
      addedby: '205-Osama Ahmed',
      addedbyid: 205,
      boardMembers: {
        create: [
          { user_id: 205 }, // Osama (admin)
          { user_id: 301 }, // Abeer
          { user_id: 302 }, // Badr
        ],
      },
    },
  });

  // ---- LISTS ----
  const [todo, doing, done] = await Promise.all([
    prisma.list.create({ data: { board_id: board.board_id, list_name: 'To-do',        position: 0 } }),
    prisma.list.create({ data: { board_id: board.board_id, list_name: 'In-progress',  position: 1 } }),
    prisma.list.create({ data: { board_id: board.board_id, list_name: 'Done',         position: 2 } }),
  ]);

  // ---- A CARD + TASKS + TAG + COMMENT ----
  const card = await prisma.card.create({
    data: {
      list_id: todo.list_id,
      title: 'Seeded card',
      description: 'Hello from seed',
      position: 0,
      tasks: {
        create: [
          { task_name: 'Draft requirements', status: 'todo', assigned_to: 301 },
          { task_name: 'Review with team',   status: 'todo', assigned_to: 205 },
        ],
      },
      tags: { create: [{ title: 'Priority', color: '#ef4444' }] },
      comments: {
        create: [
          { author: 'System', message: 'Welcome to your seeded board!' },
        ],
      },
    },
  });

  // (Optional) another done card to show progress
  await prisma.card.create({
    data: {
      list_id: done.list_id,
      title: 'Kickoff meeting',
      description: 'Completed',
      position: 0,
    },
  });

  console.log('✅ Seed complete.');
  console.log('fkpoid:', fkpoid, 'fkboardid:', fkboardid);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
