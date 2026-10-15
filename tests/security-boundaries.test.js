const test = require("node:test");
const assert = require("node:assert/strict");

const Event = require("../models/eventModel");
const User = require("../models/userModel");
const Room = require("../models/roomModel");
const RoomMember = require("../models/roomMemberModel");
const eventController = require("../controllers/eventController");
const roomsController = require("../controllers/roomsController");
const { computeEventStatus } = require("../utils/eventStatus");

function createResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return body;
    },
  };
}

function restoreAfter(t, target, key, original) {
  t.after(() => {
    target[key] = original;
  });
}

test("following list ignores privacy overrides and returns only a safe DTO", async (t) => {
  const viewerId = "64b000000000000000000001";
  const organizerId = "64b000000000000000000002";
  const originalUserFindById = User.findById;
  const originalEventFind = Event.find;
  restoreAfter(t, User, "findById", originalUserFindById);
  restoreAfter(t, Event, "find", originalEventFind);

  User.findById = () => ({
    select: () => ({
      lean: async () => ({ following: [organizerId] }),
    }),
  });

  let capturedFilters;
  let capturedProjection;
  const rawEvent = {
    _id: "64b000000000000000000003",
    title: "Evento seguito",
    category: "music",
    city: "Potenza",
    region: "Basilicata",
    country: "IT",
    dateStart: new Date(Date.now() + 48 * 60 * 60 * 1000),
    dateEnd: new Date(Date.now() + 50 * 60 * 60 * 1000),
    organizer: { _id: organizerId, name: "Organizer sicuro" },
    participants: [viewerId, "64b000000000000000000004"],
    accessCode: "SECRET-CODE",
    revokedUsers: ["64b000000000000000000005"],
    moderation: { notes: "internal" },
    approvalStatus: "pending",
    visibility: "private",
  };

  Event.find = (filters) => {
    capturedFilters = filters;
    return {
      select(projection) {
        capturedProjection = projection;
        return this;
      },
      populate() {
        return this;
      },
      async sort() {
        return [{ toObject: () => ({ ...rawEvent }) }];
      },
    };
  };

  const req = {
    user: { _id: viewerId },
    query: { visibility: "private", approvalStatus: "pending" },
  };
  const res = createResponse();
  let nextError;

  await eventController.listFollowingEvents(req, res, (error) => {
    nextError = error;
  });

  assert.equal(nextError, undefined);
  assert.equal(capturedFilters.visibility, undefined);
  assert.equal(capturedFilters.approvalStatus, "approved");
  assert.deepEqual(capturedFilters.organizer, { $in: [organizerId] });
  assert.deepEqual(capturedFilters.$or, [
    { visibility: "public" },
    { visibility: "private", participants: viewerId },
  ]);
  assert.match(capturedProjection, /organizer/);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.events.length, 1);
  const output = res.body.events[0];
  assert.equal(output.organizer._id, organizerId);
  assert.equal(output.organizer.name, "Organizer sicuro");
  assert.equal(output.joined, true);
  assert.equal(output.isJoined, true);
  assert.equal("participants" in output, false);
  assert.equal("accessCode" in output, false);
  assert.equal("revokedUsers" in output, false);
  assert.equal("moderation" in output, false);
  assert.equal("approvalStatus" in output, false);
});

test("event status preserves every existing lifecycle state", () => {
  const now = new Date("2026-10-15T04:00:00.000Z");
  const future = {
    dateStart: new Date("2026-10-20T10:00:00.000Z"),
    dateEnd: new Date("2026-10-20T12:00:00.000Z"),
  };
  const imminent = {
    dateStart: new Date("2026-10-16T10:00:00.000Z"),
    dateEnd: new Date("2026-10-16T12:00:00.000Z"),
  };
  const ongoing = {
    dateStart: new Date("2026-10-15T03:00:00.000Z"),
    dateEnd: new Date("2026-10-15T05:00:00.000Z"),
  };
  const concluded = {
    dateStart: new Date("2026-10-14T19:00:00.000Z"),
    dateEnd: new Date("2026-10-14T22:00:00.000Z"),
  };
  const past = {
    dateStart: new Date("2026-10-14T10:00:00.000Z"),
    dateEnd: new Date("2026-10-14T14:00:00.000Z"),
  };

  assert.equal(computeEventStatus(future, now), "future");
  assert.equal(computeEventStatus(imminent, now), "imminent");
  assert.equal(computeEventStatus(ongoing, now), "ongoing");
  assert.equal(computeEventStatus(concluded, now), "concluded");
  assert.equal(computeEventStatus(past, now), "past");
  assert.equal(computeEventStatus({}, now), "future");
});

