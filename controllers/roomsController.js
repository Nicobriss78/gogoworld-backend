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
    const eventIdObj = new mongoose.Types.ObjectId(eventId);
    // Carica evento per titolo e finestra
    const ev = await Event.findById(eventId).lean();
    if (!ev) return res.status(404).json({ ok: false, error: "EVENT_NOT_FOUND" });
    // Evento privato: se manca o non coincide il codice, non creare/ritornare la room
    if (ev.isPrivate) {
      const provided = (req.body && typeof req.body.code === "string") ? req.body.code.trim() : "";
      const expected = (ev.accessCode || "").trim();
      if (!provided || !expected || provided !== expected) {
        // locked finché non viene fornito il codice corretto
        return res.json({
          ok: true,
          data: {
            locked: true,
        // opzionale: puoi mostrare titolo/durata senza roomId
        title: ev.title || "Evento privato",
      }
    });
  }
}
    // Calcola finestra chat (default: -48h / +24h)
   const startAt = new Date(ev.dateStart);
   const endAt = new Date(ev.dateEnd || ev.dateStart);
   const activeFrom = ev.approvedAt ? new Date(ev.approvedAt) : (ev.createdAt ? new Date(ev.createdAt) : new Date());
   const activeUntil = new Date(endAt.getTime() + 24 * 3600 * 1000);

    // Evento pubblico: stanza pubblica
    let room = await Room.findOne({ type: "event", eventId: eventIdObj }).lean();
    if (!room) {
      room = await Room.create({
        type: "event",
        eventId: eventIdObj,
        title: ev.title || "Chat evento",
        isPrivate: !!ev.isPrivate,
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
   const canSend = (!room.activeUntil || now <= new Date(room.activeUntil)) && !room.isArchived;

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
    const eventIdObj = new mongoose.Types.ObjectId(eventId);
    const room = await Room.findOne({ type: "event", eventId: eventIdObj }).lean();
    if (!room) return res.status(404).json({ ok: false, error: "ROOM_NOT_FOUND" });
// Carica evento per capire se è privato
    const ev = await Event.findById(eventIdObj).lean();
    // Se l'evento è privato e l'utente non è membro della room → locked, niente roomId
if (ev?.isPrivate) {
  const meId = req.user && req.user.id;
  if (!meId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
  const meMember = await RoomMember.findOne({ roomId: room._id, userId: meId }).lean();
  if (!meMember) {
    return res.json({
      ok: true,
      data: {
        locked: true,
        title: room.title
      }
    });
  }
}

    const now = new Date();
    const canSend = (!room.activeUntil || now <= new Date(room.activeUntil)) && !room.isArchived;
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
    const roomIdObj = new mongoose.Types.ObjectId(roomId);
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 50));
    const before = req.query.before ? new Date(req.query.before) : null;

    const find = { roomId: roomIdObj };
    if (before) find.createdAt = { $lt: before };

    const list = await RoomMessage.find(find).sort({ createdAt: -1 }).limit(limit).lean();

    // mark read (lastReadAt)
    await RoomMember.updateOne(
      { roomId: roomIdObj, userId: meId },
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
    if (room.activeUntil && now > new Date(room.activeUntil)) {
    return res.status(403).json({ ok: false, error: "SEND_WINDOW_CLOSED" });
    }

    const t = sanitizeText(req.body?.text || "");
    if (!t || t.length === 0 || t.length > 2000) return res.status(400).json({ ok: false, error: "INVALID_TEXT" });
    // Garantisci membership (serve per coerenza con lastReadAt/unread)
    await RoomMember.updateOne(
     { roomId: room._id, userId: meId },
     { $setOnInsert: { joinedAt: new Date() } },
     { upsert: true }
    );
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
    const roomIdObj = new mongoose.Types.ObjectId(roomId);
    const upTo = req.body?.upTo ? new Date(req.body.upTo) : new Date();
    await RoomMember.updateOne(
      { roomId: roomIdObj, userId: meId },
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

 // Membership dell'utente nella room (obbligatoria)
 {
 $lookup: {
 from: "roommembers",
 let: { roomId: "$_id" },
 pipeline: [
 {
 $match: {
 $expr: {
 $and: [
 { $eq: ["$roomId", "$$roomId"] },
 { $eq: ["$userId", new mongoose.Types.ObjectId(meId)] }
 ]
 }
 }
 },
 { $project: { lastReadAt: 1, _id: 0 } }
 ],
 as: "me"
 }
 },
 // Scarta room dove l'utente NON è membro
 { $unwind: { path: "$me", preserveNullAndEmptyArrays: false } },

 // Ultimo messaggio (senza caricare tutto l'array)
 {
 $lookup: {
 from: "roommessages",
 let: { roomId: "$_id" },
 pipeline: [
 { $match: { $expr: { $eq: ["$roomId", "$$roomId"] } } },
 { $sort: { createdAt: -1 } },
 { $limit: 1 },
 { $project: { createdAt: 1, _id: 0 } }
 ],
 as: "last"
 }
 },
 { $unwind: { path: "$last", preserveNullAndEmptyArrays: false } },

 { $project: { lastReadAt: "$me.lastReadAt", lastMsgAt: "$last.createdAt" } },

 // Non letti: nessun lastReadAt o lastReadAt < lastMsgAt
 {
 $match: {
 $expr: {
 $or: [
 { $eq: ["$lastReadAt", null] },
 { $lt: ["$lastReadAt", "$lastMsgAt"] }
 ]
 }
 }
 },

 { $count: "unread" }
 ];


    const rows = await Room.aggregate(pipeline);
    const unread = rows.length ? rows[0].unread : 0;
    return res.json({ ok: true, unread });
  } catch (err) {
    next(err);
  }
};
// --- GET /api/rooms/mine ---
// Elenca le chat evento dove l'utente è membro, ordinate per attività recente.
// Restituisce una shape compatibile con rooms.js (event: {_id, id, title}, activeUntil, ecc.)
exports.listMine = async (req, res, next) => {
  try {
    const meId = req.user && req.user.id;
    if (!meId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

    const meObj = new mongoose.Types.ObjectId(meId);

    // Pipeline: Room "event" non archiviate → membership del corrente → join con Event → proiezione shape
    const rows = await Room.aggregate([
      { $match: { type: "event", isArchived: false } },

      // membership corrente (RoomMember)
      {
        $lookup: {
          from: "roommembers",
          let: { roomId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$roomId", "$$roomId"] },
                    { $eq: ["$userId", meObj] }
                  ]
                }
              }
            },
            { $project: { _id: 0, lastReadAt: 1, joinedAt: 1 } }
          ],
          as: "me"
        }
      },
      // tieni solo le room dove esiste membership
      { $unwind: { path: "$me", preserveNullAndEmptyArrays: false } },

      // join evento per avere id e titolo
      {
        $lookup: {
          from: "events", // <- nome collection di Event (default Mongoose)
          localField: "eventId",
          foreignField: "_id",
          as: "ev"
        }
      },
      { $unwind: { path: "$ev", preserveNullAndEmptyArrays: true } },

      // ultimo messaggio per ordinare in modo "vivo"
      {
        $lookup: {
          from: "roommessages",
          let: { roomId: "$_id" },
          pipeline: [
            { $match: { $expr: { $eq: ["$roomId", "$$roomId"] } } },
            { $sort: { createdAt: -1 } },
            { $limit: 1 },
            { $project: { _id: 0, createdAt: 1 } }
          ],
          as: "last"
        }
      },
      { $unwind: { path: "$last", preserveNullAndEmptyArrays: true } },
// conteggio "unread" per stanza (messaggi con createdAt > lastReadAt dell'utente)
        {
          $lookup: {
            from: "roommessages",
            let: { roomId: "$_id", lr: "$mem.lastReadAt" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$roomId", "$$roomId"] },
                      { $gt: ["$createdAt", { $ifNull: ["$$lr", new Date(0)] }] }
                    ]
                  }
                }
              },
              // limite prudenziale per non caricare troppo in caso di stanze molto attive
              { $limit: 1000 },
              { $project: { _id: 1 } }
            ],
            as: "unreadArr"
          }
        },

      {
        $project: {
          _id: 1,
          title: { $ifNull: ["$title", { $ifNull: ["$ev.title", "Chat evento"] }] },
          activeFrom: 1,
          activeUntil: 1,
          // costruisci sotto-oggetto event compatibile con rooms.js
          event: {
            _id: "$ev._id",
            id: "$ev._id",
            title: "$ev.title"
          },
          unread: { $size: "$unreadArr" },
          lastAt: { $ifNull: ["$last.createdAt", "$updatedAt"] }
        }
      },

      { $sort: { lastAt: -1 } },
      { $limit: 50 }
    ]);

    return res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

