require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');

const app = express();
const prisma = new PrismaClient();

const PORT = process.env.PORT || 4000;
const origins = (process.env.CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);

app.use(cors({
  origin: function(origin, cb) {
    if (!origin || origins.length === 0 || origins.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  },
  credentials: true
}));
app.use(express.json());

// ======= ROUTES =======

// GET /members  -> [{id, name}]
app.get('/members', async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: { user_id: true, name: true },
      orderBy: { user_id: 'asc' }
    });
    const data = users.map(u => ({ id: u.user_id, name: u.name }));
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to fetch members' });
  }
});

// GET /projects -> [{ id, name }]
app.get('/projects', async (req, res) => {
  try {
    const projects = await prisma.sqlProject.findMany({
      orderBy: { project_id: 'asc' },
      select: { project_id: true, project_name: true },
    });
    res.json(projects.map(p => ({ id: p.project_id, name: p.project_name })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to fetch projects' });
  }
});

// GET /projects/:fkpoid/boards -> BoardRow[]
app.get('/projects/:fkpoid/boards', async (req, res) => {
  const fkpoid = Number(req.params.fkpoid);
  try {
    const boards = await prisma.board.findMany({
      where: { project_id: fkpoid },
      orderBy: { created_at: 'desc' },
      include: {
        boardMembers: { include: { user: true } },
      }
    });

    const rows = boards.map(b => ({
      boardid: b.board_id,
      fkboardid: b.fkboardid,
      title: b.title,
      description: b.description || '',
      members: (b.boardMembers || []).map(m => ({ id: m.user_id, name: m.user.name })),
      status: b.status,
      progress: b.progress,
      createdAt: b.created_at.toISOString(),
      addedby: b.addedby,
      addedbyid: b.addedbyid,
      fkpoid: b.project_id,
    }));

    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to fetch boards' });
  }
});

// POST /boards -> create BoardRow (+ seed default lists)
app.post('/boards', async (req, res) => {
  const { projectName, fkpoid, addedbyid, addedby, description, memberIds } = req.body || {};
  if (!projectName || !fkpoid) return res.status(400).json({ error: 'projectName and fkpoid are required' });

  try {
    // ensure project exists (upsert by id)
    await prisma.sqlProject.upsert({
      where: { project_id: Number(fkpoid) },
      update: {},
      create: {
        project_id: Number(fkpoid),
        project_name: String(projectName),
        status: 'open'
      }
    });

    const created = await prisma.board.create({
      data: {
        project_id: Number(fkpoid),
        title: String(projectName),
        description: description ? String(description) : '',
        status: 'open',
        progress: 0,
        addedby: String(addedby || 'System'),
        addedbyid: Number(addedbyid || 0),
      }
    });

    // seed default lists
    const defaults = ['To-do', 'In-progress', 'Done'];
    for (let i = 0; i < defaults.length; i++) {
      await prisma.list.create({
        data: { board_id: created.board_id, list_name: defaults[i], position: i }
      });
    }

    // attach members if provided
    if (Array.isArray(memberIds) && memberIds.length) {
      await prisma.boardMember.createMany({
        data: memberIds.map(uid => ({ board_id: created.board_id, user_id: Number(uid) })),
        skipDuplicates: true,
      });
    }

    // re-fetch with members
    const withMembers = await prisma.board.findUnique({
      where: { board_id: created.board_id },
      include: { boardMembers: { include: { user: true } } }
    });

    const row = {
      boardid: withMembers.board_id,
      fkboardid: withMembers.fkboardid,
      title: withMembers.title,
      description: withMembers.description || '',
      members: (withMembers.boardMembers || []).map(m => ({ id: m.user_id, name: m.user.name })),
      status: withMembers.status,
      progress: withMembers.progress,
      createdAt: withMembers.created_at.toISOString(),
      addedby: withMembers.addedby,
      addedbyid: withMembers.addedbyid,
      fkpoid: withMembers.project_id,
    };

    res.json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to create board' });
  }
});

// PATCH /boards/:boardid  -> partial updates (title/description/memberIds/progress)
app.patch('/boards/:boardid', async (req, res) => {
  const boardid = Number(req.params.boardid);
  const { title, description, memberIds, progress } = req.body || {};
  try {
    const updates = {};
    if (typeof title === 'string') updates.title = title;
    if (typeof description === 'string') updates.description = description;
    if (typeof progress === 'number') updates.progress = progress;

    if (Object.keys(updates).length) {
      await prisma.board.update({ where: { board_id: boardid }, data: updates });
    }

    if (Array.isArray(memberIds)) {
      // replace membership
      await prisma.boardMember.deleteMany({ where: { board_id: boardid } });
      if (memberIds.length) {
        await prisma.boardMember.createMany({
          data: memberIds.map(uid => ({ board_id: boardid, user_id: Number(uid) })),
          skipDuplicates: true,
        });
      }
    }

    const b = await prisma.board.findUnique({
      where: { board_id: boardid },
      include: { boardMembers: { include: { user: true } } }
    });

    const row = {
      boardid: b.board_id,
      fkboardid: b.fkboardid,
      title: b.title,
      description: b.description || '',
      members: (b.boardMembers || []).map(m => ({ id: m.user_id, name: m.user.name })),
      status: b.status,
      progress: b.progress,
      createdAt: b.created_at.toISOString(),
      addedby: b.addedby,
      addedbyid: b.addedbyid,
      fkpoid: b.project_id,
    };

    res.json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to update board' });
  }
});

// DELETE /boards/:boardid
app.delete('/boards/:boardid', async (req, res) => {
  const boardid = Number(req.params.boardid);
  try {
    // cascade manually
    const lists = await prisma.list.findMany({ where: { board_id: boardid } });
    for (const l of lists) {
      const cards = await prisma.card.findMany({ where: { list_id: l.list_id } });
      for (const c of cards) {
        await prisma.task.deleteMany({ where: { card_id: c.card_id } });
        await prisma.tag.deleteMany({ where: { card_id: c.card_id } });
        await prisma.comment.deleteMany({ where: { card_id: c.card_id } });
      }
      await prisma.card.deleteMany({ where: { list_id: l.list_id } });
    }
    await prisma.list.deleteMany({ where: { board_id: boardid } });
    await prisma.boardMember.deleteMany({ where: { board_id: boardid } });
    await prisma.board.delete({ where: { board_id: boardid } });

    res.json({ deleted: boardid });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to delete board' });
  }
});

// health
app.get('/', (_, res) => res.send('kanban backend OK'));

app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
});