test("room unlock rejects a past event before every mutation", async (t) => {
  const eventId = "64b000000000000000000010";
  const userId = "64b000000000000000000011";
  const originalFindById = Event.findById;
  const originalEventUpdateOne = Event.updateOne;
  const originalRoomFindOneAndUpdate = Room.findOneAndUpdate;
  const originalMemberUpdateOne = RoomMember.updateOne;
  restoreAfter(t, Event, "findById", originalFindById);
  restoreAfter(t, Event, "updateOne", originalEventUpdateOne);
  restoreAfter(t, Room, "findOneAndUpdate", originalRoomFindOneAndUpdate);
  restoreAfter(t, RoomMember, "updateOne", originalMemberUpdateOne);

  Event.findById = () => ({
    lean: async () => ({
      _id: eventId,
      title: "Evento passato",
      approvalStatus: "approved",
      visibility: "private",
      accessCode: "RIGHT-CODE",
      revokedUsers: [],
      dateStart: new Date("2020-01-01T10:00:00.000Z"),
      dateEnd: new Date("2020-01-01T12:00:00.000Z"),
    }),
  });

  let mutationCount = 0;
  Event.updateOne = async () => {
    mutationCount += 1;
  };
  Room.findOneAndUpdate = () => {
    mutationCount += 1;
    throw new Error("room mutation must not run");
  };
  RoomMember.updateOne = async () => {
    mutationCount += 1;
  };

  const req = {
    user: { id: userId },
    params: { eventId },
    body: { code: "RIGHT-CODE" },
  };
  const res = createResponse();
  let nextError;

  await roomsController.unlockEvent(req, res, (error) => {
    nextError = error;
  });

  assert.equal(nextError, undefined);
  assert.equal(res.statusCode, 410);
  assert.deepEqual(res.body, { ok: false, error: "EVENT_PAST" });
  assert.equal(mutationCount, 0);
});

test("room unlock stops if the event state changes before the grant", async (t) => {
  const eventId = "64b000000000000000000020";
  const userId = "64b000000000000000000021";
  const originalFindById = Event.findById;
  const originalEventUpdateOne = Event.updateOne;
  const originalRoomFindOneAndUpdate = Room.findOneAndUpdate;
  const originalMemberUpdateOne = RoomMember.updateOne;
  restoreAfter(t, Event, "findById", originalFindById);
  restoreAfter(t, Event, "updateOne", originalEventUpdateOne);
  restoreAfter(t, Room, "findOneAndUpdate", originalRoomFindOneAndUpdate);
  restoreAfter(t, RoomMember, "updateOne", originalMemberUpdateOne);

  Event.findById = () => ({
    lean: async () => ({
      _id: eventId,
      title: "Evento futuro",
      approvalStatus: "approved",
      visibility: "private",
      accessCode: "RIGHT-CODE",
      revokedUsers: [],
      dateStart: new Date(Date.now() + 48 * 60 * 60 * 1000),
      dateEnd: new Date(Date.now() + 50 * 60 * 60 * 1000),
    }),
  });
  Event.updateOne = async () => ({ matchedCount: 0 });

  let roomMutationCount = 0;
  Room.findOneAndUpdate = () => {
    roomMutationCount += 1;
    throw new Error("room mutation must not run");
  };
  RoomMember.updateOne = async () => {
    roomMutationCount += 1;
  };

  const req = {
    user: { id: userId },
    params: { eventId },
    body: { code: "RIGHT-CODE" },
  };
  const res = createResponse();

  await roomsController.unlockEvent(req, res, (error) => {
    throw error;
  });

  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body, {
    ok: false,
    error: "EVENT_STATE_CHANGED",
  });
  assert.equal(roomMutationCount, 0);
});

test("room unlock grants access before idempotent room membership", async (t) => {
  const eventId = "64b000000000000000000030";
  const userId = "64b000000000000000000031";
  const roomId = "64b000000000000000000032";
  const originalFindById = Event.findById;
  const originalEventUpdateOne = Event.updateOne;
  const originalRoomFindOneAndUpdate = Room.findOneAndUpdate;
  const originalMemberUpdateOne = RoomMember.updateOne;
  restoreAfter(t, Event, "findById", originalFindById);
  restoreAfter(t, Event, "updateOne", originalEventUpdateOne);
  restoreAfter(t, Room, "findOneAndUpdate", originalRoomFindOneAndUpdate);
  restoreAfter(t, RoomMember, "updateOne", originalMemberUpdateOne);

  const operations = [];
  Event.findById = () => ({
    lean: async () => ({
      _id: eventId,
      title: "Evento futuro",
      organizer: "64b000000000000000000033",
      approvalStatus: "approved",
      visibility: "private",
      accessCode: "RIGHT-CODE",
      revokedUsers: [],
      dateStart: new Date(Date.now() + 48 * 60 * 60 * 1000),
      dateEnd: new Date(Date.now() + 50 * 60 * 60 * 1000),
    }),
  });

  let grantFilter;
  Event.updateOne = async (filter) => {
    operations.push("grant");
    grantFilter = filter;
    return { matchedCount: 1 };
  };

  Room.findOneAndUpdate = () => {
    operations.push("room");
    return {
      lean: async () => ({ _id: roomId, title: "Evento futuro" }),
    };
  };

  RoomMember.updateOne = async () => {
    operations.push("membership");
    return { acknowledged: true };
  };

  const req = {
    user: { id: userId },
    params: { eventId },
    body: { code: "RIGHT-CODE" },
  };
  const res = createResponse();

  await roomsController.unlockEvent(req, res, (error) => {
    throw error;
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.deepEqual(operations, ["grant", "room", "membership"]);
  assert.equal(grantFilter.approvalStatus, "approved");
  assert.equal(grantFilter.visibility, "private");
  assert.equal(grantFilter.accessCode, "RIGHT-CODE");
  assert.deepEqual(grantFilter.revokedUsers, { $ne: userId });
  assert.equal(Array.isArray(grantFilter.$or), true);
});
