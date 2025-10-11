// controllers/roomsController.js — C2.2 (event public)
const mongoose = require("mongoose");
const Room = require("../models/roomModel");
const RoomMessage = require("../models/roomMessageModel");
const RoomMember = require("../models/roomMemberModel");
const Event = require("../models/eventModel"); // esistente nel tuo progetto

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}
function sanitizeText(s) {
  if (typeof s !== "string") return "";
  return s.replace(/\s+/g, " ").trim();
}
function withinWindow(now, from, until) {
  if (from && now < new Date(from)) return false;
  if (until && now > new Date(until)) return false;
  return true;
}

// --- POST /api/rooms/event/:eventId/open-or-join ---
exports.openOrJoinEvent = async (req, res, next) => {
  try {
    const meId = req.user && req.user.id;
    if (!meId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

    const { eventId } = req.params;
    if (!isValidObjectId(eventId)) return res.status(400).json({ ok: false, error: "INVALID_EVENT_ID" });

    // Carica evento per titolo e finestra
    const ev = await Event.findById(eventId).lean();
    if (!ev) return res.status(404).json({ ok: false, error: "EVENT_NOT_FOUND" });

    // Calcola finestra chat (default: -48h / +24h)
    const startAt = new Date(ev.dateStart);
    const endAt = new Date(ev.dateEnd || ev.dateStart);
    const activeFrom = ev.chat?.activeFrom || new Date(startAt.getTime() - 48 * 3600 * 1000);
    const activeUntil = ev.chat?.activeUntil || new Date(endAt.getTime() + 24 * 3600 * 1000);

    // Evento pubblico: stanza pubblica
    let room = await Room.findOne({ type: "event", eventId }).lean();
    if (!room) {
      room = await Room.create({
        type: "event",
        eventId,
        title: ev.title || "Chat evento",
        isPrivate: false,
        isArchived: false,
        activeFrom,
        activeUntil,
        createdBy: ev.organizer || meId,
      });
      room = room.toObject();
    }

    // Upsert membro (serve per lastReadAt)
    await RoomMember.updateOne(
      { roomId: room._id, userId: meId },
      { $setOnInsert: { joinedAt: new Date() } },
      { upsert: true }
    );

    const now = new Date();
    const canSend = withinWindow(now, room.activeFrom, room.activeUntil) && !room.isArchived;

    return res.json({
      ok: true,
      data: {
        roomId: String(room._id),
        title: room.title,
        canSend,
        activeFrom: room.activeFrom,
        activeUntil: room.activeUntil,
        locked: false, // pubblico
      },
    });
  } catch (err) {
    next(err);
  }
};

// --- GET /api/rooms/event/:eventId ---
exports.getEventRoomMeta = async (req, res, next) => {
  try {
    const { eventId } = req.params;
    if (!isValidObjectId(eventId)) return res.status(400).json({ ok: false, error: "INVALID_EVENT_ID" });

    const room = await Room.findOne({ type: "event", eventId }).lean();
    if (!room) return res.status(404).json({ ok: false, error: "ROOM_NOT_FOUND" });

    const now = new Date();
    const canSend = withinWindow(now, room.activeFrom, room.activeUntil) && !room.isArchived;
    return res.json({
      ok: true,
      data: {
        roomId: String(room._id),
        title: room.title,
        canSend,
        activeFrom: room.activeFrom,
        activeUntil: room.activeUntil,
        locked: !!room.isPrivate,
      },
    });
  } catch (err) {
    next(err);
  }
};

// --- GET /api/rooms/:roomId/messages ---
exports.listMessages = async (req, res, next) => {
  try {
    const meId = req.user && req.user.id;
    if (!meId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

    const { roomId } = req.params;
    if (!isValidObjectId(roomId)) return res.status(400).json({ ok: false, error: "INVALID_ROOM_ID" });

    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 50));
    const before = req.query.before ? new Date(req.query.before) : null;

    const find = { roomId };
    if (before) find.createdAt = { $lt: before };

    const list = await RoomMessage.find(find).sort({ createdAt: -1 }).limit(limit).lean();

    // mark read (lastReadAt)
    await RoomMember.updateOne(
      { roomId, userId: meId },
      { $set: { lastReadAt: new Date() } },
      { upsert: true }
    );

    const data = list.map(m => ({
      id: String(m._id),
      text: m.text,
      createdAt: m.createdAt,
      sender: String(m.sender) === String(meId) ? "me" : "them",
    }));
    const nextBefore = list.length ? list[list.length - 1].createdAt.toISOString() : null;

    return res.json({ ok: true, data, nextBefore });
  } catch (err) {
    next(err);
  }
};