// --- POST /api/rooms/event/:eventId/unlock ---
// Body: { code: "xxxxx" }
exports.unlockEvent = async (req, res, next) => {
  try {
    const meId = req.user && req.user.id;
    if (!meId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

    const { eventId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      return res.status(400).json({ ok: false, error: "INVALID_EVENT_ID" });
    }
    const eventIdObj = new mongoose.Types.ObjectId(eventId);

    const ev = await Event.findById(eventIdObj).lean();
    if (!ev) return res.status(404).json({ ok: false, error: "EVENT_NOT_FOUND" });

    // Evento pubblico: nessun codice richiesto (idempotente)
    if (!ev.isPrivate) {
      return res.json({ ok: true, data: { unlocked: true, reason: "PUBLIC_EVENT" } });
    }

    // Verifica codice
    const provided = (req.body && typeof req.body.code === "string") ? req.body.code.trim() : "";
    const expected = (ev.accessCode || "").trim();
    if (!provided || !expected || provided !== expected) {
      return res.status(403).json({ ok: false, error: "INVALID_CODE" });
    }

    // Assicurati che la room esista (privata)
    let room = await Room.findOne({ type: "event", eventId: eventIdObj }).lean();
    if (!room) {
      const startAt = new Date(ev.dateStart);
      const endAt = new Date(ev.dateEnd || ev.dateStart);
      const activeFrom = ev.chat?.activeFrom || new Date(startAt.getTime() - 48 * 3600 * 1000);
      const activeUntil = ev.chat?.activeUntil || new Date(endAt.getTime() + 24 * 3600 * 1000);
      room = await Room.create({
        type: "event",
        eventId: eventIdObj,
        title: ev.title || "Chat evento",
        isPrivate: true,
        isArchived: false,
        activeFrom,
        activeUntil,
        createdBy: ev.organizer || meId,
      });
      room = room.toObject();
    }

    // Upsert membership per l'utente
    await RoomMember.updateOne(
      { roomId: room._id, userId: meId },
      { $setOnInsert: { joinedAt: new Date() } },
      { upsert: true }
    );

    return res.json({
      ok: true,
      data: {
        unlocked: true,
        roomId: String(room._id),
        title: room.title
      }
    });
  } catch (err) {
    next(err);
  }
};
