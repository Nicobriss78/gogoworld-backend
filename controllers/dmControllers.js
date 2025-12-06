// controllers/dmControllers.js — C2 DM (MVP testo)
const mongoose = require("mongoose");
const Message = require("../models/messageModel");
const User = require("../models/userModel");

// ---------- Utils ----------
function threadKeyFor(a, b) {
  const A = String(a), B = String(b);
  return A < B ? `${A}-${B}` : `${B}-${A}`;
}
function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}
function sanitizeText(s) {
  if (typeof s !== "string") return "";
  return s.replace(/\s+/g, " ").trim();
}
function privacyBlocks(sender, recipientUser) {
  // Blocchi privacy del destinatario (MVP) + blocklist aggiornata
  const prof = (recipientUser.profile || {});
  const p = prof.privacy || {};
  const senderId = String(sender);

  // 1) Opt-in globale
  if (!p.optInDM) return "DM_NOT_ALLOWED";

  // 2) Sorgenti consentite
  if (p.dmsFrom === "nobody") {
    return "DM_NOT_ALLOWED";
  }

  if (p.dmsFrom === "followers") {
    // Consenti DM solo se il mittente è tra i follower o tra i seguiti
    const followers = Array.isArray(recipientUser.followers)
      ? recipientUser.followers.map(String)
      : [];
    const following = Array.isArray(recipientUser.following)
      ? recipientUser.following.map(String)
      : [];

    const allowed =
      followers.includes(senderId) || following.includes(senderId);

    if (!allowed) {
      return "DM_NOT_ALLOWED";
    }
  }

  // 3) Blocklist del destinatario (campo blockedUsers su User)
  try {
    const blocked = Array.isArray(recipientUser.blockedUsers)
      ? recipientUser.blockedUsers.map(String)
      : [];
    if (blocked.includes(senderId)) {
      return "BLOCKED_BY_USER";
    }
  } catch {}

  return null;
}



// ---------- POST /api/dm/messages ----------
exports.sendMessage = async (req, res, next) => {
  try {
    const meId = req.user && req.user.id;
    if (!meId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

    const { recipientId, text } = req.body || {};
    if (!isValidObjectId(recipientId)) {
      return res.status(400).json({ ok: false, error: "INVALID_RECIPIENT" });
    }
    if (String(recipientId) === String(meId)) {
      return res.status(400).json({ ok: false, error: "CANNOT_MESSAGE_SELF" });
    }

    const recipient = await User.findById(recipientId).lean();
    if (!recipient) return res.status(404).json({ ok: false, error: "USER_NOT_FOUND" });
    if (recipient.isBanned) return res.status(403).json({ ok: false, error: "RECIPIENT_UNAVAILABLE" });

    // Privacy enforcement (MVP rules confermate)
    const pErr = privacyBlocks(meId, recipient);
    if (pErr) return res.status(403).json({ ok: false, error: pErr });

    const t = sanitizeText(text);
    if (!t || t.length === 0 || t.length > 2000) {
      return res.status(400).json({ ok: false, error: "INVALID_TEXT" });
    }

    const tk = threadKeyFor(meId, recipientId);
    const doc = await Message.create({
      threadKey: tk,
      sender: meId,
      recipient: recipientId,
      text: t,
    });

    return res.status(201).json({
      ok: true,
      data: {
        id: String(doc._id),
        threadKey: doc.threadKey,
        createdAt: doc.createdAt,
        text: doc.text,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------- GET /api/dm/threads ----------
exports.listThreads = async (req, res, next) => {
  try {
    const meId = req.user && req.user.id;
    if (!meId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

    const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 20));
    const cursor = req.query.cursor ? new Date(req.query.cursor) : null;

    // Aggregation: trova gli ultimi messaggi per thread dove partecipa meId
    const matchBase = {
      $or: [{ sender: new mongoose.Types.ObjectId(meId) }, { recipient: new mongoose.Types.ObjectId(meId) }],
      ...(cursor ? { createdAt: { $lt: cursor } } : {}),
    };

    const pipeline = [
      { $match: matchBase },
      { $sort: { createdAt: -1 } },
      // pick last message per threadKey
      {
        $group: {
          _id: "$threadKey",
          last: { $first: "$$ROOT" },
          // conteggio non letti dove recipient = me e readAt = null
          unread: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ["$recipient", new mongoose.Types.ObjectId(meId)] }, { $eq: ["$readAt", null] }] },
                1, 0
              ]
            }
          }
        }
      },
      { $sort: { "last.createdAt": -1 } },
      { $limit: limit },
    ];

    const rows = await Message.aggregate(pipeline);

    // Arricchisci con dati utente "other"
    const out = [];
    for (const r of rows) {
      const last = r.last;
      const [idA, idB] = r._id.split("-");
      const otherId = (idA === String(meId)) ? idB : idA;

      const other = await User.findById(otherId).lean();
      out.push({
        threadKey: r._id,
        user: other ? {
          id: String(other._id),
          nickname: other.profile?.nickname || null,
          avatarUrl: other.profile?.avatarUrl || null,
        } : { id: otherId },
        last: {
          text: last.text,
          createdAt: last.createdAt,
          sender: String(last.sender) === String(meId) ? "me" : "them",
        },
        unread: r.unread || 0,
      });
    }

    const nextCursor = rows.length ? rows[rows.length - 1].last.createdAt.toISOString() : null;
    return res.json({ ok: true, data: out, nextCursor });
  } catch (err) {
    next(err);
  }
};