// --- POST /api/rooms/:roomId/messages ---
exports.postMessage = async (req, res, next) => {
  try {
    const meId = req.user && req.user.id;
    if (!meId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

    const { roomId } = req.params;
    if (!isValidObjectId(roomId)) return res.status(400).json({ ok: false, error: "INVALID_ROOM_ID" });

    const room = await Room.findById(roomId).lean();
    if (!room || room.isArchived) return res.status(403).json({ ok: false, error: "ROOM_CLOSED" });

    const now = new Date();
    if (!withinWindow(now, room.activeFrom, room.activeUntil)) {
      return res.status(403).json({ ok: false, error: "SEND_WINDOW_CLOSED" });
    }

    const t = sanitizeText(req.body?.text || "");
    if (!t || t.length === 0 || t.length > 2000) return res.status(400).json({ ok: false, error: "INVALID_TEXT" });

    const doc = await RoomMessage.create({ roomId, sender: meId, text: t });
    return res.status(201).json({
      ok: true,
      data: { id: String(doc._id), createdAt: doc.createdAt, text: doc.text },
    });
  } catch (err) {
    next(err);
  }
};

// --- POST /api/rooms/:roomId/read ---
exports.markRead = async (req, res, next) => {
  try {
    const meId = req.user && req.user.id;
    if (!meId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    const { roomId } = req.params;
    if (!isValidObjectId(roomId)) return res.status(400).json({ ok: false, error: "INVALID_ROOM_ID" });

    const upTo = req.body?.upTo ? new Date(req.body.upTo) : new Date();
    await RoomMember.updateOne(
      { roomId, userId: meId },
      { $set: { lastReadAt: upTo } },
      { upsert: true }
    );
    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};

// --- GET /api/rooms/unread-count ---
exports.getRoomsUnreadCount = async (req, res, next) => {
  try {
    const meId = req.user && req.user.id;
    if (!meId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

    // Conta le room dove esiste almeno un messaggio più recente del lastReadAt (o nessun lastReadAt)
    const pipeline = [
      { $match: { type: "event", isArchived: false } },
      {
        $lookup: {
          from: "roommembers",
          let: { roomId: "$_id" },
          pipeline: [
            { $match: { $expr: { $and: [ { $eq: ["$roomId", "$$roomId"] }, { $eq: ["$userId", new mongoose.Types.ObjectId(meId)] } ] } } },
            { $project: { lastReadAt: 1, _id: 0 } }
          ],
          as: "me"
        }
      },
      {
        $lookup: {
          from: "roommessages",
          localField: "_id",
          foreignField: "roomId",
          as: "msgs"
        }
      },
      { $project: { me: { $first: "$me" }, lastMsgAt: { $max: "$msgs.createdAt" } } },
      { $match: { $expr: { $and: [ { $ne: ["$lastMsgAt", null] }, { $or: [ { $eq: ["$me.lastReadAt", null] }, { $lt: ["$me.lastReadAt", "$lastMsgAt"] } ] } ] } } },
      { $count: "unread" }
    ];

    const rows = await Room.aggregate(pipeline);
    const unread = rows.length ? rows[0].unread : 0;
    return res.json({ ok: true, unread });
  } catch (err) {
    next(err);
  }
};
