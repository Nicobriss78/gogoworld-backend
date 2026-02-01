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

// Evento privato: accesso consentito solo a organizzatore o partecipanti
const isOrganizer =
  ev.organizer && String(ev.organizer) === String(meId);
const isParticipant =
  Array.isArray(ev.participants) &&
  ev.participants.some(p => String(p) === String(meId));

// Trattiamo come privato se visibility === "private"
const isPrivateEvent =
  String(ev.visibility || "").toLowerCase() === "private";
// ✅ BAN hard: se l'utente è revocato non può accedere (no locked, proprio 403)
const isRevoked =
  Array.isArray(ev.revokedUsers) &&
  ev.revokedUsers.some(u => String(u) === String(meId));

if (isPrivateEvent && isRevoked) {
  return res.status(403).json({ ok: false, error: "ACCESS_REVOKED" });
}
if (isPrivateEvent && !isOrganizer && !isParticipant) {
  // locked finché l'utente non ha aderito all'evento
  return res.json({
    ok: true,
    data: {
      locked: true,
      title: ev.title || "Evento privato",
    },
  });
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
// --- POST /api/rooms/dm/open-or-join ---
// Crea o riapre una chat privata (DM) tra l'utente corrente e targetUserId
exports.openOrJoinDM = async (req, res, next) => {
  try {
    const meId = req.user && req.user.id;
    if (!meId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

    const { targetUserId } = req.body || {};
    if (!targetUserId || !mongoose.Types.ObjectId.isValid(targetUserId)) {
      return res.status(400).json({ ok: false, error: "INVALID_TARGET" });
    }
    if (String(targetUserId) === String(meId)) {
      return res.status(400).json({ ok: false, error: "SELF_DM_NOT_ALLOWED" });
    }

    const meObj = new mongoose.Types.ObjectId(meId);
    const tgtObj = new mongoose.Types.ObjectId(targetUserId);

    // Normalizza la coppia (dmA = min, dmB = max)
    const [dmA, dmB] = String(meObj) < String(tgtObj) ? [meObj, tgtObj] : [tgtObj, meObj];

    // Cerca room DM esistente
    let room = await Room.findOne({ type: "dm", dmA, dmB }).lean();

    // Se non esiste, crea la room + membership
    if (!room) {
      const created = await Room.create({
        type: "dm",
        dmA,
        dmB,
        title: null,
        isPrivate: true,
        isArchived: false,
        createdBy: meObj,
      });
      room = created.toObject();

      // Crea/garantisci membership per entrambi (upsert-like semplice)
      await RoomMember.create([{ roomId: room._id, userId: dmA }, { roomId: room._id, userId: dmB }].map(x => ({
        roomId: x.roomId, userId: x.userId, lastReadAt: new Date()
      })));
    }

    // Peer = l'altro utente rispetto a me
    const peerId = String(room.dmA) === String(meObj) ? room.dmB : room.dmA;
    const peer = await (require("../models/userModel"))
      .findById(peerId)
      .select({ _id: 1, name: 1, "profile.avatarUrl": 1 })
      .lean();

    const peerOut = peer ? { _id: peer._id, name: peer.name, avatar: (peer.profile && peer.profile.avatarUrl) || null } : null;

    return res.json({
      ok: true,
      data: {
        roomId: room._id,
        type: "dm",
        peer: peerOut,
        canSend: true
      }
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
const isPrivateEvent =
  ev && String(ev.visibility || "").toLowerCase() === "private";

if (isPrivateEvent) {
  const meId = req.user && req.user.id;
  // ✅ BAN hard
  const isRevoked =
    Array.isArray(ev.revokedUsers) &&
    ev.revokedUsers.some(u => String(u) === String(meId));

  if (isRevoked) {
    return res.status(403).json({ ok: false, error: "ACCESS_REVOKED" });
  }

  const isOrganizer =
    ev.organizer && String(ev.organizer) === String(meId);
  const isParticipant =
    Array.isArray(ev.participants) &&
    ev.participants.some(p => String(p) === String(meId));

  if (!isOrganizer && !isParticipant) {
    return res.json({
      ok: true,
      data: {
        locked: true,
        title: ev.title || "Evento privato",
      },
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
    if (!isValidObjectId(roomId)) {
      return res.status(400).json({ ok: false, error: "INVALID_ROOM_ID" });
    }

    const room = await Room.findById(roomId).lean();
    if (!room || room.isArchived) {
      return res.status(403).json({ ok: false, error: "ROOM_CLOSED" });
    }

    // 🔒 Patch 1.2 – Blindare postMessage sulle room DM:
    // questa route deve gestire SOLO le room di tipo "event".
    // Le DM usano il controller dedicato /api/dm/...
    if (room.type !== "event") {
      return res.status(403).json({ ok: false, error: "ROOM_TYPE_NOT_ALLOWED" });
    }

    const now = new Date();
    if (room.activeUntil && now > new Date(room.activeUntil)) {
      return res.status(403).json({ ok: false, error: "SEND_WINDOW_CLOSED" });
    }

    const t = sanitizeText(req.body?.text || "");
    if (!t || t.length === 0 || t.length > 2000) {
      return res.status(400).json({ ok: false, error: "INVALID_TEXT" });
    }

    // Garantisci membership (serve per coerenza con lastReadAt/unread)
    await RoomMember.updateOne(
      { roomId: room._id, userId: meId },
      { $setOnInsert: { joinedAt: new Date() } },
      { upsert: true }
    );

    const doc = await RoomMessage.create({ roomId, sender: meId, text: t });

    return res.status(201).json({
      ok: true,
      data: {
        id: String(doc._id),
        createdAt: doc.createdAt,
        text: doc.text,
      },
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
// --- GET /api/rooms/unread-summary ---
// Per ciascuna room dell'utente ritorna: { _id: <roomId>, unread: <n> }
exports.getUnreadSummary = async (req, res, next) => {
  try {
    const meId = req.user && req.user.id;
    if (!meId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    const meObj = new mongoose.Types.ObjectId(meId);

    const pipeline = [
      { $match: { type: "event", isArchived: false } },

      // membership dell'utente nella room (obbligatoria)
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
            { $project: { _id: 0, lastReadAt: 1 } }
          ],
          as: "me"
        }
      },
      { $unwind: "$me" },

      // conteggio messaggi non letti
      {
        $lookup: {
          from: "roommessages",
          let: { roomId: "$_id", lr: "$me.lastReadAt" },
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
            { $limit: 1000 }, // safety cap per non gonfiare la risposta
            { $project: { _id: 1 } }
          ],
          as: "unreadArr"
        }
      },

      // shape minimale
      { $project: { _id: 1, unread: { $size: "$unreadArr" } } }
    ];

    const rows = await Room.aggregate(pipeline);
    return res.json({ ok: true, data: rows });
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
    const onlyActive = !!(req.query && (req.query.onlyActive === "1" || req.query.onlyActive === "true"));
    // Pipeline: Room "event" non archiviate → membership del corrente → join con Event → proiezione shape
      const pipeline = [
 { $match: { isArchived: false, type: { $in: ["event", "dm"] } } },

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
// individua l'altro membro (peer) SOLO per DM
      {
        $lookup: {
          from: "roommembers",
          let: { roomId: "$_id", me: meObj },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$roomId", "$$roomId"] },
                    { $ne: ["$userId", "$$me"] }
                  ]
                }
              }
            },
            { $limit: 1 },
            { $project: { _id: 0, userId: 1 } }
          ],
          as: "other"
        }
      },
      { $unwind: { path: "$other", preserveNullAndEmptyArrays: true } },

      // lookup utente peer (verrà nullo per le room "event")
      {
        $lookup: {
          from: "users",
          localField: "other.userId",
          foreignField: "_id",
          as: "peerUser"
        }
      },
      { $unwind: { path: "$peerUser", preserveNullAndEmptyArrays: true } },

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
            let: { roomId: "$_id", lr: "$me.lastReadAt" },
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
          type: 1,
          title: { $ifNull: ["$title", { $ifNull: ["$ev.title", "Chat evento"] }] },
          activeFrom: 1,
          activeUntil: 1,

          // "event" valorizzato solo per type:"event"
          event: {
            _id: { $cond: [{ $eq: ["$type", "event"] }, "$ev._id", null] },
            id: { $cond: [{ $eq: ["$type", "event"] }, "$ev._id", null] },
            title: { $cond: [{ $eq: ["$type", "event"] }, "$ev.title", null] }
          },

          // "peer" valorizzato solo per type:"dm"
          peer: {
            _id: { $cond: [{ $eq: ["$type", "dm"] }, "$peerUser._id", null] },
            name: { $cond: [{ $eq: ["$type", "dm"] }, "$peerUser.name", null] },
            avatar: { $cond: [{ $eq: ["$type", "dm"] }, "$peerUser.profile.avatarUrl", null] }
          },

          unread: { $size: "$unreadArr" },
          lastAt: { $ifNull: ["$last.createdAt", "$updatedAt"] }
        }
      },

      { $sort: { lastAt: -1 } },
      { $limit: 50 }
    ];
// Se richiesto, mostra solo le stanze "attive" (almeno un messaggio presente)
    if (onlyActive) {
      // Inserisci un $match subito dopo l'$unwind di "last"
      const idxUnwindLast = pipeline.findIndex(st => st && st.$unwind && st.$unwind.path === "$last");
      if (idxUnwindLast !== -1) {
        pipeline.splice(idxUnwindLast + 1, 0, { $match: { "last.createdAt": { $exists: true } } });
      }
    }

    const rows = await Room.aggregate(pipeline);
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
// ✅ BAN hard
const isRevoked =
  Array.isArray(ev.revokedUsers) &&
  ev.revokedUsers.some(u => String(u) === String(meId));

if (String(ev.visibility || "").toLowerCase() === "private" && isRevoked) {
  return res.status(403).json({ ok: false, error: "ACCESS_REVOKED" });
}
const isPrivateEvent =
  String(ev.visibility || "").toLowerCase() === "private";

// Evento pubblico: nessun codice richiesto (idempotente)
if (!isPrivateEvent) {
  return res.json({
    ok: true,
    data: { unlocked: true, reason: "PUBLIC_EVENT" },
  });
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
