require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
//  configure multer for file uploads
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const app = express();
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
function toPublicUrl(p) {
  if (!p) return null;
  if (p.startsWith('http://') || p.startsWith('https://')) return p;
  return `${PUBLIC_BASE_URL}${p.startsWith('/') ? p : `/${p}`}`;
}

const prisma = new PrismaClient();

const PORT = process.env.PORT || 4000;
const origins = (process.env.CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);


const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

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

// Kanabn API 
// GET /boards/:fkboardid/kanban  -> { lists, board: { title, fkboardid, status }, progress }
app.get('/boards/:fkboardid/kanban', async (req, res) => {
  const { fkboardid } = req.params;
  try {
    const board = await prisma.board.findUnique({
      where: { fkboardid },
      include: {
        lists: {
          orderBy: { position: 'asc' },
          include: {
            cards: {
              orderBy: { position: 'asc' },
              include: { tasks: true, tags: true, comments: true }
            }
          }
        }
      }
    });
    if (!board) return res.status(404).json({ error: 'board not found' });

    const lists = board.lists.map(l => ({
      list_id: l.list_id,
      list_name: l.list_name,
      position: l.position,
      cards: l.cards.map(c => ({
        card_id: c.card_id,
        list_id: l.list_id,
        title: c.title,
        description: c.description || '',
        position: c.position,
        imageUrl: toPublicUrl(c.image_url) || null,
        startDate: c.start_date ? c.start_date.toISOString() : null,
        endDate: c.end_date ? c.end_date.toISOString() : null,
        tasks: (c.tasks || []).map(t => ({
          task_id: t.task_id,
          task_name: t.task_name,
          status: t.status === 'done' ? 'done' : 'todo',
          assigneeId: t.assigned_to ?? undefined,
        })),
        tags: (c.tags || []).map(t => ({ id: t.tag_id, title: t.title, color: t.color || undefined })),
        comments: (c.comments || []).map(cm => ({
          id: cm.comment_id,
          author: cm.author,
          message: cm.message,
          createdAt: cm.created_at.toISOString(),
        })),
      })),
    }));

    // simple progress = % of cards in "Done"
    const totalCards = lists.reduce((n, l) => n + l.cards.length, 0);
    const done = lists.find(l => l.list_name.trim().toLowerCase() === 'done');
    const progress = totalCards ? Math.round(((done?.cards.length || 0) / totalCards) * 100) : 0;

    res.json({ lists, board: { title: board.title, fkboardid: board.fkboardid, status: board.status }, progress });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to load kanban' });
  }
});

