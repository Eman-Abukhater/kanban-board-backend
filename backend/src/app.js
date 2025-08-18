require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
//  configure multer for file uploads
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 4000;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL?.replace(/\/+$/,'') || `http://localhost:${PORT}`;function toPublicUrl(p) {
  if (!p) return null;
  if (p.startsWith('http://') || p.startsWith('https://')) return p;
  return `${PUBLIC_BASE_URL}${p.startsWith('/') ? p : `/${p}`}`;
}

const prisma = new PrismaClient();

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
      imageUrl: created.image_url ? `${PUBLIC_BASE_URL}${created.image_url}` : null
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
const uploadAny = upload.fields([
  { name: 'uploadImage', maxCount: 1 },
  { name: 'image',       maxCount: 1 },
  { name: 'file',        maxCount: 1 },
]);

app.put('/cards/:cardId', uploadAny, async (req, res) => {
  const { cardId } = req.params;
  const { title, desc, startDate, endDate, completed } = req.body || {};
  const file = (req.files?.uploadImage?.[0]) || (req.files?.image?.[0]) || (req.files?.file?.[0]) || null;

  try {
    const current = await prisma.card.findUnique({ where: { card_id: cardId } });
    if (!current) return res.status(404).json({ error: 'card not found' });

    const data = {};
    if (typeof title === 'string') data.title = title;
    if (typeof desc === 'string') data.description = desc;
    if (typeof startDate === 'string') data.start_date = startDate ? new Date(startDate) : null;
    if (typeof endDate === 'string')   data.end_date   = endDate   ? new Date(endDate)   : null;

    if (file) {
      data.image_url = `/uploads/${file.filename}`;
      if (current.image_url?.startsWith('/uploads/')) {
        const oldFsPath = path.join(UPLOAD_DIR, path.basename(current.image_url));
        fs.promises.unlink(oldFsPath).catch(() => {});
      }
    }

    const updated = await prisma.card.update({ where: { card_id: cardId }, data });

    if (typeof completed === 'string') {
      await prisma.task.updateMany({
        where: { card_id: cardId },
        data: { status: completed === 'true' ? 'done' : 'todo' },
      });
    }

    res.json({
      card_id: updated.card_id,
      list_id: updated.list_id,
      title: updated.title,
      description: updated.description || '',
      position: updated.position,
      imageUrl: updated.image_url ? `${PUBLIC_BASE_URL}${updated.image_url}` : null,
      startDate: updated.start_date ? updated.start_date.toISOString() : null,
      endDate:   updated.end_date   ? updated.end_date.toISOString()   : null,
    });
  } catch (e) {
    if (e.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'file too large' });
    console.error(e);
    res.status(500).json({ error: 'failed to edit card' });
  }
});

// ---------- TASKS ----------
/**
 * POST /cards/:cardId/tasks
 * body: { title: string, assigneeId?: number }
 * returns: Task { task_id, task_name, status, assigneeId }
 */