// ---------- GET /api/dm/threads/:userId/messages ----------
exports.listMessages = async (req, res, next) => {
  try {
    const meId = req.user && req.user.id;
    if (!meId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

    const { userId } = req.params;
    if (!isValidObjectId(userId)) return res.status(400).json({ ok: false, error: "INVALID_USER_ID" });

    const tk = threadKeyFor(meId, userId);
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 30));
    const before = req.query.before ? new Date(req.query.before) : null;

    const findQuery = { threadKey: tk };
    if (before) findQuery.createdAt = { $lt: before };

    const list = await Message.find(findQuery)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    // Mark as read (i messaggi entranti senza readAt)
    const toMark = list
      .filter(m => String(m.recipient) === String(meId) && !m.readAt)
      .map(m => m._id);

    if (toMark.length) {
      await Message.updateMany(
        { _id: { $in: toMark } },
        { $set: { readAt: new Date() } }
      );
    }

    // Mappa per FE
    const data = list.map(m => ({
      id: String(m._id),
      text: m.text,
      createdAt: m.createdAt,
      sender: String(m.sender) === String(meId) ? "me" : "them",
      readAt: m.readAt || null,
    }));

    const nextBefore = list.length ? list[list.length - 1].createdAt.toISOString() : null;
    return res.json({ ok: true, data, nextBefore });
  } catch (err) {
    next(err);
  }
};

// ---------- POST /api/dm/threads/:userId/read ----------
exports.markRead = async (req, res, next) => {
  try {
    const meId = req.user && req.user.id;
    if (!meId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

    const { userId } = req.params;
    if (!isValidObjectId(userId)) return res.status(400).json({ ok: false, error: "INVALID_USER_ID" });
    const upTo = req.body && req.body.upTo ? new Date(req.body.upTo) : new Date();

    const tk = threadKeyFor(meId, userId);
    const r = await Message.updateMany(
      { threadKey: tk, recipient: meId, readAt: null, createdAt: { $lte: upTo } },
      { $set: { readAt: new Date() } }
    );

    return res.json({ ok: true, updated: r.modifiedCount || 0 });
  } catch (err) {
    next(err);
  }
};

// ---------- GET /api/dm/unread-count ----------
exports.getUnreadCount = async (req, res, next) => {
  try {
    const meId = req.user && req.user.id;
    if (!meId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

    const n = await Message.countDocuments({ recipient: meId, readAt: null });
    return res.json({ ok: true, unread: n });
  } catch (err) {
    next(err);
  }
};