// POST /boards/:fkboardid/lists  body: { list_name }
app.post('/boards/:fkboardid/lists', async (req, res) => {
  const { fkboardid } = req.params;
  const { list_name } = req.body || {};
  if (!list_name) return res.status(400).json({ error: 'list_name required' });
  try {
    const board = await prisma.board.findUnique({ where: { fkboardid } });
    if (!board) return res.status(404).json({ error: 'board not found' });

    const count = await prisma.list.count({ where: { board_id: board.board_id } });
    const created = await prisma.list.create({
      data: { board_id: board.board_id, list_name: String(list_name), position: count }
    });
    res.json({ list_id: created.list_id, list_name: created.list_name, position: created.position, cards: [] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to add list' });
  }
});
// DELETE /lists/:listId
app.delete('/lists/:listId', async (req, res) => {
  const { listId } = req.params;
  try {
    // delete list -> cards -> subtables
    const cards = await prisma.card.findMany({ where: { list_id: listId } });
    for (const c of cards) {
      await prisma.task.deleteMany({ where: { card_id: c.card_id } });
      await prisma.tag.deleteMany({ where: { card_id: c.card_id } });
      await prisma.comment.deleteMany({ where: { card_id: c.card_id } });
    }
    await prisma.card.deleteMany({ where: { list_id: listId } });
    const deleted = await prisma.list.delete({ where: { list_id: listId } });

    // reindex positions on the board
    const lists = await prisma.list.findMany({
      where: { board_id: deleted.board_id }, orderBy: { position: 'asc' }
    });
    for (let i = 0; i < lists.length; i++) {
      if (lists[i].position !== i) {
        await prisma.list.update({ where: { list_id: lists[i].list_id }, data: { position: i } });
      }
    }
    res.json({ deleted: listId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to delete list' });
  }
});

// POST /lists/:listId/cards  body: { title }
app.post('/lists/:listId/cards', async (req, res) => {
  const { listId } = req.params;
  const { title } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title required' });
  try {
    const count = await prisma.card.count({ where: { list_id: listId } });
    const created = await prisma.card.create({
      data: {
        list_id: listId,
        title: String(title),
        position: count,
      }
    });
    res.json({
      card_id: created.card_id, list_id: created.list_id, title: created.title,
      description: created.description || '', position: created.position,
      imageUrl: created.image_url || null, tasks: [], startDate: null, endDate: null, tags: [], comments: []
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to add card' });
  }
});

// DELETE /cards/:cardId
app.delete('/cards/:cardId', async (req, res) => {
  const { cardId } = req.params;
  try {
    await prisma.task.deleteMany({ where: { card_id: cardId } });
    await prisma.tag.deleteMany({ where: { card_id: cardId } });
    await prisma.comment.deleteMany({ where: { card_id: cardId } });
    const deleted = await prisma.card.delete({ where: { card_id: cardId } });

    // reindex positions in that list
    const cards = await prisma.card.findMany({
      where: { list_id: deleted.list_id }, orderBy: { position: 'asc' }
    });
    for (let i = 0; i < cards.length; i++) {
      if (cards[i].position !== i) {
        await prisma.card.update({ where: { card_id: cards[i].card_id }, data: { position: i } });
      }
    }
    res.json({ deleted: cardId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to delete card' });
  }
});

// PATCH /lists/reorder  body: { board_id, from_list_id, to_list_id, from_index, to_index }
app.patch('/lists/reorder', async (req, res) => {
  const { board_id, from_list_id, to_list_id, from_index, to_index } = req.body || {};
  try {
    const lists = await prisma.list.findMany({ where: { board_id }, orderBy: { position: 'asc' } });
    const from = lists.findIndex(l => l.list_id === from_list_id);
    const to   = lists.findIndex(l => l.list_id === to_list_id);
    if (from === -1 || to === -1) return res.status(404).json({ error: 'list not found' });

    const arr = [...lists];
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);

    for (let i = 0; i < arr.length; i++) {
      if (arr[i].position !== i) {
        await prisma.list.update({ where: { list_id: arr[i].list_id }, data: { position: i } });
      }
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to reorder lists' });
  }
});

// PATCH /cards/move  body: { card_id, source_list_id, dest_list_id, source_index, dest_index }
app.patch('/cards/move', async (req, res) => {
  const { card_id, source_list_id, dest_list_id, source_index, dest_index } = req.body || {};
  try {
    // move card list_id
    await prisma.card.update({ where: { card_id }, data: { list_id: dest_list_id } });

    // reindex both lists
    const src = await prisma.card.findMany({ where: { list_id: source_list_id }, orderBy: { position: 'asc' } });
    for (let i = 0; i < src.length; i++) {
      await prisma.card.update({ where: { card_id: src[i].card_id }, data: { position: i } });
    }
    const dst = await prisma.card.findMany({ where: { list_id: dest_list_id }, orderBy: { position: 'asc' } });
    for (let i = 0; i < dst.length; i++) {
      await prisma.card.update({ where: { card_id: dst[i].card_id }, data: { position: i } });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to move card' });
  }
});

// PUT /cards/:cardId  (multipart/form-data)
// fields: title, desc, startDate, endDate, completed ("true"/"false"), fkboardid, listid
app.put('/cards/:cardId', upload.single('uploadImage'), async (req, res) => {
  const { cardId } = req.params;
  const { title, desc, startDate, endDate, completed } = req.body || {};
  const file = req.file; // optional

  try {
    const data = {};
    if (typeof title === 'string') data.title = title;
    if (typeof desc === 'string') data.description = desc;
    if (typeof startDate === 'string' && startDate) data.start_date = new Date(startDate);
    else if (startDate === '') data.start_date = null;
    if (typeof endDate === 'string' && endDate) data.end_date = new Date(endDate);
    else if (endDate === '') data.end_date = null;
    if (file) data.image_url = `/uploads/${file.filename}`;

    const updated = await prisma.card.update({ where: { card_id: cardId }, data });

    // completed -> mark all subtasks done/undo
    if (typeof completed === 'string') {
      const isDone = completed === 'true';
      const tasks = await prisma.task.findMany({ where: { card_id: cardId } });
      for (const t of tasks) {
        await prisma.task.update({ where: { task_id: t.task_id }, data: { status: isDone ? 'done' : 'todo' } });
      }
    }

    res.json({
      card_id: updated.card_id,
      list_id: updated.list_id,
      title: updated.title,
      description: updated.description || '',
      position: updated.position,
      imageUrl: toPublicUrl(updated.image_url) || null,
      startDate: updated.start_date ? updated.start_date.toISOString() : null,
      endDate: updated.end_date ? updated.end_date.toISOString() : null
    });
  } catch (e) {
    if (e.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'file too large' });
    console.error(e);
    res.status(500).json({ error: 'failed to edit card' });
  }
});

// serve uploaded files
app.use('/uploads', express.static(UPLOAD_DIR));


// health
app.get('/', (_, res) => res.send('kanban backend OK'));

app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
});