app.post('/cards/:cardId/tasks', async (req, res) => {
  const { cardId } = req.params;
  const { title, assigneeId } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title is required' });

  try {
    const created = await prisma.task.create({
      data: {
        card_id: cardId,
        task_name: String(title),
        status: 'todo',
        assigned_to: Number.isFinite(Number(assigneeId)) ? Number(assigneeId) : null,
      }
    });
    res.json({
      task_id: created.task_id,
      task_name: created.task_name,
      status: created.status === 'done' ? 'done' : 'todo',
      assigneeId: created.assigned_to ?? undefined,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to add task' });
  }
});

/**
 * PATCH /tasks/:taskId
 * body: { completed: boolean }
 * returns: Task
 */
app.patch('/tasks/:taskId', async (req, res) => {
  const { taskId } = req.params;
  const { completed } = req.body || {};
  try {
    const updated = await prisma.task.update({
      where: { task_id: taskId },
      data: { status: completed ? 'done' : 'todo' }
    });
    res.json({
      task_id: updated.task_id,
      task_name: updated.task_name,
      status: updated.status === 'done' ? 'done' : 'todo',
      assigneeId: updated.assigned_to ?? undefined,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to update task' });
  }
});

/**
 * DELETE /tasks/:taskId
 */
app.delete('/tasks/:taskId', async (req, res) => {
  const { taskId } = req.params;
  try {
    await prisma.task.delete({ where: { task_id: taskId } });
    res.json({ deleted: taskId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to delete task' });
  }
});

// ---------- TAGS ----------
/**
 * POST /cards/:cardId/tags
 * body: { title: string, color?: string }
 */
app.post('/cards/:cardId/tags', async (req, res) => {
  const { cardId } = req.params;
  const { title, color } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title is required' });

  try {
    const created = await prisma.tag.create({
      data: { card_id: cardId, title: String(title), color: color ? String(color) : null }
    });
    res.json({ id: created.tag_id, title: created.title, color: created.color || undefined });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to add tag' });
  }
});

/**
 * DELETE /tags/:tagId
 */
app.delete('/tags/:tagId', async (req, res) => {
  const { tagId } = req.params;
  try {
    await prisma.tag.delete({ where: { tag_id: tagId } });
    res.json({ deleted: tagId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to delete tag' });
  }
});

// ---------- COMMENTS ----------
/**
 * POST /cards/:cardId/comments
 * body: { author: string, message: string }
 */
app.post('/cards/:cardId/comments', async (req, res) => {
  const { cardId } = req.params;
  const { author, message } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message is required' });

  try {
    const created = await prisma.comment.create({
      data: {
        card_id: cardId,
        author: (author || 'Anonymous').toString(),
        message: String(message),
      }
    });
    res.json({
      id: created.comment_id,
      author: created.author,
      message: created.message,
      createdAt: created.created_at.toISOString(),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to add comment' });
  }
});


// POST /cards/:cardId/comments  body: { author, message }
app.post('/cards/:cardId/comments', async (req, res) => {
  const { cardId } = req.params;
  const { author, message } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message is required' });

  try {
    const created = await prisma.comment.create({
      data: {
        card_id: cardId,
        author: (author || 'Anonymous').toString(),
        message: String(message),
      }
    });
    res.json({
      id: created.comment_id,
      author: created.author,
      message: created.message,
      createdAt: created.created_at.toISOString(),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to add comment' });
  }
});

// GET /boards/:fkboardid/share -> returns a path you can share
app.get('/boards/:fkboardid/share', async (req, res) => {
  const { fkboardid } = req.params;
  const board = await prisma.board.findUnique({ where: { fkboardid } });
  if (!board) return res.status(404).json({ error: 'board not found' });
  // You can make this a signed token in future; for now just return the public view path
  res.json({ link: `/kanbanList/${fkboardid}?view=public` });
});
// PATCH /boards/:fkboardid/close
app.patch('/boards/:fkboardid/close', async (req, res) => {
  const { fkboardid } = req.params;
  try {
    const board = await prisma.board.findUnique({
      where: { fkboardid },
      include: {
        lists: {
          include: { cards: { include: { tasks: true } } }
        }
      }
    });
    if (!board) return res.status(404).json({ error: 'board not found' });

    // recompute progress = % of cards in "Done"
    const lists = board.lists.map(l => ({
      name: l.list_name.trim().toLowerCase(),
      cards: l.cards
    }));
    const totalCards = lists.reduce((n, l) => n + l.cards.length, 0);
    const doneList = lists.find(l => l.name === 'done');
    const progress = totalCards ? Math.round(((doneList?.cards.length || 0) / totalCards) * 100) : 0;

    if (progress < 100) {
      return res.status(400).json({ error: 'board not 100% complete', progress });
    }

    const updated = await prisma.board.update({
      where: { fkboardid },
      data: { status: 'closed', progress: 100 }
    });

    res.json({ status: updated.status, progress: updated.progress });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to close board' });
  }
});

// serve uploaded files
app.use('/uploads', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
}, express.static(UPLOAD_DIR));


// health
app.get('/', (_, res) => res.send('kanban backend OK'));

app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
});
